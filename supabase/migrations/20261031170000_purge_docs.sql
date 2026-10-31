-- Удаление загруженных документов 1С: период + виды (приходы, расходники/оплаты, возвраты, прочее).
-- Документы стираются полностью (без копий). Ручные записи на выплату и заказы остаются —
-- снимается только их связь с удалёнными документами. Повторная загрузка файла вернёт документы.
-- Пачками (до 5000 за вызов): укладывается в лимит 8 с; после — reconcile по затронутым поставщикам.

create or replace function public.docs_stats(p_from date, p_to date) returns json
language plpgsql stable security definer set search_path = '' as $$
begin
  if not (select private.is_admin()) then
    raise exception 'Только для администратора' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_to < p_from then return '{}'::json; end if;
  return coalesce((select json_object_agg(x.kind, json_build_object('n', x.n, 'sum', x.s, 'reps', x.r)) from (
      select d.kind, count(*) n, sum(d.inc + d.dec) s, count(distinct d.rep_id) r from public.docs d
       where d.doc_at >= p_from and d.doc_at < p_to + 1 group by d.kind) x), '{}'::json);
end $$;
revoke all on function public.docs_stats(date, date) from public, anon;
grant execute on function public.docs_stats(date, date) to authenticated;

create or replace function public.delete_docs(p_from date, p_to date, p_kinds text[],
  p_done int default 0, p_done_sum numeric default 0)
returns json
language plpgsql security definer set search_path = '' as $$
declare v_ids uuid[]; v_reps uuid[]; n int := 0; v_sum numeric := 0; v_more boolean;
begin
  if not (select private.is_admin()) then
    raise exception 'Удаление документов 1С — только для администратора' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_to < p_from then raise exception 'Укажите период'; end if;
  if coalesce(cardinality(p_kinds), 0) = 0 or not (p_kinds <@ array['in', 'pay', 'ret', 'other']) then
    raise exception 'Отметьте, какие документы удалить';
  end if;

  select array_agg(x.id), array_agg(distinct x.rep_id), coalesce(sum(x.inc + x.dec), 0)
    into v_ids, v_reps, v_sum
    from (select d.id, d.rep_id, d.inc, d.dec from public.docs d
           where d.kind = any(p_kinds) and d.doc_at >= p_from and d.doc_at < p_to + 1
           order by d.doc_at limit 5000) x;
  if v_ids is null then
    return json_build_object('deleted', 0, 'sum', 0, 'reps', '[]'::json, 'more', false);
  end if;

  -- связи ручных записей и заказов с удаляемыми документами снимаются, сами записи остаются;
  -- это следствие удаления, а не правка — в историю идёт одна строка итога
  perform set_config('app.import_1c', '1', true);
  perform set_config('app.bulk_import', '1', true);
  update public.orders set doc_id = null, actual_amount = null where doc_id = any(v_ids);
  update public.payouts set doc_id = null where doc_id = any(v_ids);
  delete from public.docs where id = any(v_ids);
  get diagnostics n = row_count;
  perform set_config('app.bulk_import', '0', true);
  perform set_config('app.import_1c', '0', true);

  v_more := exists (select 1 from public.docs d
                     where d.kind = any(p_kinds) and d.doc_at >= p_from and d.doc_at < p_to + 1);
  if not v_more then
    insert into public.audit_log (entity, action, data)
    values ('docs', 'purge', jsonb_build_object('from', p_from, 'to', p_to, 'kinds', to_jsonb(p_kinds),
            'n', coalesce(p_done, 0) + n, 'sum', coalesce(p_done_sum, 0) + v_sum));
  end if;
  return json_build_object('deleted', n, 'sum', v_sum, 'reps', to_json(v_reps), 'more', v_more);
end $$;
revoke all on function public.delete_docs(date, date, text[], int, numeric) from public, anon;
grant execute on function public.delete_docs(date, date, text[], int, numeric) to authenticated;
