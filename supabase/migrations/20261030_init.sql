-- Схема «Записи на выплату» (применена к проекту Supabase yxgbfvpxpbsoxnyokmce)
create extension if not exists pgcrypto with schema extensions;

create table public.admins (
  email text primary key check (email = lower(email))
);

create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

create or replace function private.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.admins a
    where a.email = lower(coalesce((select auth.jwt()) ->> 'email', ''))
  ) and coalesce(((select auth.jwt()) ->> 'email_verified')::boolean, true)
$$;
revoke all on function private.is_admin() from public, anon;
grant execute on function private.is_admin() to authenticated;

create table public.reps (
  id uuid primary key default gen_random_uuid(),
  full_name text not null check (length(trim(full_name)) > 0),
  phone text,
  access_token text not null unique default encode(extensions.gen_random_bytes(18), 'hex'),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.stores (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (length(trim(name)) > 0),
  address text,
  created_at timestamptz not null default now()
);

create type public.payout_status as enum ('accrued', 'to_pay', 'paid');

create table public.payouts (
  id uuid primary key default gen_random_uuid(),
  rep_id uuid not null references public.reps(id) on delete restrict,
  store_id uuid references public.stores(id) on delete restrict,
  payout_date date not null default current_date,
  amount numeric(12,2) not null check (amount > 0),
  status public.payout_status not null default 'accrued',
  basis text,
  comment text,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index payouts_rep_date_idx on public.payouts (rep_id, payout_date desc);
create index payouts_store_idx on public.payouts (store_id);

create or replace function public.payouts_touch() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  if new.status = 'paid' and (tg_op = 'INSERT' or old.status is distinct from 'paid') then
    new.paid_at := coalesce(new.paid_at, now());
  elsif new.status <> 'paid' then
    new.paid_at := null;
  end if;
  return new;
end $$;
create trigger payouts_touch before insert or update on public.payouts
for each row execute function public.payouts_touch();

alter table public.admins enable row level security;
alter table public.reps enable row level security;
alter table public.stores enable row level security;
alter table public.payouts enable row level security;

create policy admins_self_read on public.admins for select to authenticated
  using (email = lower(coalesce((select auth.jwt()) ->> 'email', '')));
create policy reps_admin_all on public.reps for all to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));
create policy stores_admin_all on public.stores for all to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));
create policy payouts_admin_all on public.payouts for all to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));

-- Кабинет представителя: только по секретному токену, прямого доступа к таблицам нет
create or replace function public.get_rep_payouts(p_token text) returns json
language plpgsql stable security definer set search_path = '' as $$
declare v_rep public.reps;
begin
  if p_token is null or length(p_token) < 32 then return null; end if;
  select * into v_rep from public.reps where access_token = p_token and active;
  if not found then return null; end if;
  return json_build_object(
    'rep', json_build_object('full_name', v_rep.full_name),
    'payouts', coalesce((
      select json_agg(json_build_object(
        'id', p.id, 'date', p.payout_date, 'amount', p.amount, 'status', p.status,
        'basis', p.basis, 'comment', p.comment, 'paid_at', p.paid_at,
        'store', s.name) order by p.payout_date desc, p.created_at desc)
      from public.payouts p left join public.stores s on s.id = p.store_id
      where p.rep_id = v_rep.id), '[]'::json)
  );
end $$;
revoke all on function public.get_rep_payouts(text) from public;
grant execute on function public.get_rep_payouts(text) to anon, authenticated;

insert into public.admins (email) values ('dexauron@gmail.com');
