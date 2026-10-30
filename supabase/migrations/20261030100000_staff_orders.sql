-- v2: сотрудники и роли, заказы, токены ТП в отдельной таблице, кабинет ТП (заказы + выплаты)
create type public.staff_role as enum ('admin', 'employee');
create table public.staff (
  user_id uuid primary key references auth.users(id) on delete cascade,
  login text not null unique,
  full_name text not null check (length(trim(full_name)) > 0),
  role public.staff_role not null default 'employee',
  active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.staff enable row level security;

create or replace function private.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.staff s
    where s.user_id = (select auth.uid()) and s.role = 'admin' and s.active)
$$;
create or replace function private.is_staff() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.staff s
    where s.user_id = (select auth.uid()) and s.active)
$$;
revoke all on function private.is_staff() from public, anon;
grant execute on function private.is_staff() to authenticated;

create policy staff_read on public.staff for select to authenticated using ((select private.is_staff()));

-- Первый вход владельца: email из admins получает профиль админа
create or replace function public.ensure_profile() returns json
language plpgsql security definer set search_path = '' as $$
declare v_email text := lower(coalesce((select auth.jwt()) ->> 'email', ''));
begin
  if (select auth.uid()) is null then return null; end if;
  if not exists (select 1 from public.staff where user_id = (select auth.uid()))
     and exists (select 1 from public.admins where email = v_email) then
    insert into public.staff(user_id, login, full_name, role)
    values ((select auth.uid()), v_email, split_part(v_email, '@', 1), 'admin');
  end if;
  return (select row_to_json(s) from (select user_id, login, full_name, role, active
          from public.staff where user_id = (select auth.uid())) s);
end $$;
revoke all on function public.ensure_profile() from public, anon;
grant execute on function public.ensure_profile() to authenticated;

-- Представители: компания + токены в закрытой таблице (сотрудники их не видят)
alter table public.reps add column company text;
create table public.rep_access (
  rep_id uuid primary key references public.reps(id) on delete cascade,
  token text not null unique default encode(extensions.gen_random_bytes(18), 'hex')
);
insert into public.rep_access(rep_id, token) select id, access_token from public.reps;
alter table public.reps drop column access_token;
alter table public.rep_access enable row level security;
create policy rep_access_admin on public.rep_access for all to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));

create or replace function private.rep_access_create() returns trigger
language plpgsql security definer set search_path = '' as $$
begin insert into public.rep_access(rep_id) values (new.id) on conflict do nothing; return new; end $$;
create trigger reps_access_create after insert on public.reps
for each row execute function private.rep_access_create();

drop policy reps_admin_all on public.reps;
create policy reps_read on public.reps for select to authenticated using ((select private.is_staff()));
create policy reps_insert on public.reps for insert to authenticated with check ((select private.is_staff()));
create policy reps_update on public.reps for update to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));
create policy reps_delete on public.reps for delete to authenticated using ((select private.is_admin()));

drop policy stores_admin_all on public.stores;
create policy stores_read on public.stores for select to authenticated using ((select private.is_staff()));
create policy stores_insert on public.stores for insert to authenticated with check ((select private.is_staff()));
create policy stores_update on public.stores for update to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));
create policy stores_delete on public.stores for delete to authenticated using ((select private.is_admin()));

-- Заказы
create type public.order_status as enum ('ordered', 'delivered', 'cancelled');
create table public.orders (
  id uuid primary key default gen_random_uuid(),
  rep_id uuid not null references public.reps(id) on delete restrict,
  store_id uuid references public.stores(id) on delete restrict,
  order_no text,
  order_date date not null default current_date,
  expected_date date,
  amount numeric(12,2) not null check (amount > 0),
  status public.order_status not null default 'ordered',
  delivered_at timestamptz,
  comment text,
  created_by uuid default auth.uid() references public.staff(user_id) on delete set null,
  updated_by uuid references public.staff(user_id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (expected_date is null or expected_date >= order_date)
);
create index orders_rep_date_idx on public.orders (rep_id, order_date desc);
create index orders_status_expected_idx on public.orders (status, expected_date);
create index orders_store_idx on public.orders (store_id);
create index orders_created_by_idx on public.orders (created_by);
create index orders_updated_by_idx on public.orders (updated_by);

create or replace function public.orders_touch() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  if tg_op = 'UPDATE' then
    new.created_by := old.created_by;
    new.created_at := old.created_at;
    new.updated_by := (select auth.uid());
  end if;
  if new.status = 'delivered' and (tg_op = 'INSERT' or old.status is distinct from 'delivered') then
    new.delivered_at := coalesce(new.delivered_at, now());
  elsif new.status <> 'delivered' then
    new.delivered_at := null;
  end if;
  return new;
end $$;
create trigger orders_touch before insert or update on public.orders
for each row execute function public.orders_touch();

alter table public.orders enable row level security;
create policy orders_read on public.orders for select to authenticated using ((select private.is_staff()));
create policy orders_insert on public.orders for insert to authenticated
  with check ((select private.is_staff()) and created_by = (select auth.uid()));
create policy orders_update on public.orders for update to authenticated
  using ((select private.is_staff())) with check ((select private.is_staff()));
create policy orders_delete on public.orders for delete to authenticated using ((select private.is_admin()));

-- Кабинет ТП: заказы + выплаты по токену
drop function public.get_rep_payouts(text);
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
        'basis', p.basis, 'comment', p.comment, 'paid_at', p.paid_at,
        'store', s.name) order by p.payout_date desc, p.created_at desc)
      from public.payouts p left join public.stores s on s.id = p.store_id
      where p.rep_id = v_rep.id), '[]'::json)
  );
end $$;
revoke all on function public.get_rep_data(text) from public, authenticated;
grant execute on function public.get_rep_data(text) to anon;
