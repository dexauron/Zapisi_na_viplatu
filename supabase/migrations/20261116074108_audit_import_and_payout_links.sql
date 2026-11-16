-- Проверяем новые связи. Исторические дубли остаются доступными для ручной сверки.
create or replace function private.check_payout_doc() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  doc public.docs;
begin
  if new.doc_id is null then return new; end if;
  if tg_op = 'UPDATE' and new.doc_id is not distinct from old.doc_id
    and new.rep_id is not distinct from old.rep_id then return new; end if;
  select * into doc from public.docs where id = new.doc_id for no key update;
  if not found or doc.rep_id <> new.rep_id or doc.kind <> 'in' or doc.deleted then
    raise exception 'Выберите действующую приходную накладную этого поставщика' using errcode = '23514';
  end if;
  if exists (select 1 from public.payouts p where p.doc_id = new.doc_id and p.id <> new.id) then
    raise exception 'По этой накладной уже есть запись на выплату' using errcode = '23505';
  end if;
  return new;
end $$;
revoke all on function private.check_payout_doc() from public, anon, authenticated;
create trigger payouts_check_doc before insert or update of doc_id, rep_id on public.payouts
  for each row execute function private.check_payout_doc();

create or replace function public.finish_import(p_import uuid, p_scopes jsonb, p_files jsonb default '[]'::jsonb)
returns json
language plpgsql security definer set search_path = '' as $$
declare
  sc jsonb; v_titles text[]; v_from date; v_to date; v_by_reps boolean;
  v_reps uuid[]; v_scope_reps uuid[]; v_del_reps uuid[]; n_scope int; n_miss int; n_del int := 0; v_skipped text[] := '{}'; v_res jsonb;
begin
  if not (select private.is_admin()) then
    raise exception 'Загрузка из 1С — только для администратора' using errcode = '42501';
  end if;
  -- Повтор завершённого или пустого импорта не меняет документы и историю.
  perform pg_advisory_xact_lock(hashtextextended(p_import::text, 0));
  if not exists (select 1 from private.import_seen where import_id = p_import) then
    return jsonb_build_object('deleted', 0, 'not_deleted', '[]'::jsonb, 'reps', '[]'::jsonb);
  end if;
  -- свежая статистика: после пачек на десятки тысяч строк без неё планировщик выбирает перебор
  -- «каждый с каждым», и запрос не укладывается в 8 секунд
  analyze private.import_seen;
  analyze public.docs;
  select coalesce(array_agg(distinct d.rep_id), '{}') into v_reps
    from private.import_seen s join public.docs d on d.title = s.title and d.num = s.num and d.year = s.year
   where s.import_id = p_import;
  v_scope_reps := v_reps;

  -- Пропавшие из 1С за загруженный период
  for sc in select value from jsonb_array_elements(coalesce(p_scopes, '[]'::jsonb)) loop
    select coalesce(array_agg(t), '{}') into v_titles from jsonb_array_elements_text(sc -> 'titles') t;
    v_from := (sc ->> 'from')::date; v_to := (sc ->> 'to')::date; v_by_reps := coalesce((sc ->> 'by_reps')::boolean, false);
    continue when v_from is null or v_to is null or cardinality(v_titles) = 0;
    -- В области поиска должна быть хотя бы одна строка этого импорта.
    continue when not exists (
      select 1 from private.import_seen s
      join public.docs d on (d.title, d.num, d.year) = (s.title, s.num, s.year)
      where s.import_id = p_import and d.title = any(v_titles) and d.doc_at::date between v_from and v_to
    );
    select count(*), count(*) filter (where not exists (select 1 from private.import_seen s
             where s.import_id = p_import and s.title = d.title and s.num = d.num and s.year = d.year))
      into n_scope, n_miss
      from public.docs d
     where d.title = any(v_titles) and d.doc_at::date between v_from and v_to and not d.deleted
       and (not v_by_reps or d.rep_id = any(v_scope_reps));
    -- защита от неполного файла (выгрузка с отбором): не помечать массово
    if n_miss > n_scope * 0.2 then
      v_skipped := v_skipped || (array_to_string(v_titles, ', ') || ': ' || n_miss);
      continue;
    end if;
    with del as (
      update public.docs d set deleted = true
       where d.title = any(v_titles) and d.doc_at::date between v_from and v_to and not d.deleted
         and (not v_by_reps or d.rep_id = any(v_scope_reps))
         and not exists (select 1 from private.import_seen s
               where s.import_id = p_import and s.title = d.title and s.num = d.num and s.year = d.year)
      returning d.rep_id)
    select count(*), coalesce(array_agg(distinct rep_id), '{}') into n_miss, v_del_reps from del;
    n_del := n_del + n_miss;
    v_reps := array(select distinct x from unnest(v_reps || v_del_reps) x);
  end loop;

  -- Если основание убрали или заменили, старая связь должна исчезнуть.
  with links as (
    select p.id, i.id as basis_id
    from public.docs p
    left join public.docs i on i.title = split_part(p.basis_key, '|', 1)
      and i.num = split_part(p.basis_key, '|', 2)
      and i.year = case when split_part(p.basis_key, '|', 3) ~ '^[0-9]{4}$'
                        then split_part(p.basis_key, '|', 3)::smallint end
      and i.rep_id = p.rep_id and i.kind = 'in' and not i.deleted
    where p.rep_id = any(v_reps) and p.kind <> 'in'
      and (p.basis_key is not null or p.basis_id is not null)
  )
  update public.docs p set basis_id = links.basis_id from links
   where p.id = links.id and p.basis_id is distinct from links.basis_id;

  delete from private.import_seen where import_id = p_import;
  delete from private.import_seen where at < now() - interval '1 day';   -- брошенные загрузки
  v_res := jsonb_build_object('deleted', n_del, 'not_deleted', v_skipped);
  insert into public.audit_log (entity, action, data)
  values ('import', 'import', jsonb_build_object('kind', 'docs', 'files', p_files, 'reps', cardinality(v_reps)) || v_res);
  return v_res || jsonb_build_object('reps', to_jsonb(v_reps));
end $$;
revoke all on function public.finish_import(uuid, jsonb, jsonb) from public, anon;
grant execute on function public.finish_import(uuid, jsonb, jsonb) to authenticated;

create or replace function public.reconcile(p_reps uuid[])
returns json
language plpgsql security definer set search_path = '' as $$
declare n_orders int := 0; n_link int := 0; n_link2 int := 0; n_paid int := 0; v_ord record; v_doc public.docs;
begin
  if not (select private.is_admin()) then
    raise exception 'Сверка 1С — только для администратора' using errcode = '42501';
  end if;
  if cardinality(p_reps) > 200 then raise exception 'Слишком много поставщиков за раз'; end if;

  perform private.recalc_open(p_reps);
  perform set_config('app.import_1c', '1', true);

  -- Записи на выплату ↔ приходные: по номеру накладной
  with cand as (
    select p.id pid, d.id did
      from public.payouts p
      join public.docs d on d.rep_id = p.rep_id and d.kind = 'in' and not d.deleted
     where p.rep_id = any(p_reps) and p.doc_id is null and p.invoice_no is not null
       and (lower(btrim(d.in_no)) = lower(btrim(p.invoice_no))
         or lower(d.num) = lower(btrim(p.invoice_no))
         or (length(regexp_replace(p.invoice_no, '\D', '', 'g')) >= 3
             and regexp_replace(d.num, '\D', '', 'g') like '%' || regexp_replace(p.invoice_no, '\D', '', 'g')))
       and not exists (select 1 from public.payouts x where x.doc_id = d.id)
  ), unique_links as (
    select pid, did from cand
     where pid in (select pid from cand group by pid having count(*) = 1)
       and did in (select did from cand group by did having count(*) = 1)
  )
  update public.payouts p set doc_id = c.did from unique_links c where p.id = c.pid;
  get diagnostics n_link = row_count;
  -- …иначе по точной сумме — только когда пара однозначна в обе стороны
  with pairs as (
    select p.id pid, d.id did
      from public.payouts p
      join public.docs d on d.rep_id = p.rep_id and d.kind = 'in' and not d.deleted and d.inc = p.amount
       and d.doc_at::date between p.created_at::date - 60 and greatest(p.payout_date, p.created_at::date) + 1
       and not exists (select 1 from public.payouts x where x.doc_id = d.id)
     where p.rep_id = any(p_reps) and p.doc_id is null
  ), ok as (
    select pid, did from pairs
     where pid in (select pid from pairs group by pid having count(*) = 1)
       and did in (select did from pairs group by did having count(*) = 1)
  )
  update public.payouts p set doc_id = ok.did from ok where p.id = ok.pid;
  get diagnostics n_link2 = row_count;

  -- Запись не отмечена, а в 1С накладная оплачена полностью → «Оплачено» (дата — последняя оплата по накладной)
  update public.payouts p set status = 'paid',
         paid_at = coalesce((select max(x.doc_at) from public.docs x where x.basis_id = d.id and x.kind = 'pay' and not x.deleted)
                            at time zone 'Europe/Moscow', now())
    from public.docs d
   where p.doc_id = d.id and p.status <> 'paid' and not d.deleted and d.open_amount = 0
     and p.rep_id = d.rep_id and p.rep_id = any(p_reps)
     and not exists (select 1 from public.payouts duplicate where duplicate.doc_id = d.id and duplicate.id <> p.id);
  get diagnostics n_paid = row_count;

  -- Заказы ↔ пришедшие накладные: ближайшая накладная того же поставщика не раньше даты заказа
  for v_ord in select * from public.orders
                where rep_id = any(p_reps) and doc_id is null and status in ('ordered', 'delivered')
                  and order_date >= current_date - 180
                order by order_date, created_at loop
    select d.* into v_doc from public.docs d
     where d.rep_id = v_ord.rep_id and d.kind = 'in' and not d.deleted
       and d.doc_at::date between v_ord.order_date and coalesce(v_ord.expected_date, v_ord.order_date) + 14
       and not exists (select 1 from public.orders x where x.doc_id = d.id)
     order by d.doc_at limit 1;
    continue when v_doc.id is null;
    update public.orders set doc_id = v_doc.id, actual_amount = v_doc.inc, status = 'delivered',
           delivered_at = case when status = 'delivered' then delivered_at else v_doc.doc_at at time zone 'Europe/Moscow' end
     where id = v_ord.id;
    n_orders := n_orders + 1; v_doc := null;
  end loop;
  update public.orders o set actual_amount = d.inc from public.docs d
   where o.doc_id = d.id and o.rep_id = any(p_reps) and o.actual_amount is distinct from d.inc;
  perform set_config('app.import_1c', '0', true);
  return json_build_object('orders', n_orders, 'payouts_linked', n_link + n_link2, 'payouts_paid', n_paid);
end $$;
revoke all on function public.reconcile(uuid[]) from public, anon;
grant execute on function public.reconcile(uuid[]) to authenticated;
