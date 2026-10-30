-- Запуск приложения одним запросом вместо шести: профиль + все данные, которые пользователю разрешены.
-- SECURITY INVOKER: действуют обычные правила RLS (сотрудник не получит выплаты и токены ссылок).
create or replace function public.app_bootstrap() returns json
language plpgsql security invoker set search_path = '' as $$
declare v_me json;
begin
  v_me := public.ensure_profile();
  if v_me is null or not (v_me ->> 'active')::boolean then
    return json_build_object('me', v_me);
  end if;
  return json_build_object(
    'me', v_me,
    'reps', coalesce((select json_agg(json_build_object('id', r.id, 'full_name', r.full_name, 'company', r.company, 'phone', r.phone,
              'active', r.active, 'ext_key', r.ext_key) order by r.full_name) from public.reps r), '[]'::json),
    'stores', coalesce((select json_agg(s order by s.name) from public.stores s), '[]'::json),
    'orders', coalesce((select json_agg(o order by o.order_date desc, o.created_at desc) from public.orders o), '[]'::json),
    'staff', coalesce((select json_agg(json_build_object('user_id', s.user_id, 'login', s.login, 'full_name', s.full_name,
              'role', s.role, 'active', s.active) order by s.full_name) from public.staff s), '[]'::json),
    'payouts', coalesce((select json_agg(p order by p.payout_date desc, p.created_at desc) from public.payouts p), '[]'::json),
    'access', coalesce((select json_agg(a) from public.rep_access a), '[]'::json)
  );
end $$;
revoke all on function public.app_bootstrap() from public, anon;
grant execute on function public.app_bootstrap() to authenticated;
