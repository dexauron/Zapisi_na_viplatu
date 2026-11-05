-- «Сводка» для администратора: долг по 1С и его возраст, приход/оплаты/возвраты по месяцам, кто больше всего ждёт денег.
-- Плюс название магазина в кабинете представителя (если магазин один).

create or replace function public.summary_stats() returns json
language plpgsql stable security definer set search_path = '' as $$
begin
  if not (select private.is_admin()) then
    raise exception 'Сводка — только для администратора' using errcode = '42501';
  end if;
  return json_build_object(
    'debt', (select sum(d.inc) - sum(d.dec) from public.docs d where not d.deleted),
    'open', (select json_build_object('n', count(*), 'sum', coalesce(sum(d.open_amount), 0))
               from public.docs d where d.kind = 'in' and not d.deleted and d.open_amount > 0),
    -- возраст неоплаченных накладных по дате накладной: до 30, 31–60, 61–90, больше 90 дней
    'aging', (select coalesce(json_object_agg(x.b, json_build_object('n', x.n, 'sum', x.s)), '{}'::json) from (
        select case when a <= 30 then 'a' when a <= 60 then 'b' when a <= 90 then 'c' else 'd' end b, count(*) n, sum(open_amount) s
          from (select (current_date - d.doc_at::date) a, d.open_amount from public.docs d
                 where d.kind = 'in' and not d.deleted and d.open_amount > 0) y
         group by 1) x),
    'months', (select coalesce(json_agg(json_build_object('m', x.m, 'in', x.i, 'pay', x.p, 'ret', x.r) order by x.m), '[]'::json) from (
        select to_char(date_trunc('month', d.doc_at), 'YYYY-MM') m,
               coalesce(sum(d.inc) filter (where d.kind = 'in'), 0) i,
               coalesce(sum(d.dec) filter (where d.kind = 'pay'), 0) p,
               coalesce(sum(d.dec) filter (where d.kind = 'ret'), 0) r
          from public.docs d
         where not d.deleted and d.doc_at >= date_trunc('month', current_date) - interval '11 months'
         group by 1) x),
    'top', (select coalesce(json_agg(json_build_object('rep_id', x.rep_id, 'sum', x.s, 'n', x.n, 'since', x.since) order by x.s desc), '[]'::json) from (
        select d.rep_id, sum(d.open_amount) s, count(*) n, min(d.doc_at)::date since
          from public.docs d where d.kind = 'in' and not d.deleted and d.open_amount > 0
         group by d.rep_id order by 2 desc limit 10) x)
  );
end $$;
revoke all on function public.summary_stats() from public, anon;
grant execute on function public.summary_stats() to authenticated;

-- Кабинет ТП: + название магазина (когда магазин один)
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
revoke all on function private.rep_data(uuid) from public, anon, authenticated;
