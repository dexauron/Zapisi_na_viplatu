-- История изменений: кто, когда и что поменял в заказах, выплатах, представителях и магазинах.
create table public.audit_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  user_id uuid default auth.uid(),
  entity text not null,            -- orders | payouts | reps | stores | import
  entity_id uuid,
  action text not null,            -- insert | update | delete | import
  rep_id uuid,                     -- для быстрого поиска истории представителя
  data jsonb,                      -- снимок строки (после изменения; для удаления — до)
  changes jsonb                    -- {поле: [было, стало]} для update
);
create index audit_log_at_idx on public.audit_log (at desc);
create index audit_log_entity_idx on public.audit_log (entity, entity_id);
create index audit_log_rep_idx on public.audit_log (rep_id, at desc);
alter table public.audit_log enable row level security;
-- админ видит всё; сотрудник — только историю заказов
create policy audit_read on public.audit_log for select to authenticated
  using ((select private.is_admin()) or (entity = 'orders' and (select private.is_staff())));

create or replace function private.audit() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_new jsonb; v_old jsonb; v_changes jsonb; v_rep uuid; k text;
  skip text[] := array['updated_at', 'updated_by', 'created_at', 'created_by', 'delivered_at', 'paid_at'];
begin
  -- массовая загрузка справочника пишет одну строку итога, а не сотни
  if current_setting('app.bulk_import', true) = '1' then return null; end if;
  v_new := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  v_old := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  if tg_op = 'UPDATE' then
    v_changes := '{}'::jsonb;
    for k in select jsonb_object_keys(v_new) loop
      if not (k = any(skip)) and v_new -> k is distinct from v_old -> k then
        v_changes := v_changes || jsonb_build_object(k, jsonb_build_array(v_old -> k, v_new -> k));
      end if;
    end loop;
    if v_changes = '{}'::jsonb then return null; end if;
  end if;
  v_rep := (coalesce(v_new, v_old) ->> case when tg_table_name = 'reps' then 'id' else 'rep_id' end)::uuid;
  insert into public.audit_log (entity, entity_id, action, rep_id, data, changes)
  values (tg_table_name, ((coalesce(v_new, v_old)) ->> 'id')::uuid, lower(tg_op), v_rep, coalesce(v_new, v_old), v_changes);
  return null;
end $$;

create trigger orders_audit after insert or update or delete on public.orders for each row execute function private.audit();
create trigger payouts_audit after insert or update or delete on public.payouts for each row execute function private.audit();
create trigger reps_audit after insert or update or delete on public.reps for each row execute function private.audit();
create trigger stores_audit after insert or update or delete on public.stores for each row execute function private.audit();

-- Загрузка из 1С: без построчной истории, одна запись с итогом
create or replace function public.import_reps(p_rows jsonb, p_deactivate_missing boolean default false)
returns json
language plpgsql security definer set search_path = '' as $$
declare
  r jsonb; v_key text; v_name text; v_company text; v_phone text; v_rep public.reps;
  n_added int := 0; n_updated int := 0; n_same int := 0; n_off int := 0; n_skipped int := 0;
  v_keys text[] := '{}'; v_res json;
begin
  if not (select private.is_admin()) then
    raise exception 'Загрузка справочника — только для администратора' using errcode = '42501';
  end if;
  if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) = 0 then
    raise exception 'В файле нет строк';
  end if;
  if jsonb_array_length(p_rows) > 5000 then
    raise exception 'Слишком много строк (больше 5000)';
  end if;
  perform set_config('app.bulk_import', '1', true);

  for r in select value from jsonb_array_elements(p_rows) loop
    v_key := left(lower(btrim(r ->> 'key')), 300);
    v_name := left(btrim(r ->> 'full_name'), 200);
    v_company := nullif(left(btrim(r ->> 'company'), 200), '');
    v_phone := nullif(left(btrim(r ->> 'phone'), 200), '');
    if coalesce(v_key, '') = '' or coalesce(v_name, '') = '' or v_key = any(v_keys) then
      n_skipped := n_skipped + 1; continue;
    end if;
    v_keys := v_keys || v_key;

    select * into v_rep from public.reps where ext_key = v_key;
    if not found then
      select * into v_rep from public.reps
       where ext_key is null
         and (lower(btrim(full_name)) = v_key or lower(btrim(coalesce(company || ' тп ', '') || full_name)) = v_key)
       limit 1;
    end if;

    if v_rep.id is null then
      insert into public.reps (full_name, company, phone, ext_key) values (v_name, v_company, v_phone, v_key);
      n_added := n_added + 1;
    elsif v_rep.full_name is distinct from v_name or v_rep.company is distinct from v_company
       or v_rep.phone is distinct from v_phone or v_rep.ext_key is distinct from v_key then
      update public.reps set full_name = v_name, company = v_company, phone = v_phone, ext_key = v_key where id = v_rep.id;
      n_updated := n_updated + 1;
    else
      n_same := n_same + 1;
    end if;
    v_rep := null;
  end loop;

  if p_deactivate_missing then
    update public.reps set active = false
     where ext_key is not null and active and not (ext_key = any(v_keys));
    get diagnostics n_off = row_count;
  end if;

  perform set_config('app.bulk_import', '0', true);
  v_res := json_build_object('added', n_added, 'updated', n_updated, 'same', n_same, 'deactivated', n_off, 'skipped', n_skipped);
  insert into public.audit_log (entity, action, data) values ('import', 'import', v_res::jsonb);
  return v_res;
end $$;
revoke all on function public.import_reps(jsonb, boolean) from public, anon;
grant execute on function public.import_reps(jsonb, boolean) to authenticated;
