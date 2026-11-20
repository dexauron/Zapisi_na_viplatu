-- Документ 1С и передача наличных — разные события. Старые оплаты не переоткрываем:
-- по прежним данным невозможно достоверно отличить ручную отметку от автосверки.
alter table public.payouts
  add column reserved_at timestamptz,
  add column reserved_amount numeric(12,2) not null default 0 check (reserved_amount >= 0),
  add column paid_by uuid,
  add column link_review_required boolean not null default false;

-- PostgreSQL numeric допускает NaN; прежнее amount > 0 его не отклоняет.
-- NOT VALID сохраняет исторические строки, но защищает все новые записи и изменения.
alter table public.payouts add constraint payouts_finite_amount
  check (amount between 0.01 and 9999999999.99) not valid;
alter table public.orders add constraint orders_finite_amount
  check (amount between 0.01 and 9999999999.99 and (actual_amount is null or actual_amount between 0 and 999999999999.99)) not valid;
alter table public.docs add constraint docs_finite_movements
  check (inc between 0 and 999999999999.99 and dec between 0 and 999999999999.99) not valid;

-- Автор выдачи сохраняется и после удаления учётки; его нельзя подменить из браузера.
create or replace function public.payouts_touch() returns trigger
language plpgsql set search_path = '' as $$
declare
  v_transition boolean := current_setting('app.payout_transition', true) = '1';
  v_reserved numeric := 0; v_reserved_at timestamptz;
begin
  if new.status = 'accrued' then new.status := 'to_pay'; end if;
  new.invoice_no := nullif(trim(new.invoice_no), '');
  if tg_op = 'INSERT' then
    if new.status = 'paid' then
      raise exception 'Сначала создайте запись, затем подтвердите фактическую выдачу денег' using errcode = '23514';
    end if;
    new.paid_by := null;
    new.link_review_required := false;
  else
    if new.doc_id is not null and new.doc_id is distinct from old.doc_id then
      new.link_review_required := false;
    elsif old.doc_id is not null and new.doc_id is null and not exists (
      select 1 from public.docs where id = old.doc_id and rep_id = old.rep_id and not deleted
    ) then
      new.link_review_required := true;
    else
      new.link_review_required := old.link_review_required;
    end if;
    if (new.status = 'paid') is distinct from (old.status = 'paid') and not coalesce(v_transition, false) then
      raise exception 'Подтвердите выдачу отдельным действием администратора' using errcode = '23514';
    end if;
    if old.status = 'paid' and new.status = 'paid' then
      if row(new.rep_id, new.amount, new.store_id) is distinct from row(old.rep_id, old.amount, old.store_id)
         or (new.doc_id is distinct from old.doc_id and not (old.doc_id is null and new.doc_id is not null) and not (new.doc_id is null
             and not exists (select 1 from public.docs where id = old.doc_id and rep_id = old.rep_id and not deleted))) then
        raise exception 'Сначала отмените отметку о выдаче, затем измените получателя или сумму' using errcode = '23514';
      end if;
      new.paid_at := old.paid_at;
      new.paid_by := old.paid_by;
      new.reserved_at := old.reserved_at;
      new.reserved_amount := old.reserved_amount;
    elsif new.status = 'paid' then
      new.paid_at := clock_timestamp();
      new.paid_by := auth.uid();
      new.reserved_at := old.reserved_at;
      new.reserved_amount := old.reserved_amount;
    end if;
  end if;
  if new.status <> 'paid' then
    -- Только положительный связанный РКО. Возврат, зачёт и банковский платёж
    -- не подтверждают наличие наличных в конверте. Частичный РКО виден отдельной суммой.
    select least(new.amount, greatest(coalesce(sum(r.dec - r.inc), 0), 0)),
           max(r.doc_at) at time zone 'Europe/Moscow'
      into v_reserved, v_reserved_at
      from public.docs i join public.docs r on r.basis_id = i.id and r.rep_id = i.rep_id
     where i.id = new.doc_id and i.rep_id = new.rep_id and i.kind = 'in' and not i.deleted
       and r.title = 'Расходный кассовый ордер' and r.kind = 'pay' and not r.deleted;
    new.reserved_amount := v_reserved;
    new.reserved_at := case when v_reserved > 0 then v_reserved_at end;
    new.status := case when v_reserved > 0 then 'reserved'::public.payout_status else 'to_pay'::public.payout_status end;
    new.paid_at := null;
    new.paid_by := null;
  end if;
  if current_setting('app.rep_confirm', true) is distinct from '1' then
    new.received_at := case when tg_op = 'UPDATE' then old.received_at end;
  end if;
  if new.status <> 'paid' then new.received_at := null; end if;
  if tg_op = 'INSERT' then
    new.updated_at := clock_timestamp();
  elsif (to_jsonb(new) - 'updated_at') is distinct from (to_jsonb(old) - 'updated_at') then
    new.updated_at := greatest(clock_timestamp(), old.updated_at + interval '1 microsecond');
  else
    new.updated_at := old.updated_at;
  end if;
  return new;
end $$;

-- Блокировка строки и ожидаемая версия защищают от двух администраторов и устаревшей вкладки.
create or replace function public.set_payout_paid(p_id uuid, p_paid boolean, p_expected_updated_at timestamptz)
returns json
language plpgsql security definer set search_path = '' as $$
declare v_row public.payouts; v_previous text := current_setting('app.payout_transition', true);
begin
  if auth.uid() is null or not (select private.is_admin()) then
    raise exception 'Выдачу подтверждает только активный администратор' using errcode = '42501';
  end if;
  if p_paid is null or p_expected_updated_at is null then
    raise exception 'Обновите запись перед подтверждением выдачи' using errcode = '22023';
  end if;
  select * into v_row from public.payouts where id = p_id for update;
  if not found then raise exception 'Запись больше недоступна' using errcode = 'P0002'; end if;
  -- Повтор того же действия после потери ответа безопасен; никаких новых отметок/дат.
  if (v_row.status = 'paid') = p_paid then return row_to_json(v_row); end if;
  if v_row.updated_at is distinct from p_expected_updated_at then
    raise exception 'Запись уже изменилась. Обновите список и проверьте сумму' using errcode = '40001';
  end if;
  perform set_config('app.payout_transition', '1', true);
  update public.payouts set status = case when p_paid then 'paid'::public.payout_status else 'to_pay'::public.payout_status end
   where id = p_id returning * into v_row;
  perform set_config('app.payout_transition', coalesce(v_previous, ''), true);
  return row_to_json(v_row);
end $$;
revoke all on function public.set_payout_paid(uuid, boolean, timestamptz) from public, anon;
grant execute on function public.set_payout_paid(uuid, boolean, timestamptz) to authenticated;

create or replace function private.guard_paid_delete() returns trigger
language plpgsql set search_path = '' as $$
begin
  if old.status = 'paid' then
    raise exception 'Сначала отмените отметку о выдаче. История выплаты должна сохраниться' using errcode = '23514';
  end if;
  return old;
end $$;
revoke all on function private.guard_paid_delete() from public, anon, authenticated;
create trigger payouts_guard_delete before delete on public.payouts
for each row execute function private.guard_paid_delete();

-- Смена контрагента или отмена накладной не должна оставлять чужие связи.
create or replace function private.detach_invalid_doc_links() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_previous text := current_setting('app.import_1c', true);
begin
  if new.kind <> 'in' then return null; end if;
  perform set_config('app.import_1c', '1', true);
  update public.payouts set doc_id = null
   where doc_id = new.id and (new.deleted or rep_id <> new.rep_id);
  update public.orders set doc_id = null, actual_amount = null
   where doc_id = new.id and (new.deleted or rep_id <> new.rep_id);
  perform set_config('app.import_1c', coalesce(v_previous, ''), true);
  return null;
end $$;
revoke all on function private.detach_invalid_doc_links() from public, anon, authenticated;
create trigger docs_detach_invalid_links after update of rep_id, deleted on public.docs
for each row when (old.rep_id is distinct from new.rep_id or (not old.deleted and new.deleted))
execute function private.detach_invalid_doc_links();

create or replace function private.recalc_open(p_reps uuid[])
returns void
language sql security definer set search_path = '' as $$
  with inv as (
    select d.id, d.rep_id, d.doc_at, d.inc from public.docs d
     where d.rep_id = any(p_reps) and d.kind = 'in' and not d.deleted
  ), lnk as (
    select p.basis_id as id, sum(p.dec - p.inc) as s
      from public.docs p join inv on inv.id = p.basis_id and inv.rep_id = p.rep_id
     where not p.deleted and p.kind <> 'in'
     group by p.basis_id
  ), rem as (
    select inv.id, inv.rep_id, inv.doc_at,
           greatest(inv.inc - coalesce(l.s, 0), 0) as rem, greatest(coalesce(l.s, 0) - inv.inc, 0) as over
      from inv left join lnk l using (id)
  ), unl as (   -- оплаты, возвраты и прочее без основания среди этих накладных
    select o.rep_id, sum(o.dec) - sum(o.inc) as s
      from public.docs o left join inv i on i.id = o.basis_id and i.rep_id = o.rep_id
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

revoke all on function private.recalc_open(uuid[]) from public, anon, authenticated;

-- Невыданные записи пересчитываются по связанным РКО; вручную подтверждённые — неизменны.
update public.payouts set reserved_amount = 0 where status <> 'paid' and amount between 0.01 and 9999999999.99;

create or replace function public.reconcile(p_reps uuid[])
returns json
language plpgsql security definer set search_path = '' as $$
declare n_orders int := 0; n_link int := 0; n_link2 int := 0; n_reserved int := 0; v_reserved_before uuid[];
begin
  if not (select private.is_admin()) then
    raise exception 'Сверка 1С — только для администратора' using errcode = '42501';
  end if;
  if cardinality(p_reps) > 200 then raise exception 'Слишком много поставщиков за раз'; end if;

  -- Один поставщик не сверяется параллельно в двух вкладках; порядок блокировок общий.
  perform pg_advisory_xact_lock(hashtextextended('sverka-reconcile:' || x::text, 0))
    from (select distinct unnest(p_reps) x order by 1) locked;
  select coalesce(array_agg(id), '{}') into v_reserved_before from public.payouts
   where rep_id = any(p_reps) and status = 'reserved';
  perform private.recalc_open(p_reps);
  perform set_config('app.import_1c', '1', true);

  -- Записи на выплату ↔ приходные: по номеру накладной
  with cand as (
    select p.id pid, d.id did
      from public.payouts p
      join public.docs d on d.rep_id = p.rep_id and d.kind = 'in' and not d.deleted
     where p.rep_id = any(p_reps) and p.doc_id is null and not p.link_review_required and p.invoice_no is not null
       and (lower(btrim(d.in_no)) = lower(btrim(p.invoice_no))
         or lower(d.num) = lower(btrim(p.invoice_no))
         or (length(regexp_replace(p.invoice_no, '\D', '', 'g')) >= 3
             and regexp_replace(d.num, '\D', '', 'g') like '%' || regexp_replace(p.invoice_no, '\D', '', 'g')))
       and not exists (select 1 from public.payouts x where x.doc_id = d.id)
  ), unique_links as (
    select pid, did from cand
     where pid in (select pid from cand group by pid having count(*) = 1)
       and did in (select did from cand group by did having count(*) = 1)
  )
  update public.payouts p set doc_id = c.did from unique_links c where p.id = c.pid;
  get diagnostics n_link = row_count;
  -- …иначе по точной сумме — только когда пара однозначна в обе стороны
  with pairs as (
    select p.id pid, d.id did
      from public.payouts p
      join public.docs d on d.rep_id = p.rep_id and d.kind = 'in' and not d.deleted and d.inc = p.amount
       and d.doc_at::date between p.created_at::date - 60 and greatest(p.payout_date, p.created_at::date) + 1
       and not exists (select 1 from public.payouts x where x.doc_id = d.id)
     where p.rep_id = any(p_reps) and p.doc_id is null and not p.link_review_required and p.invoice_no is null
  ), ok as (
    select pid, did from pairs
     where pid in (select pid from pairs group by pid having count(*) = 1)
       and did in (select did from pairs group by did having count(*) = 1)
  )
  update public.payouts p set doc_id = ok.did from ok where p.id = ok.pid;
  get diagnostics n_link2 = row_count;

  -- Нулевой остаток по накладной не означает выдачу наличных.
  -- Триггер вычисляет резерв только из связанных РКО; подтверждённую выдачу не трогаем.
  with changed as (
    select p.id, least(p.amount, greatest(coalesce(sum(r.dec - r.inc), 0), 0)) reserved,
           case when sum(r.dec - r.inc) > 0 then max(r.doc_at) at time zone 'Europe/Moscow' end at
      from public.payouts p
      left join public.docs i on i.id = p.doc_id and i.rep_id = p.rep_id and i.kind = 'in' and not i.deleted
      left join public.docs r on r.basis_id = i.id and r.rep_id = i.rep_id and r.kind = 'pay'
        and r.title = 'Расходный кассовый ордер' and not r.deleted
     where p.rep_id = any(p_reps) and p.status <> 'paid'
     group by p.id
  )
  update public.payouts p set reserved_amount = c.reserved from changed c
   where p.id = c.id and (p.reserved_amount is distinct from c.reserved or p.reserved_at is distinct from c.at
     or (p.status = 'reserved') is distinct from (c.reserved > 0));
  select count(*) into n_reserved from public.payouts
   where rep_id = any(p_reps) and status = 'reserved' and not (id = any(v_reserved_before));

  -- Заказ и приход связываются только при единственной паре в обе стороны.
  with pairs as (
    select o.id oid, d.id did
      from public.orders o join public.docs d on d.rep_id = o.rep_id and d.kind = 'in' and not d.deleted
       and d.doc_at::date between o.order_date and coalesce(o.expected_date, o.order_date) + 14
     where o.rep_id = any(p_reps) and o.doc_id is null and o.status in ('ordered', 'delivered')
       and o.order_date >= current_date - 180
       and not exists (select 1 from public.orders x where x.doc_id = d.id)
  ), unique_links as (
    select oid, did from pairs
     where oid in (select oid from pairs group by oid having count(*) = 1)
       and did in (select did from pairs group by did having count(*) = 1)
  )
  update public.orders o set doc_id = d.id, actual_amount = d.inc, status = 'delivered',
         delivered_at = case when o.status = 'delivered' then o.delivered_at else d.doc_at at time zone 'Europe/Moscow' end
    from unique_links c join public.docs d on d.id = c.did where o.id = c.oid;
  get diagnostics n_orders = row_count;
  update public.orders o set actual_amount = d.inc from public.docs d
   where o.doc_id = d.id and o.rep_id = any(p_reps) and o.actual_amount is distinct from d.inc;
  perform set_config('app.import_1c', '0', true);
  return json_build_object('orders', n_orders, 'payouts_linked', n_link + n_link2, 'payouts_reserved', n_reserved, 'payouts_paid', 0);
end $$;
revoke all on function public.reconcile(uuid[]) from public, anon;
grant execute on function public.reconcile(uuid[]) to authenticated;

create or replace function private.rep_data(p_rep uuid) returns json
language plpgsql stable security definer set search_path = '' as $$
declare v_rep public.reps;
begin
  select r.* into v_rep from public.reps r where r.id = p_rep and r.active;
  if not found then return null; end if;
  return json_build_object(
    'rep', json_build_object('full_name', v_rep.full_name, 'company', v_rep.company),
    'shop', (select case when count(*) = 1 then max(s.name) end from public.stores s),
    'orders', coalesce((select json_agg(json_build_object(
        'id', o.id, 'order_no', o.order_no, 'date', o.order_date, 'expected', o.expected_date,
        'amount', o.amount, 'actual', o.actual_amount, 'status', o.status, 'delivered_at', o.delivered_at,
        'comment', o.comment, 'store', s.name) order by o.order_date desc, o.created_at desc)
      from public.orders o left join public.stores s on s.id = o.store_id
      where o.rep_id = v_rep.id), '[]'::json),
    'payouts', coalesce((select json_agg(json_build_object(
        'id', p.id, 'date', p.payout_date, 'amount', p.amount, 'status', p.status,
        'invoice_no', p.invoice_no, 'basis', p.basis, 'comment', p.comment, 'paid_at', p.paid_at,
        'received_at', p.received_at, 'reserved_at', p.reserved_at, 'reserved_amount', p.reserved_amount, 'store', s.name) order by p.payout_date desc, p.created_at desc)
      from public.payouts p left join public.stores s on s.id = p.store_id
      where p.rep_id = v_rep.id), '[]'::json),
    'docs', coalesce((select json_agg(json_build_object('id', d.id, 'kind', d.kind, 'title', d.title, 'num', d.num, 'in_no', d.in_no,
        'at', d.doc_at, 'amount', d.inc + d.dec, 'inc', d.inc, 'dec', d.dec, 'open', d.open_amount) order by d.doc_at desc)
      from public.docs d where d.rep_id = v_rep.id and not d.deleted
       and d.doc_at >= now() - interval '180 days'), '[]'::json),
    'debt', (select sum(d.inc) - sum(d.dec) from public.docs d where d.rep_id = v_rep.id and not d.deleted)
  );
end $$;
revoke all on function private.rep_data(uuid) from public, anon, authenticated;

create or replace function public.get_payout_schedule(p_token text) returns json
language plpgsql stable security definer set search_path = '' as $$
begin
  if p_token is null or length(p_token) < 32
     or not exists (select 1 from private.shared_link where token = p_token) then
    return null;
  end if;
  return coalesce((select json_agg(json_build_object(
      'id', p.id, 'rep_id', r.id, 'rep', r.full_name, 'company', r.company, 'date', p.payout_date,
      'amount', p.amount, 'status', p.status, 'reserved_amount', p.reserved_amount, 'invoice_no', p.invoice_no, 'basis', p.basis, 'store', s.name)
      order by p.payout_date, r.full_name)
    from public.payouts p
    join public.reps r on r.id = p.rep_id and r.active
    left join public.stores s on s.id = p.store_id
    where p.status <> 'paid'), '[]'::json);
end $$;
revoke all on function public.get_payout_schedule(text) from public, authenticated;
grant execute on function public.get_payout_schedule(text) to anon;

