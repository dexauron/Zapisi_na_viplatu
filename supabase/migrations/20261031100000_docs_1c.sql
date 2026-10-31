-- Документы из 1С: приходные накладные, оплаты (РКО), возвраты поставщику и прочие движения взаиморасчётов.
-- Правила:
--  * документ узнаётся по виду + номеру + году: повторная загрузка обновляет, а не копирует;
--  * изменения существующих документов пишутся в историю (было → стало), новые — одной строкой итога;
--  * документ, пропавший из 1С за загруженный период, помечается deleted, а не стирается;
--  * ручные решения (статус заказа, «Оплачено» у выплаты) загрузка не отменяет — только дополняет.

create table public.docs (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(title) between 1 and 100),   -- вид документа, как в 1С
  kind text not null check (kind in ('in', 'pay', 'ret', 'other')), -- приход | оплата | возврат | прочее
  num text not null check (length(num) between 1 and 40),
  year smallint not null,
  doc_at timestamp not null,                    -- дата и время документа в 1С (местное время магазина)
  rep_id uuid not null references public.reps(id) on delete restrict,
  kontr text not null,                          -- контрагент, как записан в 1С
  inc numeric(14,2) not null default 0 check (inc >= 0),   -- увеличение долга магазина перед поставщиком
  dec numeric(14,2) not null default 0 check (dec >= 0),   -- уменьшение долга (оплата, возврат)
  retail numeric(14,2),                         -- сумма в розничных ценах (приходная)
  in_no text,                                   -- входящий номер накладной поставщика
  pay_due date,                                 -- «Дата оплаты» в приходной (отсрочка)
  basis_key text,                               -- «Документ основание»: вид|номер|год
  basis_id uuid references public.docs(id) on delete set null,
  article text,                                 -- статья ДДС: «Оплата Сразу», «Оплата Долга»…
  cash text,                                    -- касса: Наличка, Эквайринг
  comment text,
  open_amount numeric(14,2),                    -- приходная: сколько ещё не оплачено (считается после загрузки)
  deleted boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (title, num, year)
);
create index docs_rep_at_idx on public.docs (rep_id, doc_at desc);
create index docs_basis_idx on public.docs (basis_id) where basis_id is not null;
create index docs_open_idx on public.docs (rep_id) where kind = 'in' and open_amount > 0 and not deleted;
alter table public.docs enable row level security;
create policy docs_admin_read on public.docs for select to authenticated using ((select private.is_admin()));

-- Связи с ручными записями
alter table public.payouts add column doc_id uuid references public.docs(id) on delete set null;
create index payouts_doc_idx on public.payouts (doc_id) where doc_id is not null;
alter table public.orders add column doc_id uuid references public.docs(id) on delete set null;
alter table public.orders add column actual_amount numeric(14,2);
create index orders_doc_idx on public.orders (doc_id) where doc_id is not null;

-- Связь заказа с накладной ставит только загрузка из 1С
create or replace function public.orders_touch() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  if tg_op = 'UPDATE' then
    new.created_by := old.created_by;
    new.created_at := old.created_at;
    new.updated_by := (select auth.uid());
  end if;
  if current_setting('app.import_1c', true) is distinct from '1' then
    if tg_op = 'UPDATE' then new.doc_id := old.doc_id; new.actual_amount := old.actual_amount;
    else new.doc_id := null; new.actual_amount := null; end if;
  end if;
  if new.status = 'delivered' and (tg_op = 'INSERT' or old.status is distinct from 'delivered') then
    new.delivered_at := coalesce(new.delivered_at, now());
  elsif new.status <> 'delivered' then
    new.delivered_at := null;
  end if;
  return new;
end $$;

create or replace function public.docs_touch() returns trigger
language plpgsql set search_path = '' as $$
begin new.updated_at := now(); return new; end $$;
create trigger docs_touch before update on public.docs for each row execute function public.docs_touch();

-- История документов: только изменения и пометки «удалён» (новые документы — одной строкой итога загрузки)
create or replace function private.audit_docs() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_new jsonb := to_jsonb(new); v_old jsonb := to_jsonb(old); v_changes jsonb := '{}'::jsonb; k text;
  skip text[] := array['updated_at', 'created_at', 'open_amount', 'basis_id'];
begin
  for k in select jsonb_object_keys(v_new) loop
    if not (k = any(skip)) and v_new -> k is distinct from v_old -> k then
      v_changes := v_changes || jsonb_build_object(k, jsonb_build_array(v_old -> k, v_new -> k));
    end if;
  end loop;
  if v_changes = '{}'::jsonb then return null; end if;
  insert into public.audit_log (entity, entity_id, action, rep_id, data, changes)
  values ('docs', new.id, 'update', new.rep_id, v_new - 'open_amount', v_changes);
  return null;
end $$;
create trigger docs_audit after update on public.docs for each row execute function private.audit_docs();

create or replace function private.doc_kind(p_title text) returns text
language sql immutable set search_path = '' as $$
  select case
    when p_title = 'Приходная накладная' then 'in'
    when p_title in ('Расходный кассовый ордер', 'Расход со счета', 'Платежное поручение исходящее') then 'pay'
    when p_title = 'Возврат поставщику' then 'ret'
    else 'other' end;
$$;

-- Отметки «документ был в этой загрузке» — для поиска удалённых в 1С
create table private.import_seen (
  import_id uuid not null,
  title text not null, num text not null, year smallint not null,
  at timestamptz not null default now(),
  primary key (import_id, title, num, year)
);

-- Одна пачка строк (до 3000). p_fields — какие поля даёт этот вид файла: остальные не трогаются.
create or replace function public.import_docs(p_import uuid, p_fields text[], p_rows jsonb)
returns json
language plpgsql security definer set search_path = '' as $$
declare
  f_inc boolean := 'inc' = any(p_fields); f_dec boolean := 'dec' = any(p_fields);
  f_retail boolean := 'retail' = any(p_fields); f_in_no boolean := 'in_no' = any(p_fields);
  f_pay_due boolean := 'pay_due' = any(p_fields); f_basis boolean := 'basis' = any(p_fields);
  f_article boolean := 'article' = any(p_fields); f_cash boolean := 'cash' = any(p_fields);
  f_comment boolean := 'comment' = any(p_fields);
  n_rows int; n_add int := 0; n_upd int := 0; n_reps int := 0; n_skip int := 0;
begin
  if not (select private.is_admin()) then
    raise exception 'Загрузка из 1С — только для администратора' using errcode = '42501';
  end if;
  if p_import is null then raise exception 'Нет номера загрузки'; end if;
  if jsonb_typeof(p_rows) is distinct from 'array' then raise exception 'Неверные данные'; end if;
  n_rows := jsonb_array_length(p_rows);
  if n_rows > 3000 then raise exception 'Слишком большая пачка (больше 3000 строк)'; end if;
  perform set_config('app.bulk_import', '1', true);

  create temp table if not exists _src (
    title text, num text, year smallint, at timestamp, kontr text, k text,
    inc numeric, dec numeric, retail numeric, in_no text, pay_due date, basis text, article text, cash text, comment text,
    rep_id uuid
  ) on commit drop;
  truncate pg_temp._src;
  insert into pg_temp._src (title, num, year, at, kontr, k, inc, dec, retail, in_no, pay_due, basis, article, cash, comment)
  select distinct on (x.title, x.num, extract(year from x.at))
         left(btrim(x.title), 100), left(btrim(x.num), 40), extract(year from x.at)::smallint, x.at,
         left(regexp_replace(btrim(x.kontr), '\s+', ' ', 'g'), 300),
         lower(left(regexp_replace(btrim(x.kontr), '\s+', ' ', 'g'), 300)),
         round(coalesce(x.inc, 0), 2), round(coalesce(x.dec, 0), 2), round(x.retail, 2),
         nullif(left(btrim(x.in_no), 60), ''), x.pay_due, nullif(left(btrim(x.basis), 200), ''),
         nullif(left(btrim(x.article), 100), ''), nullif(left(btrim(x.cash), 100), ''), nullif(left(btrim(x.comment), 500), '')
    from jsonb_to_recordset(p_rows) as x(title text, num text, at timestamp, kontr text, inc numeric, dec numeric, retail numeric,
         in_no text, pay_due date, basis text, article text, cash text, comment text)
   where coalesce(btrim(x.title), '') <> '' and coalesce(btrim(x.num), '') <> '' and x.at is not null
     and coalesce(btrim(x.kontr), '') <> '' and coalesce(x.inc, 0) >= 0 and coalesce(x.dec, 0) >= 0
   order by x.title, x.num, extract(year from x.at), x.at desc;
  n_skip := n_rows - (select count(*) from pg_temp._src);

  -- Представители: по имени контрагента из 1С; введённых вручную — подхватить; новых — добавить
  update public.reps r set ext_key = s.k
    from (select distinct k from pg_temp._src) s
   where r.id = (select r2.id from public.reps r2
                  where r2.ext_key is null
                    and (lower(btrim(r2.full_name)) = s.k or lower(btrim(coalesce(r2.company || ' тп ', '') || r2.full_name)) = s.k)
                  order by r2.created_at limit 1)
     and not exists (select 1 from public.reps x where x.ext_key = s.k);
  insert into public.reps (full_name, company, ext_key)
  select coalesce(substring(s.kontr from '^.*?\s+[Тт][Пп]\s+(.+)$'), s.kontr),
         nullif(substring(s.kontr from '^(.*?)\s+[Тт][Пп]\s+.+$'), ''), s.k
    from (select distinct on (k) k, kontr from pg_temp._src order by k) s
   where not exists (select 1 from public.reps r where r.ext_key = s.k)
  on conflict (ext_key) do nothing;
  get diagnostics n_reps = row_count;
  update pg_temp._src s set rep_id = r.id from public.reps r where r.ext_key = s.k;

  insert into private.import_seen (import_id, title, num, year)
  select p_import, title, num, year from pg_temp._src on conflict do nothing;

  -- Изменённые: только реально отличающиеся строки (без пустых обновлений)
  update public.docs d set
      doc_at = s.at, rep_id = s.rep_id, kontr = s.kontr,
      inc = case when f_inc then s.inc else d.inc end,
      dec = case when f_dec then s.dec else d.dec end,
      retail = case when f_retail then s.retail else d.retail end,
      in_no = case when f_in_no then s.in_no else d.in_no end,
      pay_due = case when f_pay_due then s.pay_due else d.pay_due end,
      basis_key = case when f_basis then s.basis else d.basis_key end,
      article = case when f_article then s.article else d.article end,
      cash = case when f_cash then s.cash else d.cash end,
      comment = case when f_comment then s.comment else d.comment end,
      deleted = false
    from pg_temp._src s
   where d.title = s.title and d.num = s.num and d.year = s.year
     and (d.doc_at is distinct from s.at or d.rep_id is distinct from s.rep_id or d.kontr is distinct from s.kontr or d.deleted
       or (f_inc and d.inc is distinct from s.inc) or (f_dec and d.dec is distinct from s.dec)
       or (f_retail and d.retail is distinct from s.retail) or (f_in_no and d.in_no is distinct from s.in_no)
       or (f_pay_due and d.pay_due is distinct from s.pay_due) or (f_basis and d.basis_key is distinct from s.basis)
       or (f_article and d.article is distinct from s.article) or (f_cash and d.cash is distinct from s.cash)
       or (f_comment and d.comment is distinct from s.comment));
  get diagnostics n_upd = row_count;

  insert into public.docs (title, kind, num, year, doc_at, rep_id, kontr, inc, dec, retail, in_no, pay_due, basis_key, article, cash, comment)
  select s.title, private.doc_kind(s.title), s.num, s.year, s.at, s.rep_id, s.kontr, s.inc, s.dec, s.retail,
         s.in_no, s.pay_due, s.basis, s.article, s.cash, s.comment
    from pg_temp._src s
   where s.rep_id is not null
     and not exists (select 1 from public.docs d where d.title = s.title and d.num = s.num and d.year = s.year);
  get diagnostics n_add = row_count;

  perform set_config('app.bulk_import', '0', true);
  return json_build_object('added', n_add, 'updated', n_upd, 'same', n_rows - n_skip - n_add - n_upd,
    'skipped', n_skip, 'reps_added', n_reps);
end $$;
revoke all on function public.import_docs(uuid, text[], jsonb) from public, anon;
grant execute on function public.import_docs(uuid, text[], jsonb) to authenticated;

-- Сколько не оплачено по каждой приходной: сначала оплаты и возвраты по основанию,
-- остаток оплат без основания — на самые старые накладные (как в 1С при оплате долга).
create or replace function private.recalc_open(p_reps uuid[])
returns void
language sql security definer set search_path = '' as $$
  with inv as (
    select d.id, d.rep_id, d.doc_at, d.inc from public.docs d
     where d.rep_id = any(p_reps) and d.kind = 'in' and not d.deleted
  ), lnk as (
    select p.basis_id as id, sum(p.dec) as s
      from public.docs p join inv on inv.id = p.basis_id
     where not p.deleted and p.kind <> 'in'
     group by p.basis_id
  ), rem as (
    select inv.id, inv.rep_id, inv.doc_at,
           greatest(inv.inc - coalesce(l.s, 0), 0) as rem, greatest(coalesce(l.s, 0) - inv.inc, 0) as over
      from inv left join lnk l using (id)
  ), unl as (   -- оплаты, возвраты и прочее без основания среди этих накладных
    select o.rep_id, sum(o.dec) - sum(o.inc) as s
      from public.docs o left join inv i on i.id = o.basis_id
     where o.rep_id = any(p_reps) and o.kind <> 'in' and not o.deleted and i.id is null
     group by o.rep_id
  ), pool as (
    select r.rep_id, coalesce(max(u.s), 0) + sum(r.over) as pool
      from rem r left join unl u using (rep_id) group by r.rep_id
  ), calc as (
    select rem.id,
           greatest(0, least(rem.rem, sum(rem.rem) over (partition by rem.rep_id order by rem.doc_at, rem.id) - pool.pool))::numeric(14,2) as open
      from rem join pool using (rep_id)
  )
  update public.docs d set open_amount = c.open from calc c
   where d.id = c.id and d.open_amount is distinct from c.open;
$$;

-- Завершение загрузки: удалённые в 1С и связи «оплата → накладная». Возвращает затронутых поставщиков —
-- сверку по ним клиент запускает пачками (reconcile), чтобы каждый запрос укладывался в лимит времени.
-- p_scopes: [{titles: [...], from: 'ГГГГ-ММ-ДД', to: 'ГГГГ-ММ-ДД', by_reps: bool}]
create or replace function public.finish_import(p_import uuid, p_scopes jsonb, p_files jsonb default '[]'::jsonb)
returns json
language plpgsql security definer set search_path = '' as $$
declare
  sc jsonb; v_titles text[]; v_from date; v_to date; v_by_reps boolean;
  v_reps uuid[]; v_del_reps uuid[]; n_scope int; n_miss int; n_del int := 0; v_skipped text[] := '{}'; v_res jsonb;
begin
  if not (select private.is_admin()) then
    raise exception 'Загрузка из 1С — только для администратора' using errcode = '42501';
  end if;
  select coalesce(array_agg(distinct d.rep_id), '{}') into v_reps
    from private.import_seen s join public.docs d on d.title = s.title and d.num = s.num and d.year = s.year
   where s.import_id = p_import;

  -- Пропавшие из 1С за загруженный период
  for sc in select value from jsonb_array_elements(coalesce(p_scopes, '[]'::jsonb)) loop
    select coalesce(array_agg(t), '{}') into v_titles from jsonb_array_elements_text(sc -> 'titles') t;
    v_from := (sc ->> 'from')::date; v_to := (sc ->> 'to')::date; v_by_reps := coalesce((sc ->> 'by_reps')::boolean, false);
    continue when v_from is null or v_to is null or cardinality(v_titles) = 0;
    select count(*), count(*) filter (where not exists (select 1 from private.import_seen s
             where s.import_id = p_import and s.title = d.title and s.num = d.num and s.year = d.year))
      into n_scope, n_miss
      from public.docs d
     where d.title = any(v_titles) and d.doc_at::date between v_from and v_to and not d.deleted
       and (not v_by_reps or d.rep_id = any(v_reps));
    -- защита от неполного файла (выгрузка с отбором): не помечать массово
    if n_miss > 10 and n_miss > n_scope * 0.2 then
      v_skipped := v_skipped || (array_to_string(v_titles, ', ') || ': ' || n_miss);
      continue;
    end if;
    with del as (
      update public.docs d set deleted = true
       where d.title = any(v_titles) and d.doc_at::date between v_from and v_to and not d.deleted
         and (not v_by_reps or d.rep_id = any(v_reps))
         and not exists (select 1 from private.import_seen s
               where s.import_id = p_import and s.title = d.title and s.num = d.num and s.year = d.year)
      returning d.rep_id)
    select count(*), coalesce(array_agg(distinct rep_id), '{}') into n_miss, v_del_reps from del;
    n_del := n_del + n_miss;
    v_reps := array(select distinct x from unnest(v_reps || v_del_reps) x);
  end loop;

  -- Основания оплат и возвратов
  update public.docs p set basis_id = i.id
    from public.docs i
   where p.rep_id = any(v_reps) and p.basis_key is not null
     and i.title = split_part(p.basis_key, '|', 1) and i.num = split_part(p.basis_key, '|', 2)
     and i.year = nullif(split_part(p.basis_key, '|', 3), '')::smallint
     and p.basis_id is distinct from i.id;

  delete from private.import_seen where import_id = p_import or at < now() - interval '1 day';
  v_res := jsonb_build_object('deleted', n_del, 'not_deleted', v_skipped);
  insert into public.audit_log (entity, action, data)
  values ('import', 'import', jsonb_build_object('kind', 'docs', 'files', p_files, 'reps', cardinality(v_reps)) || v_res);
  return v_res || jsonb_build_object('reps', to_jsonb(v_reps));
end $$;
revoke all on function public.finish_import(uuid, jsonb, jsonb) from public, anon;
grant execute on function public.finish_import(uuid, jsonb, jsonb) to authenticated;

-- Сверка по поставщикам (до 200 за вызов): остатки по накладным, связи с записями и заказами
create or replace function public.reconcile(p_reps uuid[])
returns json
language plpgsql security definer set search_path = '' as $$
declare n_orders int := 0; n_link int := 0; n_link2 int := 0; n_paid int := 0; v_ord record; v_doc public.docs;
begin
  if not (select private.is_admin()) then
    raise exception 'Сверка 1С — только для администратора' using errcode = '42501';
  end if;
  if cardinality(p_reps) > 200 then raise exception 'Слишком много поставщиков за раз'; end if;

  perform private.recalc_open(p_reps);
  perform set_config('app.import_1c', '1', true);

  -- Записи на выплату ↔ приходные: по номеру накладной
  with cand as (
    select distinct on (p.id) p.id pid, d.id did
      from public.payouts p
      join public.docs d on d.rep_id = p.rep_id and d.kind = 'in' and not d.deleted
     where p.rep_id = any(p_reps) and p.doc_id is null and p.invoice_no is not null
       and (lower(btrim(d.in_no)) = lower(btrim(p.invoice_no))
         or lower(d.num) = lower(btrim(p.invoice_no))
         or (length(regexp_replace(p.invoice_no, '\D', '', 'g')) >= 3
             and regexp_replace(d.num, '\D', '', 'g') like '%' || regexp_replace(p.invoice_no, '\D', '', 'g')))
       and not exists (select 1 from public.payouts x where x.doc_id = d.id)
     order by p.id, abs(extract(epoch from (d.doc_at - p.payout_date::timestamp)))
  )
  update public.payouts p set doc_id = c.did from cand c where p.id = c.pid;
  get diagnostics n_link = row_count;
  -- …иначе по точной сумме — только когда пара однозначна в обе стороны
  with pairs as (
    select p.id pid, d.id did
      from public.payouts p
      join public.docs d on d.rep_id = p.rep_id and d.kind = 'in' and not d.deleted and d.inc = p.amount
       and d.doc_at::date between p.created_at::date - 60 and greatest(p.payout_date, p.created_at::date) + 1
       and not exists (select 1 from public.payouts x where x.doc_id = d.id)
     where p.rep_id = any(p_reps) and p.doc_id is null
  ), ok as (
    select pid, did from pairs
     where pid in (select pid from pairs group by pid having count(*) = 1)
       and did in (select did from pairs group by did having count(*) = 1)
  )
  update public.payouts p set doc_id = ok.did from ok where p.id = ok.pid;
  get diagnostics n_link2 = row_count;

  -- Запись не отмечена, а в 1С накладная оплачена полностью → «Оплачено» (дата — последняя оплата по накладной)
  update public.payouts p set status = 'paid',
         paid_at = coalesce((select max(x.doc_at) from public.docs x where x.basis_id = d.id and x.kind = 'pay' and not x.deleted)
                            at time zone 'Europe/Moscow', now())
    from public.docs d
   where p.doc_id = d.id and p.status <> 'paid' and not d.deleted and d.open_amount = 0 and p.rep_id = any(p_reps);
  get diagnostics n_paid = row_count;

  -- Заказы ↔ пришедшие накладные: ближайшая накладная того же поставщика не раньше даты заказа
  for v_ord in select * from public.orders
                where rep_id = any(p_reps) and doc_id is null and status in ('ordered', 'delivered')
                  and order_date >= current_date - 180
                order by order_date, created_at loop
    select d.* into v_doc from public.docs d
     where d.rep_id = v_ord.rep_id and d.kind = 'in' and not d.deleted
       and d.doc_at::date between v_ord.order_date and coalesce(v_ord.expected_date, v_ord.order_date) + 14
       and not exists (select 1 from public.orders x where x.doc_id = d.id)
     order by d.doc_at limit 1;
    continue when v_doc.id is null;
    update public.orders set doc_id = v_doc.id, actual_amount = v_doc.inc, status = 'delivered',
           delivered_at = case when status = 'delivered' then delivered_at else v_doc.doc_at at time zone 'Europe/Moscow' end
     where id = v_ord.id;
    n_orders := n_orders + 1; v_doc := null;
  end loop;
  update public.orders o set actual_amount = d.inc from public.docs d
   where o.doc_id = d.id and o.rep_id = any(p_reps) and o.actual_amount is distinct from d.inc;
  perform set_config('app.import_1c', '0', true);
  return json_build_object('orders', n_orders, 'payouts_linked', n_link + n_link2, 'payouts_paid', n_paid);
end $$;
revoke all on function public.reconcile(uuid[]) from public, anon;
grant execute on function public.reconcile(uuid[]) to authenticated;

-- Карточка поставщика: документы 1С, долг и вся история заказов и выплат (стартовая загрузка берёт только свежее)
create or replace function public.rep_history(p_rep uuid) returns json
language plpgsql stable security definer set search_path = '' as $$
begin
  if not (select private.is_staff()) then raise exception 'Нет доступа' using errcode = '42501'; end if;
  return json_build_object(
    'orders', coalesce((select json_agg(o order by o.order_date desc, o.created_at desc) from public.orders o where o.rep_id = p_rep), '[]'::json),
    'payouts', case when (select private.is_admin()) then
      coalesce((select json_agg(p order by p.payout_date desc, p.created_at desc) from public.payouts p where p.rep_id = p_rep), '[]'::json) end,
    'docs', case when (select private.is_admin()) then
      coalesce((select json_agg(json_build_object('id', d.id, 'title', d.title, 'kind', d.kind, 'num', d.num, 'at', d.doc_at,
        'inc', d.inc, 'dec', d.dec, 'retail', d.retail, 'in_no', d.in_no, 'pay_due', d.pay_due, 'basis_id', d.basis_id,
        'article', d.article, 'cash', d.cash, 'comment', d.comment, 'open', d.open_amount, 'deleted', d.deleted)
        order by d.doc_at desc) from public.docs d where d.rep_id = p_rep), '[]'::json) end,
    'debt', case when (select private.is_admin()) then
      (select sum(d.inc) - sum(d.dec) from public.docs d where d.rep_id = p_rep and not d.deleted) end
  );
end $$;
revoke all on function public.rep_history(uuid) from public, anon;
grant execute on function public.rep_history(uuid) to authenticated;

-- Неоплаченные накладные без записи на выплату (для «Сегодня» и сверки)
create or replace function public.unrecorded_invoices() returns json
language plpgsql stable security definer set search_path = '' as $$
begin
  if not (select private.is_admin()) then raise exception 'Нет доступа' using errcode = '42501'; end if;
  return coalesce((select json_agg(json_build_object('id', d.id, 'rep_id', d.rep_id, 'num', d.num, 'in_no', d.in_no, 'at', d.doc_at,
      'inc', d.inc, 'open', d.open_amount, 'pay_due', d.pay_due) order by d.doc_at)
    from public.docs d
   where d.kind = 'in' and not d.deleted and d.open_amount > 0
     and not exists (select 1 from public.payouts p where p.doc_id = d.id)), '[]'::json);
end $$;
revoke all on function public.unrecorded_invoices() from public, anon;
grant execute on function public.unrecorded_invoices() to authenticated;

-- Запуск приложения: только живое и свежее (открытые заказы и записи + последние 90 дней).
-- Старое приходит в карточке поставщика (rep_history) — запуск не тяжелеет с годами.
create or replace function public.app_bootstrap() returns json
language plpgsql security invoker set search_path = '' as $$
declare v_me json; v_admin boolean;
begin
  v_me := public.ensure_profile();
  if v_me is null or not (v_me ->> 'active')::boolean then
    return json_build_object('me', v_me);
  end if;
  v_admin := (select private.is_admin());
  return json_build_object(
    'me', v_me,
    'reps', coalesce((select json_agg(json_build_object('id', r.id, 'full_name', r.full_name, 'company', r.company, 'phone', r.phone,
              'active', r.active, 'ext_key', r.ext_key) order by r.full_name) from public.reps r), '[]'::json),
    'stores', coalesce((select json_agg(s order by s.name) from public.stores s), '[]'::json),
    'orders', coalesce((select json_agg(o order by o.order_date desc, o.created_at desc) from public.orders o
              where o.status = 'ordered' or o.order_date >= current_date - 90 or o.updated_at >= now() - interval '90 days'), '[]'::json),
    'staff', coalesce((select json_agg(json_build_object('user_id', s.user_id, 'login', s.login, 'full_name', s.full_name,
              'role', s.role, 'active', s.active) order by s.full_name) from public.staff s), '[]'::json),
    'payouts', coalesce((select json_agg(p order by p.payout_date desc, p.created_at desc) from public.payouts p
              where p.status <> 'paid' or p.payout_date >= current_date - 90 or p.updated_at >= now() - interval '90 days'), '[]'::json),
    'access', coalesce((select json_agg(a) from public.rep_access a), '[]'::json),
    'unrec', case when v_admin then (select json_build_object('n', count(*), 'sum', coalesce(sum(d.open_amount), 0))
              from public.docs d where d.kind = 'in' and not d.deleted and d.open_amount > 0
               and not exists (select 1 from public.payouts p where p.doc_id = d.id)) end,
    'db_mb', case when v_admin then (select round(pg_database_size(current_database()) / 1048576.0)) end
  );
end $$;
revoke all on function public.app_bootstrap() from public, anon;
grant execute on function public.app_bootstrap() to authenticated;

-- Кабинет ТП: + фактическая сумма заказа и его накладные/возвраты/оплаты за полгода и долг магазина
create or replace function public.get_rep_data(p_token text) returns json
language plpgsql stable security definer set search_path = '' as $$
declare v_rep public.reps;
begin
  if p_token is null or length(p_token) < 32 then return null; end if;
  select r.* into v_rep from public.reps r join public.rep_access a on a.rep_id = r.id
   where a.token = p_token and r.active;
  if not found then return null; end if;
  return json_build_object(
    'rep', json_build_object('full_name', v_rep.full_name, 'company', v_rep.company),
    'orders', coalesce((select json_agg(json_build_object(
        'id', o.id, 'order_no', o.order_no, 'date', o.order_date, 'expected', o.expected_date,
        'amount', o.amount, 'actual', o.actual_amount, 'status', o.status, 'delivered_at', o.delivered_at,
        'comment', o.comment, 'store', s.name) order by o.order_date desc, o.created_at desc)
      from public.orders o left join public.stores s on s.id = o.store_id
      where o.rep_id = v_rep.id), '[]'::json),
    'payouts', coalesce((select json_agg(json_build_object(
        'id', p.id, 'date', p.payout_date, 'amount', p.amount, 'status', p.status,
        'invoice_no', p.invoice_no, 'basis', p.basis, 'comment', p.comment, 'paid_at', p.paid_at,
        'store', s.name) order by p.payout_date desc, p.created_at desc)
      from public.payouts p left join public.stores s on s.id = p.store_id
      where p.rep_id = v_rep.id), '[]'::json),
    'docs', coalesce((select json_agg(json_build_object('id', d.id, 'kind', d.kind, 'title', d.title, 'num', d.num, 'in_no', d.in_no,
        'at', d.doc_at, 'amount', d.inc + d.dec, 'open', d.open_amount) order by d.doc_at desc)
      from public.docs d where d.rep_id = v_rep.id and not d.deleted and d.kind in ('in', 'ret', 'pay')
       and d.doc_at >= now() - interval '180 days'), '[]'::json),
    'debt', (select sum(d.inc) - sum(d.dec) from public.docs d where d.rep_id = v_rep.id and not d.deleted)
  );
end $$;
revoke all on function public.get_rep_data(text) from public, authenticated;
grant execute on function public.get_rep_data(text) to anon;
