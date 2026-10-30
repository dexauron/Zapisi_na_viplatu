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
  rep uuid; rep2 uuid; store uuid; ord uuid; tok text; n int; j json; v text; log text[] := '{}';
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

  raise exception E'РЕЗУЛЬТАТ\n%', array_to_string(log, E'\n');
end
$test$;
