-- Учётные записи представителей (логин и пароль) — по желанию администратора, вместо или вместе с личной ссылкой.
-- Представитель видит только своё: заказы, записи на выплату, накладные, оплаты и возвраты 1С, долг, «Получил».
-- В таблицы напрямую он не ходит: политики пускают только сотрудников, а данные отдаёт my_rep_data().
-- Учётки создаёт и меняет только функция staff-admin (ключ сервиса), браузер админа их только читает.

create table public.rep_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  rep_id uuid not null unique references public.reps(id) on delete cascade,
  login text not null unique check (login ~ '^[a-z0-9._-]{3,32}$'),
  active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.rep_users enable row level security;
create policy rep_users_admin_read on public.rep_users for select to authenticated using ((select private.is_admin()));
revoke all on public.rep_users from anon, authenticated;
grant select on public.rep_users to authenticated;

-- Данные кабинета — одна функция для ссылки и для учётки
create or replace function private.rep_data(p_rep uuid) returns json
language plpgsql stable security definer set search_path = '' as $$
declare v_rep public.reps;
begin
  select r.* into v_rep from public.reps r where r.id = p_rep and r.active;
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
revoke all on function private.rep_data(uuid) from public, anon, authenticated;

create or replace function private.rep_confirm(p_rep uuid, p_id uuid) returns timestamptz
language plpgsql security definer set search_path = '' as $$
declare v_at timestamptz;
begin
  if p_rep is null or p_id is null then return null; end if;
  perform set_config('app.rep_confirm', '1', true);
  update public.payouts set received_at = coalesce(received_at, now())
   where id = p_id and rep_id = p_rep and status = 'paid'
  returning received_at into v_at;
  perform set_config('app.rep_confirm', '0', true);
  return v_at;
end $$;
revoke all on function private.rep_confirm(uuid, uuid) from public, anon, authenticated;

-- По ссылке (как раньше)
create or replace function public.get_rep_data(p_token text) returns json
language plpgsql stable security definer set search_path = '' as $$
declare v_rep uuid;
begin
  if p_token is null or length(p_token) < 32 then return null; end if;
  select a.rep_id into v_rep from public.rep_access a where a.token = p_token;
  return private.rep_data(v_rep);
end $$;
revoke all on function public.get_rep_data(text) from public, authenticated;
grant execute on function public.get_rep_data(text) to anon;

create or replace function public.confirm_receipt(p_token text, p_id uuid) returns timestamptz
language plpgsql security definer set search_path = '' as $$
declare v_rep uuid;
begin
  if p_token is null or length(p_token) < 32 then return null; end if;
  select a.rep_id into v_rep from public.rep_access a join public.reps r on r.id = a.rep_id
   where a.token = p_token and r.active;
  return private.rep_confirm(v_rep, p_id);
end $$;
revoke all on function public.confirm_receipt(text, uuid) from public, authenticated;
grant execute on function public.confirm_receipt(text, uuid) to anon;

-- По логину и паролю: представитель определяется только по своей учётке
create or replace function private.my_rep() returns uuid
language sql stable security definer set search_path = '' as $$
  select u.rep_id from public.rep_users u join public.reps r on r.id = u.rep_id
   where u.user_id = (select auth.uid()) and u.active and r.active
$$;
revoke all on function private.my_rep() from public, anon, authenticated;

create or replace function public.my_rep_data() returns json
language plpgsql stable security definer set search_path = '' as $$
declare v_rep uuid := private.my_rep();
begin
  if v_rep is null then return null; end if;
  return (private.rep_data(v_rep)::jsonb || jsonb_build_object('login',
    (select u.login from public.rep_users u where u.user_id = (select auth.uid()))))::json;
end $$;
revoke all on function public.my_rep_data() from public, anon;
grant execute on function public.my_rep_data() to authenticated;

create or replace function public.my_confirm_receipt(p_id uuid) returns timestamptz
language plpgsql security definer set search_path = '' as $$
begin
  return private.rep_confirm(private.my_rep(), p_id);
end $$;
revoke all on function public.my_confirm_receipt(uuid) from public, anon;
grant execute on function public.my_confirm_receipt(uuid) to authenticated;

-- Админу — список учёток в общих данных
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
    'rep_users', case when v_admin then coalesce((select json_agg(json_build_object('rep_id', u.rep_id, 'user_id', u.user_id,
              'login', u.login, 'active', u.active)) from public.rep_users u), '[]'::json) end,
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
