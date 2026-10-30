-- Загрузка справочника представителей из выгрузки 1С «Контрагенты» (.xls/.xlsx/.csv).
-- ext_key — имя контрагента из файла (нижний регистр), по нему строки сопоставляются при повторной загрузке.
alter table public.reps add column ext_key text unique;

create or replace function public.import_reps(p_rows jsonb, p_deactivate_missing boolean default false)
returns json
language plpgsql security definer set search_path = '' as $$
declare
  r jsonb; v_key text; v_name text; v_company text; v_phone text; v_rep public.reps;
  n_added int := 0; n_updated int := 0; n_same int := 0; n_off int := 0; n_skipped int := 0;
  v_keys text[] := '{}';
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
      -- представитель, добавленный вручную до первой загрузки, с тем же именем
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

  return json_build_object('added', n_added, 'updated', n_updated, 'same', n_same, 'deactivated', n_off, 'skipped', n_skipped);
end $$;
revoke all on function public.import_reps(jsonb, boolean) from public, anon;
grant execute on function public.import_reps(jsonb, boolean) to authenticated;
