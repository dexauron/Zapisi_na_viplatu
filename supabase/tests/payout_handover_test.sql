-- Все данные вымышлены; итоговое исключение откатывает весь сценарий.
create or replace function pg_temp.chk(label text, actual text, expected text) returns text
language sql as $$ select label || case when actual is not distinct from expected
  then ' ok' else ' FAIL: ' || coalesce(actual, 'null') || ', ожидалось ' || coalesce(expected, 'null') end $$;

do $test$
declare
  adm uuid := gen_random_uuid(); emp uuid := gen_random_uuid(); rep uuid; other_rep uuid;
  inv uuid; cash_doc uuid; payout uuid; returned uuid; bank uuid; missing uuid;
  v_row public.payouts; v_at timestamptz; v_version timestamptz; j json; tok text; shared text;
  n int; net_rep uuid; net_inv uuid; manual_pay uuid; manual_inv uuid; log text[] := '{}';
begin
  insert into auth.users (id, email, created_at, updated_at)
  values (adm, 'handover-admin@test.local', now(), now()), (emp, 'handover-staff@test.local', now(), now());
  insert into public.staff (user_id, login, full_name, role)
  values (adm, 'handover_admin', 'Тестовый администратор', 'admin'), (emp, 'handover_staff', 'Тестовый сотрудник', 'employee');
  insert into public.reps (full_name) values ('Тест резерва') returning id into rep;
  insert into public.reps (full_name) values ('Другой поставщик резерва') returning id into other_rep;
  select token into tok from public.rep_access where rep_id = rep;
  select token into shared from private.shared_link;
  insert into public.docs (title, kind, num, year, doc_at, rep_id, kontr, inc)
  values ('Приходная накладная', 'in', 'RES-1', 2026, '2026-11-01', rep, 'Тест резерва', 100) returning id into inv;
  insert into public.docs (title, kind, num, year, doc_at, rep_id, kontr, dec, basis_id)
  values ('Расходный кассовый ордер', 'pay', 'CASH-1', 2026, '2026-11-02', rep, 'Тест резерва', 40, inv) returning id into cash_doc;
  insert into public.payouts (rep_id, amount, doc_id, payout_date)
  values (rep, 100, inv, '2026-01-01') returning id into payout;
  select * into v_row from public.payouts where id = payout;
  log := log || pg_temp.chk('01 частичный РКО резервирует точную сумму', v_row.status || '/' || v_row.reserved_amount, 'reserved/40.00');
  log := log || pg_temp.chk('02 резерв не подтверждает выдачу', (v_row.paid_at is null and v_row.paid_by is null)::text, 'true');

  perform set_config('role', 'anon', true);
  j := public.get_payout_schedule(shared);
  select count(*) into n from json_array_elements(j) x where (x->>'id')::uuid = payout and x->>'status' = 'reserved';
  log := log || pg_temp.chk('03 старый резерв виден в общем графике', n::text, '1');
  j := public.get_rep_data(tok);
  log := log || pg_temp.chk('04 резерв виден в личном кабинете', j->'payouts'->0->>'status', 'reserved');
  log := log || pg_temp.chk('05 ТП не может подтвердить получение резерва', (public.confirm_receipt(tok, payout) is null)::text, 'true');

  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', emp, 'role', 'authenticated')::text, true);
  begin
    perform public.set_payout_paid(payout, true, v_row.updated_at);
    log := log || '06 FAIL сотрудник подтвердил выдачу'::text;
  exception when insufficient_privilege then log := log || '06 сотрудник не подтверждает выдачу ok'::text; end;
  perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
  begin
    update public.payouts set status = 'paid' where id = payout;
    log := log || '07 FAIL прямая запись обошла подтверждение'::text;
  exception when check_violation then log := log || '07 прямой обход подтверждения запрещён ok'::text; end;

  j := public.set_payout_paid(payout, true, v_row.updated_at);
  select * into v_row from public.payouts where id = payout;
  v_at := v_row.paid_at; v_version := v_row.updated_at;
  log := log || pg_temp.chk('08 администратор выдаёт и фиксирует автора', v_row.status || '/' || (v_row.paid_by = adm)::text, 'paid/true');
  j := public.set_payout_paid(payout, true, '2000-01-01');
  log := log || pg_temp.chk('09 повторная выдача не меняет событие', ((j->>'updated_at')::timestamptz = v_version)::text, 'true');
  perform public.reconcile(array[rep]);
  log := log || pg_temp.chk('10 импорт не меняет выдачу', (select (status = 'paid' and paid_at = v_at and paid_by = adm)::text from public.payouts where id = payout), 'true');
  begin
    update public.payouts set amount = 200 where id = payout;
    log := log || '11 FAIL сумма выданной выплаты изменена'::text;
  exception when check_violation then log := log || '11 сумма выданной выплаты защищена ok'::text; end;
  begin
    delete from public.payouts where id = payout;
    log := log || '12 FAIL выданная выплата удалена'::text;
  exception when check_violation then log := log || '12 удаление выданной выплаты защищено ok'::text; end;
  begin
    perform public.set_payout_paid(payout, false, '2000-01-01');
    log := log || '13 FAIL устаревшая вкладка отменила выдачу'::text;
  exception when serialization_failure then log := log || '13 устаревшая вкладка не меняет выдачу ok'::text; end;
  j := public.set_payout_paid(payout, false, v_version);
  log := log || pg_temp.chk('14 отмена возвращает резерв', j->>'status', 'reserved');
  perform public.reconcile(array[rep]);
  select updated_at into v_version from public.payouts where id = payout;
  perform public.reconcile(array[rep]);
  log := log || pg_temp.chk('15 повторный импорт не меняет версию', (select (updated_at = v_version)::text from public.payouts where id = payout), 'true');

  perform set_config('role', 'postgres', true);
  update public.docs set deleted = true where id = cash_doc;
  perform set_config('role', 'authenticated', true);
  perform public.reconcile(array[rep]);
  log := log || pg_temp.chk('16 отменённый РКО снимает только резерв', (select status || '/' || reserved_amount from public.payouts where id = payout), 'to_pay/0.00');
  perform set_config('role', 'postgres', true);
  insert into public.docs (title, kind, num, year, doc_at, rep_id, kontr, inc)
  values ('Приходная накладная', 'in', 'RETURN-1', 2026, '2026-11-03', rep, 'Тест резерва', 200) returning id into returned;
  insert into public.docs (title, kind, num, year, doc_at, rep_id, kontr, dec, basis_id)
  values ('Возврат поставщику', 'ret', 'RETURN-2', 2026, '2026-11-04', rep, 'Тест резерва', 200, returned);
  insert into public.payouts (rep_id, amount, doc_id) values (rep, 200, returned);
  insert into public.docs (title, kind, num, year, doc_at, rep_id, kontr, inc)
  values ('Приходная накладная', 'in', 'BANK-1', 2026, '2026-11-05', rep, 'Тест резерва', 300) returning id into bank;
  insert into public.docs (title, kind, num, year, doc_at, rep_id, kontr, dec, basis_id)
  values ('Расход со счета', 'pay', 'BANK-2', 2026, '2026-11-06', rep, 'Тест резерва', 300, bank);
  insert into public.payouts (rep_id, amount, doc_id) values (rep, 300, bank);
  perform set_config('role', 'authenticated', true);
  perform public.reconcile(array[rep]);
  log := log || pg_temp.chk('17 возврат не является наличными', (select status::text from public.payouts where doc_id = returned), 'to_pay');
  log := log || pg_temp.chk('18 банковский платёж не создаёт конверт', (select status::text from public.payouts where doc_id = bank), 'to_pay');
  insert into public.payouts (rep_id, amount, invoice_no, payout_date)
  values (other_rep, 500, 'НЕСОВПАДАЮЩИЙ-НОМЕР', current_date) returning id into missing;
  perform set_config('role', 'postgres', true);
  insert into public.docs (title, kind, num, year, doc_at, rep_id, kontr, inc)
  values ('Приходная накладная', 'in', 'OTHER-1', 2026, current_date, other_rep, 'Другой', 500);
  perform set_config('role', 'authenticated', true);
  perform public.reconcile(array[other_rep]);
  log := log || pg_temp.chk('19 неверный номер не заменяется совпадением суммы', (select (doc_id is null)::text from public.payouts where id = missing), 'true');
  begin
    perform public.set_payout_paid(payout, true, null);
    log := log || '20 FAIL выдача без версии'::text;
  exception when invalid_parameter_value then log := log || '20 выдача требует версию записи ok'::text; end;
  insert into public.orders (rep_id, amount, order_date, expected_date)
  values (other_rep, 500, current_date - 1, current_date), (other_rep, 500, current_date - 1, current_date);
  perform public.reconcile(array[other_rep]);
  log := log || pg_temp.chk('21 два заказа не получают произвольную накладную',
    (select count(*)::text from public.orders where rep_id = other_rep and doc_id is not null), '0');
  perform set_config('role', 'postgres', true);
  insert into public.docs (title, kind, num, year, doc_at, rep_id, kontr, dec)
  values ('Расходный кассовый ордер', 'pay', 'UNLINKED-CASH', 2026, '2026-11-07', rep, 'Тест резерва', 1000);
  perform set_config('role', 'authenticated', true);
  perform public.reconcile(array[rep]);
  log := log || pg_temp.chk('22 оплата без основания не создаёт фиктивный конверт',
    (select status::text from public.payouts where id = payout), 'to_pay');
  begin
    insert into public.payouts(rep_id, amount) values (rep, 'NaN'::numeric);
    log := log || '23 FAIL NaN принят как сумма выплаты'::text;
  exception when check_violation then log := log || '23 сумма выплаты должна быть конечным числом ok'::text; end;
  begin
    perform public.import_docs(gen_random_uuid(), array['inc'],
      '[{"title":"Приходная накладная","num":"INVALID-NAN","at":"2026-11-01T10:00:00","kontr":"Тест NaN","inc":"NaN"}]'::jsonb);
    log := log || '24 FAIL NaN принят как движение 1С'::text;
  exception when check_violation then log := log || '24 импорт не сохраняет NaN в денежном движении ok'::text; end;
  j := public.set_payout_paid(payout, true, (select updated_at from public.payouts where id = payout));
  perform set_config('role', 'postgres', true);
  update public.docs set rep_id = other_rep where id = inv;
  perform set_config('role', 'authenticated', true);
  log := log || pg_temp.chk('25 смена контрагента снимает связь, сохраняя выдачу',
    (select (doc_id is null and status = 'paid' and paid_by = adm)::text from public.payouts where id = payout), 'true');
  perform public.reconcile(array[other_rep]);
  log := log || pg_temp.chk('26 чужой РКО не погашает накладную другого поставщика',
    (select open_amount::text from public.docs where id = inv), '100.00');
  begin
    perform private.recalc_open(array[rep]);
    log := log || '27 FAIL клиентская роль вызвала внутренний пересчёт'::text;
  exception when insufficient_privilege then log := log || '27 внутренний пересчёт закрыт для клиентской роли ok'::text; end;
  perform set_config('role', 'postgres', true);
  insert into public.reps(full_name) values ('Тест встречного движения') returning id into net_rep;
  insert into public.docs (title, kind, num, year, doc_at, rep_id, kontr, inc)
  values ('Приходная накладная', 'in', 'NET-1', 2026, '2026-11-01', net_rep, 'Тест встречного движения', 100) returning id into net_inv;
  insert into public.docs (title, kind, num, year, doc_at, rep_id, kontr, inc, dec, basis_id)
  values ('Расходный кассовый ордер', 'pay', 'NET-2', 2026, '2026-11-02', net_rep, 'Тест встречного движения', 0, 40, net_inv),
    ('Корректировка долга', 'other', 'NET-3', 2026, '2026-11-03', net_rep, 'Тест встречного движения', 10, 0, net_inv);
  perform set_config('role', 'authenticated', true);
  perform public.reconcile(array[net_rep]);
  log := log || pg_temp.chk('28 встречное движение увеличивает остаток по основанию',
    (select open_amount::text from public.docs where id = net_inv), '70.00');
  perform set_config('role', 'postgres', true);
  insert into public.docs (title, kind, num, year, doc_at, rep_id, kontr, inc)
  values ('Приходная накладная', 'in', 'MANUAL-LINK', 2026, current_date, rep, 'Тест резерва', 45) returning id into manual_inv;
  insert into public.docs (title, kind, num, year, doc_at, rep_id, kontr, inc)
  values ('Приходная накладная', 'in', 'REPLACEMENT', 2026, current_date, rep, 'Тест резерва', 100);
  perform set_config('role', 'authenticated', true);
  insert into public.payouts(rep_id, amount) values (rep,45) returning id into manual_pay;
  j := public.set_payout_paid(manual_pay, true, (select updated_at from public.payouts where id=manual_pay));
  v_at := (j->>'paid_at')::timestamptz;
  perform public.reconcile(array[rep]);
  log := log || pg_temp.chk('29 первая привязка сохраняет уже выданную выплату',
    (select (doc_id=manual_inv and status='paid' and paid_by=adm and paid_at=v_at)::text from public.payouts where id=manual_pay),'true');
  log := log || pg_temp.chk('30 после смены поставщика другая накладная не подставляется',
    (select (doc_id is null and link_review_required)::text from public.payouts where id=payout),'true');
  raise exception E'РЕЗУЛЬТАТ\n%', array_to_string(log, E'\n');
end $test$;
