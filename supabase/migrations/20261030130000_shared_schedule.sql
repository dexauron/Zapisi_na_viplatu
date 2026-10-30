-- Общая ссылка для всех торговых представителей: график невыплаченных записей на выплату.
create table private.shared_link (
  id int primary key default 1 check (id = 1),
  token text not null unique default encode(extensions.gen_random_bytes(18), 'hex'),
  created_at timestamptz not null default now()
);
insert into private.shared_link default values;

-- Админ: получить или заменить общую ссылку
create or replace function public.shared_link_token(p_reset boolean default false) returns text
language plpgsql security definer set search_path = '' as $$
declare v text;
begin
  if not (select private.is_admin()) then
    raise exception 'Только для администратора' using errcode = '42501';
  end if;
  if p_reset then
    update private.shared_link set token = encode(extensions.gen_random_bytes(18), 'hex'), created_at = now() where id = 1;
  end if;
  select token into v from private.shared_link where id = 1;
  return v;
end $$;
revoke all on function public.shared_link_token(boolean) from public, anon;
grant execute on function public.shared_link_token(boolean) to authenticated;

-- По общей ссылке: только невыплаченные записи активных представителей, без телефонов и заказов
create or replace function public.get_payout_schedule(p_token text) returns json
language plpgsql stable security definer set search_path = '' as $$
begin
  if p_token is null or length(p_token) < 32
     or not exists (select 1 from private.shared_link where token = p_token) then
    return null;
  end if;
  return coalesce((select json_agg(json_build_object(
      'id', p.id, 'rep_id', r.id, 'rep', r.full_name, 'company', r.company, 'date', p.payout_date,
      'amount', p.amount, 'status', p.status, 'basis', p.basis, 'store', s.name)
      order by p.payout_date, r.full_name)
    from public.payouts p
    join public.reps r on r.id = p.rep_id and r.active
    left join public.stores s on s.id = p.store_id
    where p.status <> 'paid'), '[]'::json);
end $$;
revoke all on function public.get_payout_schedule(text) from public, authenticated;
grant execute on function public.get_payout_schedule(text) to anon;
