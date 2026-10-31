-- База без копий.
-- 1) История документов 1С: только настоящие изменения (было → стало) и короткая подпись документа, без снимка всей строки.
--    Первое заполнение пустого поля подробностями из другого файла (входящий №, основание, статья…) — не изменение.
-- 2) Сумма документа: из «Взаиморасчётов» главнее, чем из списка документов (там «Сумма документа прих.»
--    у части накладных отличается от суммы по договору) — список больше не перезаписывает её.
-- 3) Временные отметки загрузки (private.import_seen) — без журнала (unlogged); брошенные удаляются при следующей загрузке.

alter table public.docs add column money_src char(1) check (money_src in ('v', 'l'));
-- документы из первой загрузки «Взаиморасчётов» (до загрузки списков владельцем)
update public.docs set money_src = case when created_at < '2026-10-31 11:30:00+00' then 'v' else 'l' end;

create or replace function private.audit_docs() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_new jsonb := to_jsonb(new); v_old jsonb := to_jsonb(old); v_changes jsonb := '{}'::jsonb; k text; v_real boolean := false;
  skip text[] := array['updated_at', 'created_at', 'open_amount', 'basis_id', 'money_src'];
begin
  for k in select jsonb_object_keys(v_new) loop
    if not (k = any(skip)) and v_new -> k is distinct from v_old -> k then
      v_changes := v_changes || jsonb_build_object(k, jsonb_build_array(v_old -> k, v_new -> k));
      -- заполнение пустого подробностями — не изменение; удаление/восстановление и суммы — изменение
      if (v_old -> k) is not null and (v_old -> k) <> 'null'::jsonb then v_real := true; end if;
    end if;
  end loop;
  if v_changes = '{}'::jsonb or not v_real then return null; end if;
  insert into public.audit_log (entity, entity_id, action, rep_id, data, changes)
  values ('docs', new.id, 'update', new.rep_id,
    jsonb_build_object('title', new.title, 'num', new.num, 'in_no', new.in_no, 'kontr', new.kontr, 'doc_at', new.doc_at), v_changes);
  return null;
end $$;

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
    rep_id uuid, src char(1)
  ) on commit drop;   -- каждая пачка — своя транзакция: таблица всегда новая
  insert into pg_temp._src (title, num, year, at, kontr, k, inc, dec, retail, in_no, pay_due, basis, article, cash, comment, src)
  select distinct on (x.title, x.num, extract(year from x.at))
         left(btrim(x.title), 100), left(btrim(x.num), 40), extract(year from x.at)::smallint, x.at,
         left(regexp_replace(btrim(x.kontr), '\s+', ' ', 'g'), 300),
         lower(left(regexp_replace(btrim(x.kontr), '\s+', ' ', 'g'), 300)),
         round(coalesce(x.inc, 0), 2), round(coalesce(x.dec, 0), 2), round(x.retail, 2),
         nullif(left(btrim(x.in_no), 60), ''), x.pay_due, nullif(left(btrim(x.basis), 200), ''),
         nullif(left(btrim(x.article), 100), ''), nullif(left(btrim(x.cash), 100), ''), nullif(left(btrim(x.comment), 500), ''),
         case when x.src = 'v' then 'v' else 'l' end
    from jsonb_to_recordset(p_rows) as x(title text, num text, at timestamp, kontr text, inc numeric, dec numeric, retail numeric,
         in_no text, pay_due date, basis text, article text, cash text, comment text, src text)
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
      inc = case when f_inc and (s.src = 'v' or d.money_src is distinct from 'v') then s.inc else d.inc end,
      dec = case when f_dec and (s.src = 'v' or d.money_src is distinct from 'v') then s.dec else d.dec end,
      money_src = case when f_inc and s.src = 'v' then 'v' else coalesce(d.money_src, s.src) end,
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
       or (f_inc and (s.src = 'v' or d.money_src is distinct from 'v') and d.inc is distinct from s.inc)
       or (f_dec and (s.src = 'v' or d.money_src is distinct from 'v') and d.dec is distinct from s.dec)
       or (f_inc and s.src = 'v' and d.money_src is distinct from 'v')
       or (f_retail and d.retail is distinct from s.retail) or (f_in_no and d.in_no is distinct from s.in_no)
       or (f_pay_due and d.pay_due is distinct from s.pay_due) or (f_basis and d.basis_key is distinct from s.basis)
       or (f_article and d.article is distinct from s.article) or (f_cash and d.cash is distinct from s.cash)
       or (f_comment and d.comment is distinct from s.comment));
  get diagnostics n_upd = row_count;

  insert into public.docs (title, kind, num, year, doc_at, rep_id, kontr, inc, dec, retail, in_no, pay_due, basis_key, article, cash, comment, money_src)
  select s.title, private.doc_kind(s.title), s.num, s.year, s.at, s.rep_id, s.kontr, s.inc, s.dec, s.retail,
         s.in_no, s.pay_due, s.basis, s.article, s.cash, s.comment, s.src
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

-- Исправить суммы, которые список перезаписал поверх «Взаиморасчётов» (берём «было» из истории)
update public.docs d set inc = (a.changes -> 'inc' ->> 0)::numeric
  from (select distinct on (entity_id) entity_id, changes from public.audit_log
         where entity = 'docs' and action = 'update' and changes ? 'inc' and at >= '2026-10-31 11:30:00+00'
         order by entity_id, at) a
 where d.id = a.entity_id and d.money_src = 'v' and (a.changes -> 'inc' ->> 0) is not null;

-- Старые записи истории: без снимка строки; записи-заполнения помечаются 'fill' и в истории не показываются
update public.audit_log a
   set data = jsonb_build_object('title', a.data ->> 'title', 'num', a.data ->> 'num', 'in_no', a.data ->> 'in_no',
                                 'kontr', a.data ->> 'kontr', 'doc_at', a.data ->> 'doc_at')
 where a.entity = 'docs' and a.action = 'update' and a.data ? 'inc';

update public.audit_log a set action = 'fill'
 where a.entity = 'docs' and a.action = 'update'
   and not exists (select 1 from jsonb_each(a.changes) e(k, v) where (v -> 0) <> 'null'::jsonb);

-- Остатки по накладным после исправления сумм
select private.recalc_open(array(select id from public.reps));

-- Временные отметки загрузки: без журнала
alter table private.import_seen set unlogged;
