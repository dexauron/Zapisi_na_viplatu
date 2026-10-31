-- Загрузка 1С: завершение укладывается в лимит времени запроса.
-- Причина сбоя: сразу после пачек import_docs у private.import_seen и public.docs устаревшая статистика,
-- и finish_import выполнялся дольше 8 секунд (statement timeout роли authenticated). Теперь — analyze перед работой.

create or replace function public.finish_import(p_import uuid, p_scopes jsonb, p_files jsonb default '[]'::jsonb)
returns json
language plpgsql security definer set search_path = '' as $$
declare
  sc jsonb; v_titles text[]; v_from date; v_to date; v_by_reps boolean;
  v_reps uuid[]; v_del_reps uuid[]; n_scope int; n_miss int; n_del int := 0; v_skipped text[] := '{}'; v_res jsonb;
begin
  if not (select private.is_admin()) then
    raise exception 'Загрузка из 1С — только для администратора' using errcode = '42501';
  end if;
  -- свежая статистика: после пачек на десятки тысяч строк без неё планировщик выбирает перебор
  -- «каждый с каждым», и запрос не укладывается в 8 секунд
  analyze private.import_seen;
  analyze public.docs;
  select coalesce(array_agg(distinct d.rep_id), '{}') into v_reps
    from private.import_seen s join public.docs d on d.title = s.title and d.num = s.num and d.year = s.year
   where s.import_id = p_import;

  -- Пропавшие из 1С за загруженный период
  for sc in select value from jsonb_array_elements(coalesce(p_scopes, '[]'::jsonb)) loop
    select coalesce(array_agg(t), '{}') into v_titles from jsonb_array_elements_text(sc -> 'titles') t;
    v_from := (sc ->> 'from')::date; v_to := (sc ->> 'to')::date; v_by_reps := coalesce((sc ->> 'by_reps')::boolean, false);
    continue when v_from is null or v_to is null or cardinality(v_titles) = 0;
    select count(*), count(*) filter (where not exists (select 1 from private.import_seen s
             where s.import_id = p_import and s.title = d.title and s.num = d.num and s.year = d.year))
      into n_scope, n_miss
      from public.docs d
     where d.title = any(v_titles) and d.doc_at::date between v_from and v_to and not d.deleted
       and (not v_by_reps or d.rep_id = any(v_reps));
    -- защита от неполного файла (выгрузка с отбором): не помечать массово
    if n_miss > 10 and n_miss > n_scope * 0.2 then
      v_skipped := v_skipped || (array_to_string(v_titles, ', ') || ': ' || n_miss);
      continue;
    end if;
    with del as (
      update public.docs d set deleted = true
       where d.title = any(v_titles) and d.doc_at::date between v_from and v_to and not d.deleted
         and (not v_by_reps or d.rep_id = any(v_reps))
         and not exists (select 1 from private.import_seen s
               where s.import_id = p_import and s.title = d.title and s.num = d.num and s.year = d.year)
      returning d.rep_id)
    select count(*), coalesce(array_agg(distinct rep_id), '{}') into n_miss, v_del_reps from del;
    n_del := n_del + n_miss;
    v_reps := array(select distinct x from unnest(v_reps || v_del_reps) x);
  end loop;

  -- Основания оплат и возвратов
  update public.docs p set basis_id = i.id
    from public.docs i
   where p.rep_id = any(v_reps) and p.basis_key is not null
     and i.title = split_part(p.basis_key, '|', 1) and i.num = split_part(p.basis_key, '|', 2)
     and i.year = nullif(split_part(p.basis_key, '|', 3), '')::smallint
     and p.basis_id is distinct from i.id;

  delete from private.import_seen where import_id = p_import;
  delete from private.import_seen where at < now() - interval '1 day';   -- брошенные загрузки
  v_res := jsonb_build_object('deleted', n_del, 'not_deleted', v_skipped);
  insert into public.audit_log (entity, action, data)
  values ('import', 'import', jsonb_build_object('kind', 'docs', 'files', p_files, 'reps', cardinality(v_reps)) || v_res);
  return v_res || jsonb_build_object('reps', to_jsonb(v_reps));
end $$;
revoke all on function public.finish_import(uuid, jsonb, jsonb) from public, anon;
grant execute on function public.finish_import(uuid, jsonb, jsonb) to authenticated;
