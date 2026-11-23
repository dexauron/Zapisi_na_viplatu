-- Вымышленные данные; итоговое исключение откатывает весь сценарий.
create or replace function pg_temp.search_term(raw text, cents bigint default null, amount_only boolean default false, digit_only boolean default false)
returns jsonb language sql as $$ select jsonb_build_object('raw', raw, 'amount_cents', cents, 'amount_only', amount_only, 'digit_only', digit_only) $$;
create or replace function pg_temp.search_query(rep uuid, terms jsonb default '[]', excluded jsonb default '[]', lim integer default 40)
returns json language sql as $$ select public.search_invoices(jsonb_build_object('query', 'Тестовый поиск',
  'has_text', rep is not null, 'rep_ids', case when rep is null then '[]'::jsonb else jsonb_build_array(rep) end,
  'terms', terms, 'exclude_ids', excluded), lim) $$;
create or replace function pg_temp.chk(label text, actual text, expected text) returns text
language sql as $$ select label || case when actual is not distinct from expected then ' ok'
  else ' FAIL: ' || coalesce(actual, 'null') || ', ожидалось ' || coalesce(expected, 'null') end $$;

do $test$
declare
  adm uuid := gen_random_uuid(); emp uuid := gen_random_uuid(); rep uuid; other_rep uuid;
  a uuid; b uuid; c uuid; pay uuid; j json; before_pay jsonb; n int; report text[] := '{}';
begin
  report := report || pg_temp.chk('01 визуальные буквы нормализуются', private.search_compact('СВ-015'), 'cb015');
  report := report || pg_temp.chk('02 транслитерация номера и нули', private.search_alternate('ПФ-00012345'), 'pf12345');
  report := report || pg_temp.chk('03 твёрдый и мягкий знак не превращаются в буквы', private.search_alternate('Объёмь'), 'obem');
  insert into auth.users(id, email, created_at, updated_at) values
    (adm, 'search-admin@test.local', now(), now()), (emp, 'search-employee@test.local', now(), now());
  insert into public.staff(user_id, login, full_name, role) values
    (adm, 'search_admin', 'Тестовый администратор поиска', 'admin'), (emp, 'search_employee', 'Тестовый сотрудник поиска', 'employee');
  insert into public.reps(full_name, company) values ('Иванов Иван Петрович', 'ИП Примеров') returning id into rep;
  insert into public.reps(full_name, company) values ('Иванов Пётр Сергеевич', 'ООО Пример') returning id into other_rep;
  insert into public.docs(title, kind, num, in_no, year, doc_at, rep_id, kontr, inc, open_amount) values
    ('Приходная накладная', 'in', 'SMART-27183', 'ПФ-00012345', 2119, '2012-01-01', rep, 'Тестовый поиск', 15000.50, 100) returning id into a;
  insert into public.docs(title, kind, num, in_no, year, doc_at, rep_id, kontr, inc) values
    ('Приходная накладная', 'in', 'SMART-27184', '123456', 2119, '2026-11-23', rep, 'Тестовый поиск', 15000.51) returning id into b;
  insert into public.docs(title, kind, num, in_no, year, doc_at, rep_id, kontr, inc) values
    ('Приходная накладная', 'in', 'SMART-OTHER', 'СВ-015', 2119, '2026-11-23', other_rep, 'Тестовый поиск', 15000.50) returning id into c;
  insert into public.docs(title, kind, num, in_no, year, doc_at, rep_id, kontr, inc, deleted) values
    ('Приходная накладная', 'in', 'SMART-DELETED', '12345', 2119, '2026-11-23', rep, 'Тестовый поиск', 15000.50, true);
  insert into public.payouts(rep_id, amount, doc_id, invoice_no) values (rep, 15000.50, a, 'ПФ-00012345') returning id into pay;
  select to_jsonb(p) into before_pay from public.payouts p where id = pay;

  perform set_config('role', 'anon', true);
  begin
    perform pg_temp.search_query(rep);
    report := report || '04 FAIL анонимный поиск разрешён'::text;
  exception when insufficient_privilege then report := report || '04 анонимный поиск запрещён ok'::text; end;
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', emp, 'role', 'authenticated')::text, true);
  begin
    perform pg_temp.search_query(rep);
    report := report || '05 FAIL сотрудник увидел финансовый поиск'::text;
  exception when insufficient_privilege then report := report || '05 сотрудник не видит финансовый поиск ok'::text; end;
  perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
  j := pg_temp.search_query(rep);
  report := report || pg_temp.chk('06 все даты и только нужный поставщик', j->>'total', '2');
  j := pg_temp.search_query(rep, jsonb_build_array(pg_temp.search_term('12345', 1234500, false, true)));
  report := report || pg_temp.chk('07 точный номер выше нового частичного', j->'items'->0->>'id', a::text);
  report := report || pg_temp.chk('08 номер с ведущими нулями и часть номера', j->>'total', '2');
  j := pg_temp.search_query(rep, jsonb_build_array(pg_temp.search_term('PF12345')));
  report := report || pg_temp.chk('09 транслитерация префикса', j->'items'->0->>'id', a::text);
  j := pg_temp.search_query(rep, jsonb_build_array(pg_temp.search_term('27183', 2718300, false, true)));
  report := report || pg_temp.chk('10 номер 1С по цифрам', j->'items'->0->>'id', a::text);
  j := pg_temp.search_query(rep, jsonb_build_array(pg_temp.search_term('2345', 234500, false, true)));
  report := report || pg_temp.chk('11 середина номера', j->>'total', '2');
  j := pg_temp.search_query(rep, jsonb_build_array(pg_temp.search_term('PF12346')));
  report := report || pg_temp.chk('12 цифры без допуска на опечатку', j->>'total', '0');
  j := pg_temp.search_query(other_rep, jsonb_build_array(pg_temp.search_term('CB-015')));
  report := report || pg_temp.chk('13 смешанная кириллица и латиница', j->'items'->0->>'id', c::text);
  j := pg_temp.search_query(rep, jsonb_build_array(pg_temp.search_term('15 000,50', 1500050, true, true)));
  report := report || pg_temp.chk('14 сумма строго до копейки', j->>'total', '1');
  report := report || pg_temp.chk('15 поставщик вместе с суммой', j->'items'->0->>'id', a::text);
  report := report || pg_temp.chk('16 связанная запись возвращается для открытия', j->'items'->0->>'pay_id', pay::text);
  j := pg_temp.search_query(rep, jsonb_build_array(pg_temp.search_term('12345', 1234500, true, true)));
  report := report || pg_temp.chk('17 сумма не подменяется номером', j->>'total', '0');
  j := pg_temp.search_query(rep, jsonb_build_array(pg_temp.search_term('12345', 1234500, false, true), pg_temp.search_term('15000,50', 1500050, true, true)));
  report := report || pg_temp.chk('18 обязательны все части запроса', j->>'total', '1');
  j := pg_temp.search_query(rep, '[]', jsonb_build_array(a));
  report := report || pg_temp.chk('19 показанная запись не дублируется накладной', j->>'total', '1');
  report := report || pg_temp.chk('20 исключён правильный документ', j->'items'->0->>'id', b::text);
  j := pg_temp.search_query(rep, '[]', '[]', 1);
  report := report || pg_temp.chk('21 лимит выдачи', json_array_length(j->'items')::text, '1');
  report := report || pg_temp.chk('22 число результатов до лимита', j->>'total', '2');
  j := pg_temp.search_query(null);
  report := report || pg_temp.chk('23 пустые условия не открывают весь архив', j->>'total', '0');
  j := pg_temp.search_query(gen_random_uuid());
  report := report || pg_temp.chk('24 отсутствующий поставщик даёт пустой ответ', j->>'total', '0');
  begin
    perform public.search_invoices('{}');
    report := report || '25 FAIL отсутствующие поля приняты'::text;
  exception when invalid_parameter_value then report := report || '25 отсутствующие поля отклоняются ok'::text; end;
  begin
    perform pg_temp.search_query(rep, jsonb_build_array(jsonb_build_object('raw', '15000', 'amount_cents', 'NaN', 'amount_only', true, 'digit_only', true)));
    report := report || '26 FAIL NaN принят'::text;
  exception when invalid_parameter_value then report := report || '26 NaN отклоняется ok'::text; end;
  begin
    perform pg_temp.search_query(rep, jsonb_build_array(pg_temp.search_term('15', -1500, true, true)));
    report := report || '27 FAIL отрицательная сумма принята'::text;
  exception when invalid_parameter_value then report := report || '27 отрицательная сумма отклоняется ok'::text; end;
  j := pg_temp.search_query(rep, jsonb_build_array(pg_temp.search_term('99999%_', null, false, false)));
  report := report || pg_temp.chk('28 спецсимволы не открывают чужие номера', j->>'total', '0');
  report := report || pg_temp.chk('29 поиск не меняет выплату', (select (to_jsonb(p) = before_pay)::text from public.payouts p where id = pay), 'true');
  begin
    perform private.search_compact('12345');
    report := report || '30 FAIL служебная функция доступна клиенту'::text;
  exception when insufficient_privilege then report := report || '30 служебные функции закрыты для клиента ok'::text; end;
  select count(*) into n from json_array_elements(pg_temp.search_query(rep)->'items') x where (x->>'id')::uuid not in (a,b);
  report := report || pg_temp.chk('31 удалённые документы не возвращаются', n::text, '0');
  raise exception E'РЕЗУЛЬТАТ\n%', array_to_string(report, E'\n');
end $test$;
