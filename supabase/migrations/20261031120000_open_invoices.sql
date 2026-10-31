-- Долг по накладным: все приходные, не закрытые расходниками (оплатами) в 1С, — с записью на выплату и без.
-- open_amount считает reconcile: оплаты по основанию — на свою накладную, остальное — на самые старые.

create or replace function public.open_invoices() returns json
language plpgsql stable security definer set search_path = '' as $$
begin
  if not (select private.is_admin()) then raise exception 'Нет доступа' using errcode = '42501'; end if;
  return coalesce((select json_agg(json_build_object('id', d.id, 'rep_id', d.rep_id, 'in_no', d.in_no, 'at', d.doc_at,
      'inc', d.inc, 'open', d.open_amount, 'pay_due', d.pay_due, 'rec', p.status) order by d.doc_at)
    from public.docs d
    left join lateral (select x.status from public.payouts x where x.doc_id = d.id limit 1) p on true
   where d.kind = 'in' and not d.deleted and d.open_amount > 0), '[]'::json);
end $$;
revoke all on function public.open_invoices() from public, anon;
grant execute on function public.open_invoices() to authenticated;

-- Запуск: + итог долга по накладным для «Сегодня»
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
    'open1c', case when v_admin then (select json_build_object('n', count(*), 'sum', coalesce(sum(d.open_amount), 0),
              'since', min(d.doc_at)::date)
              from public.docs d where d.kind = 'in' and not d.deleted and d.open_amount > 0) end,
    'db_mb', case when v_admin then (select round(pg_database_size(current_database()) / 1048576.0)) end
  );
end $$;
revoke all on function public.app_bootstrap() from public, anon;
grant execute on function public.app_bootstrap() to authenticated;
