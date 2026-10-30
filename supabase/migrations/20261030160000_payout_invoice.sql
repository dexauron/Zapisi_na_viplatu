-- Выплаты: два статуса («Запись» = to_pay, «Оплачено» = paid) и номер накладной.
-- Значение enum 'accrued' остаётся (удалить значение enum нельзя), но больше не хранится:
-- триггер переводит его в 'to_pay' — старые клиенты и офлайн-очереди не получат ошибку.

alter table public.payouts add column invoice_no text
  check (invoice_no is null or length(invoice_no) between 1 and 64);
create index payouts_invoice_idx on public.payouts (invoice_no) where invoice_no is not null;

update public.payouts set status = 'to_pay' where status = 'accrued';
alter table public.payouts alter column status set default 'to_pay';

create or replace function public.payouts_touch() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  if new.status = 'accrued' then new.status := 'to_pay'; end if;
  new.invoice_no := nullif(trim(new.invoice_no), '');
  if new.status = 'paid' and (tg_op = 'INSERT' or old.status is distinct from 'paid') then
    new.paid_at := coalesce(new.paid_at, now());
  elsif new.status <> 'paid' then
    new.paid_at := null;
  end if;
  return new;
end $$;

-- Кабинет ТП: + номер накладной
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
        'amount', o.amount, 'status', o.status, 'delivered_at', o.delivered_at,
        'comment', o.comment, 'store', s.name) order by o.order_date desc, o.created_at desc)
      from public.orders o left join public.stores s on s.id = o.store_id
      where o.rep_id = v_rep.id), '[]'::json),
    'payouts', coalesce((select json_agg(json_build_object(
        'id', p.id, 'date', p.payout_date, 'amount', p.amount, 'status', p.status,
        'invoice_no', p.invoice_no, 'basis', p.basis, 'comment', p.comment, 'paid_at', p.paid_at,
        'store', s.name) order by p.payout_date desc, p.created_at desc)
      from public.payouts p left join public.stores s on s.id = p.store_id
      where p.rep_id = v_rep.id), '[]'::json)
  );
end $$;
revoke all on function public.get_rep_data(text) from public, authenticated;
grant execute on function public.get_rep_data(text) to anon;

-- Общая ссылка: + номер накладной
create or replace function public.get_payout_schedule(p_token text) returns json
language plpgsql stable security definer set search_path = '' as $$
begin
  if p_token is null or length(p_token) < 32
     or not exists (select 1 from private.shared_link where token = p_token) then
    return null;
  end if;
  return coalesce((select json_agg(json_build_object(
      'id', p.id, 'rep_id', r.id, 'rep', r.full_name, 'company', r.company, 'date', p.payout_date,
      'amount', p.amount, 'status', p.status, 'invoice_no', p.invoice_no, 'basis', p.basis, 'store', s.name)
      order by p.payout_date, r.full_name)
    from public.payouts p
    join public.reps r on r.id = p.rep_id and r.active
    left join public.stores s on s.id = p.store_id
    where p.status <> 'paid'), '[]'::json);
end $$;
revoke all on function public.get_payout_schedule(text) from public, authenticated;
grant execute on function public.get_payout_schedule(text) to anon;
