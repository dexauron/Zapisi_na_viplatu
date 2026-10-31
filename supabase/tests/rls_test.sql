-- Тест прав доступа. Запуск: целиком в SQL-редакторе Supabase или через supabase/tests/run.sh.
-- Создаёт вымышленных пользователей и данные, проверяет случаи ниже и в конце бросает исключение
-- с отчётом — поэтому все изменения откатываются. Строка с «FAIL» = ошибка в правах.
-- Сравнение факта с ожиданием: строка «ok» или «FAIL» для отчёта
create or replace function pg_temp.chk(label text, actual text, expected text) returns text
language sql as $$ select label || case when actual is not distinct from expected
  then ' ok (' || coalesce(actual, 'null') || ')' else ' FAIL: ' || coalesce(actual, 'null') || ', ожидалось ' || coalesce(expected, 'null') end $$;

do $test$
declare
  adm uuid := gen_random_uuid(); emp uuid := gen_random_uuid(); off uuid := gen_random_uuid();
  stranger uuid := gen_random_uuid(); owner uuid := gen_random_uuid();
  rep uuid; rep2 uuid; store uuid; ord uuid; tok text; stok text; n int; j json; v text; log text[] := '{}';
begin
  -- Данные (от имени владельца базы, RLS не действует)
  insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at)
  select u, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', e, now(), now()
  from unnest(array[adm, emp, off, stranger, owner],
              array['adm@test.local', 'emp@test.local', 'off@test.local', 'x@test.local', 'owner@test.local']) t(u, e);
  insert into public.staff (user_id, login, full_name, role, active) values
    (adm, 't_adm', 'Админ', 'admin', true), (emp, 't_emp', 'Сотрудник', 'employee', true),
    (off, 't_off', 'Уволен', 'employee', false);
  insert into public.admins (email) values ('owner@test.local');
  insert into public.reps (full_name, company) values ('ТП Тест', 'ООО Тест') returning id into rep;
  insert into public.reps (full_name) values ('ТП Другой') returning id into rep2;
  select token into tok from public.rep_access where rep_id = rep;
  insert into public.stores (name) values ('Магазин Тест') returning id into store;
  insert into public.orders (rep_id, store_id, amount, created_by) values (rep, store, 100.50, adm) returning id into ord;
  insert into public.orders (rep_id, amount, created_by) values (rep2, 7, adm);
  insert into public.payouts (rep_id, amount, status) values (rep, 300, 'to_pay'), (rep2, 1, 'accrued');
  select token into stok from private.shared_link;
  log := log || pg_temp.chk('01 token created by trigger len', (coalesce(length(tok), 0))::text, '36');

  -- Аноним (ссылка торгового представителя)
  perform set_config('role', 'anon', true);
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  select count(*) into n from public.orders; log := log || pg_temp.chk('02 anon sees orders', (n)::text, '0');
  select count(*) into n from public.payouts; log := log || pg_temp.chk('03 anon sees payouts', (n)::text, '0');
  select count(*) into n from public.rep_access; log := log || pg_temp.chk('04 anon sees tokens', (n)::text, '0');
  j := public.get_rep_data(tok);
  log := log || pg_temp.chk('05 rep link orders/payouts', json_array_length(j -> 'orders') || '/' || json_array_length(j -> 'payouts'), '1/1');
  j := public.get_rep_data(repeat('0', 36)); log := log || pg_temp.chk('06 wrong token', j::text, null);
  begin perform public.ensure_profile(); log := log || '07 FAIL anon called ensure_profile'::text;
  exception when others then log := log || ('07 ok anon ensure_profile denied: ' || sqlerrm); end;
  begin insert into public.orders (rep_id, amount) values (rep, 1); log := log || '08 FAIL anon inserted order'::text;
  exception when others then log := log || ('08 ok anon insert denied: ' || sqlerrm); end;
  begin perform public.import_reps('[{"key":"x","full_name":"x"}]'::jsonb); log := log || '08b FAIL anon imported reps'::text;
  exception when others then log := log || ('08b ok anon import denied: ' || sqlerrm); end;
  j := public.get_payout_schedule(repeat('0', 36)); log := log || pg_temp.chk('08c schedule wrong token', j::text, null);
  j := public.get_payout_schedule(stok);
  select count(*) into n from json_array_elements(j) e where (e ->> 'rep_id')::uuid = any(array[rep, rep2]);
  log := log || pg_temp.chk('08d schedule shows unpaid', n::text, '2');
  select count(*) into n from json_array_elements(j) e where e::jsonb ? 'phone' or e::jsonb ? 'comment';
  log := log || pg_temp.chk('08e schedule hides phone/comment', n::text, '0');

  -- Сотрудник
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', emp, 'role', 'authenticated')::text, true);
  select count(*) into n from public.orders where rep_id = any(array[rep, rep2]); log := log || pg_temp.chk('09 employee sees orders', (n)::text, '2');
  select count(*) into n from public.payouts; log := log || pg_temp.chk('10 employee sees payouts', (n)::text, '0');
  select count(*) into n from public.rep_access; log := log || pg_temp.chk('11 employee sees tokens', (n)::text, '0');
  select count(*) into n from public.staff where login like 't\_%'; log := log || pg_temp.chk('12 employee sees staff', (n)::text, '3');
  begin perform public.get_rep_data(tok); log := log || '13 FAIL employee called get_rep_data'::text;
  exception when others then log := log || ('13 ok employee get_rep_data denied: ' || sqlerrm); end;
  insert into public.orders (rep_id, amount) values (rep, 50); log := log || '14 employee inserted own order'::text;
  begin insert into public.orders (rep_id, amount, created_by) values (rep, 50, adm); log := log || '15 FAIL employee forged author'::text;
  exception when others then log := log || ('15 ok forged author denied: ' || sqlerrm); end;
  update public.orders set status = 'delivered', created_by = emp where id = ord; get diagnostics n = row_count;
  select created_by::text into v from public.orders where id = ord;
  log := log || pg_temp.chk('16a employee marked delivered rows', n::text, '1') || pg_temp.chk('; 16b author kept', v, adm::text);
  select (delivered_at is not null)::text into v from public.orders where id = ord; log := log || pg_temp.chk('17 delivered_at set', (v)::text, 'true');
  delete from public.orders; get diagnostics n = row_count; log := log || pg_temp.chk('18 employee deleted orders', (n)::text, '0');
  update public.reps set full_name = 'Взлом'; get diagnostics n = row_count; log := log || pg_temp.chk('19 employee edited reps', (n)::text, '0');
  insert into public.reps (full_name) values ('Новый ТП'); log := log || '20 employee added rep'::text;
  update public.staff set role = 'admin' where user_id = emp; get diagnostics n = row_count;
  log := log || pg_temp.chk('21 employee self-promote rows', (n)::text, '0');
  begin insert into public.orders (rep_id, amount, order_date, expected_date) values (rep, 1, '2026-10-10', '2026-10-01');
    log := log || '22 FAIL arrival before order accepted'::text;
  exception when others then log := log || ('22 ok arrival before order denied: ' || sqlerrm); end;

  begin perform public.import_reps('[{"key":"x","full_name":"x"}]'::jsonb); log := log || '22b FAIL employee imported reps'::text;
  exception when others then log := log || ('22b ok employee import denied: ' || sqlerrm); end;
  begin perform public.shared_link_token(); log := log || '22c FAIL employee read shared link'::text;
  exception when others then log := log || ('22c ok employee shared link denied: ' || sqlerrm); end;

  -- Отключённый сотрудник и посторонний вошедший
  perform set_config('request.jwt.claims', json_build_object('sub', off, 'role', 'authenticated')::text, true);
  select count(*) into n from public.orders; log := log || pg_temp.chk('23 disabled employee sees orders', (n)::text, '0');
  perform set_config('request.jwt.claims', json_build_object('sub', stranger, 'role', 'authenticated', 'email', 'x@test.local')::text, true);
  select count(*) into n from public.orders; log := log || pg_temp.chk('24 stranger sees orders', (n)::text, '0');
  j := public.ensure_profile(); log := log || pg_temp.chk('25 stranger profile', j::text, null);

  -- Владелец из admins получает профиль админа при первом входе
  perform set_config('request.jwt.claims', json_build_object('sub', owner, 'role', 'authenticated', 'email', 'owner@test.local')::text, true);
  j := public.ensure_profile(); log := log || pg_temp.chk('26 owner first login role', (coalesce(j ->> 'role', 'null'))::text, 'admin');

  -- Админ
  perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
  select count(*) into n from public.payouts where rep_id = any(array[rep, rep2]); log := log || pg_temp.chk('27 admin sees payouts', (n)::text, '2');
  select count(*) into n from public.rep_access a join public.reps r on r.id = a.rep_id where r.full_name in ('ТП Тест', 'ТП Другой', 'Новый ТП'); log := log || pg_temp.chk('28 admin sees tokens', (n)::text, '3');
  update public.payouts set status = 'paid' where rep_id = rep; get diagnostics n = row_count;
  select (paid_at is not null)::text into v from public.payouts where rep_id = rep;
  log := log || pg_temp.chk('29a admin paid rows', n::text, '1') || pg_temp.chk('; 29b paid_at set', v, 'true');
  delete from public.orders where rep_id = rep2; get diagnostics n = row_count; log := log || pg_temp.chk('30 admin deleted order rows', (n)::text, '1');
  begin delete from public.reps where id = rep; log := log || '31 FAIL rep with orders deleted'::text;
  exception when others then log := log || ('31 ok rep with orders kept: ' || sqlerrm); end;

  -- Загрузка справочника из 1С
  j := public.import_reps(jsonb_build_array(
    jsonb_build_object('key', 'ооо тест тп петров', 'full_name', 'Петров', 'company', 'ООО Тест', 'phone', '+79990000000'),
    jsonb_build_object('key', 'тп другой', 'full_name', 'ТП Другой'),
    jsonb_build_object('key', 'тп другой', 'full_name', 'дубль')));
  log := log || pg_temp.chk('32 import added/updated/skipped', (j ->> 'added') || '/' || (j ->> 'updated') || '/' || (j ->> 'skipped'), '1/1/1');
  select count(*) into n from public.rep_access a join public.reps r on r.id = a.rep_id where r.ext_key = 'ооо тест тп петров';
  log := log || pg_temp.chk('33 imported rep got link', n::text, '1');
  j := public.import_reps(jsonb_build_array(jsonb_build_object('key', 'ооо тест тп петров', 'full_name', 'Петров', 'company', 'ООО Тест', 'phone', '+79990000000')), true);
  log := log || pg_temp.chk('34 reimport same/deactivated', (j ->> 'same') || '/' || (j ->> 'deactivated'), '1/1');
  select active::text into v from public.reps where id = rep2; log := log || pg_temp.chk('35 missing rep disabled', v, 'false');
  select active::text into v from public.reps where id = rep; log := log || pg_temp.chk('36 manual rep untouched', v, 'true');

  log := log || pg_temp.chk('37 admin shared link token', (public.shared_link_token() = stok)::text, 'true');
  perform set_config('role', 'anon', true);
  j := public.get_payout_schedule(stok);
  perform set_config('role', 'authenticated', true);
  select count(*) into n from json_array_elements(j) e where (e ->> 'rep_id')::uuid = rep;
  log := log || pg_temp.chk('38 paid hidden from schedule', n::text, '0');

  -- Два статуса выплаты и № накладной
  select count(*) into n from public.payouts where status = 'accrued';
  log := log || pg_temp.chk('39 accrued stored as to_pay', n::text, '0');
  update public.payouts set invoice_no = '  77/1 ' where rep_id = rep;
  perform set_config('role', 'anon', true);
  j := public.get_rep_data(tok);
  perform set_config('role', 'authenticated', true);
  log := log || pg_temp.chk('40 invoice trimmed, in rep cabinet', j -> 'payouts' -> 0 ->> 'invoice_no', '77/1');

  -- Документы 1С: загрузка без копий, остаток по накладной, права
  perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
  j := public.import_docs('00000000-0000-0000-0000-0000000000d1', array['inc', 'dec', 'basis'],
    '[{"title":"Приходная накладная","num":"ПФ1","at":"2026-09-01T10:00:00","kontr":"Поставщик Тест","inc":1000,"dec":0},
      {"title":"Расходный кассовый ордер","num":"ПФ2","at":"2026-09-02T10:00:00","kontr":"Поставщик Тест","inc":0,"dec":400,
       "basis":"Приходная накладная|ПФ1|2026"}]'::jsonb);
  log := log || pg_temp.chk('41 docs added, new supplier', (j ->> 'added') || '/' || (j ->> 'reps_added'), '2/1');
  j := public.import_docs('00000000-0000-0000-0000-0000000000d2', array['inc', 'dec'],
    '[{"title":"Приходная накладная","num":"ПФ1","at":"2026-09-01T10:00:00","kontr":"Поставщик Тест","inc":1000,"dec":0}]'::jsonb);
  log := log || pg_temp.chk('42 reimport same, no copy', (j ->> 'same') || '/' || (select count(*) from public.docs where num = 'ПФ1'), '1/1');
  j := public.finish_import('00000000-0000-0000-0000-0000000000d1', '[]'::jsonb);
  perform public.reconcile(array(select jsonb_array_elements_text((j::jsonb) -> 'reps')::uuid));
  select open_amount::text into v from public.docs where num = 'ПФ1';
  log := log || pg_temp.chk('43 open = invoice - linked payment', v, '600.00');
  perform set_config('request.jwt.claims', json_build_object('sub', emp, 'role', 'authenticated')::text, true);
  select count(*) into n from public.docs;
  log := log || pg_temp.chk('44 employee sees no docs', n::text, '0');
  begin perform public.import_docs(gen_random_uuid(), array['inc'], '[]'::jsonb); log := log || '45 FAIL employee imported docs'::text;
  exception when others then log := log || ('45 ok employee import denied: ' || sqlerrm); end;

  -- «Получил»: ставит только представитель по своей ссылке, только у оплаченной записи
  perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
  select id::text into v from public.payouts where rep_id = rep and status = 'paid' limit 1;
  update public.payouts set received_at = now() where id = v::uuid;
  select count(*) into n from public.payouts where id = v::uuid and received_at is not null;
  log := log || pg_temp.chk('46 staff cannot set received_at', n::text, '0');
  perform set_config('role', 'anon', true);
  log := log || pg_temp.chk('47 other rep token cannot confirm',
    (public.confirm_receipt((select token from public.rep_access where rep_id = rep2), v::uuid) is null)::text, 'true');
  log := log || pg_temp.chk('48 rep confirms receipt', (public.confirm_receipt(tok, v::uuid) is not null)::text, 'true');
  perform set_config('role', 'authenticated', true);
  update public.payouts set status = 'to_pay' where id = v::uuid;
  select count(*) into n from public.payouts where id = v::uuid and received_at is not null;
  log := log || pg_temp.chk('49 unpaid resets receipt', n::text, '0');

  raise exception E'РЕЗУЛЬТАТ\n%', array_to_string(log, E'\n');
end
$test$;
