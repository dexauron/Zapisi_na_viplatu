-- Представитель подтверждает получение денег («Получил») в своём кабинете по ссылке.
-- received_at ставит только confirm_receipt; при снятии оплаты отметка сбрасывается.
alter table public.payouts add column received_at timestamptz;

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
  -- «Получил» — только из кабинета представителя
  if current_setting('app.rep_confirm', true) is distinct from '1' then
    new.received_at := case when tg_op = 'UPDATE' then old.received_at end;
  end if;
  if new.status <> 'paid' then new.received_at := null; end if;
  return new;
end $$;

create or replace function public.confirm_receipt(p_token text, p_id uuid) returns timestamptz
language plpgsql security definer set search_path = '' as $$
declare v_rep uuid; v_at timestamptz;
begin
  if p_token is null or length(p_token) < 32 or p_id is null then return null; end if;
  select a.rep_id into v_rep from public.rep_access a join public.reps r on r.id = a.rep_id
   where a.token = p_token and r.active;
  if v_rep is null then return null; end if;
  perform set_config('app.rep_confirm', '1', true);
  update public.payouts set received_at = coalesce(received_at, now())
   where id = p_id and rep_id = v_rep and status = 'paid'
  returning received_at into v_at;
  perform set_config('app.rep_confirm', '0', true);
  return v_at;
end $$;
revoke all on function public.confirm_receipt(text, uuid) from public, authenticated;
grant execute on function public.confirm_receipt(text, uuid) to anon;

-- Кабинет ТП: + «Получил»; документы всех видов (для акта сверки) с приходом и расходом отдельно
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
        'received_at', p.received_at, 'store', s.name) order by p.payout_date desc, p.created_at desc)
      from public.payouts p left join public.stores s on s.id = p.store_id
      where p.rep_id = v_rep.id), '[]'::json),
    'docs', coalesce((select json_agg(json_build_object('id', d.id, 'kind', d.kind, 'title', d.title, 'num', d.num, 'in_no', d.in_no,
        'at', d.doc_at, 'amount', d.inc + d.dec, 'inc', d.inc, 'dec', d.dec, 'open', d.open_amount) order by d.doc_at desc)
      from public.docs d where d.rep_id = v_rep.id and not d.deleted
       and d.doc_at >= now() - interval '180 days'), '[]'::json),
    'debt', (select sum(d.inc) - sum(d.dec) from public.docs d where d.rep_id = v_rep.id and not d.deleted)
  );
end $$;
revoke all on function public.get_rep_data(text) from public, authenticated;
grant execute on function public.get_rep_data(text) to anon;
