const assert = require('node:assert/strict');
const { test } = require('node:test');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');

// Загружаем настоящий общий модуль интерфейса, без браузера и без запросов к серверу.
function app(now = '2026-11-19T22:30:00Z') {
  const NativeDate = Date;
  class FixedDate extends NativeDate {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return new NativeDate(now).getTime(); }
  }
  const ctx = { URL, Date: FixedDate, Intl, Map, Set, console,
    localStorage: { getItem: () => null }, document: { documentElement: { dataset: {} } },
    window: { APP_CONFIG: { SUPABASE_URL: 'https://fixture.invalid', SUPABASE_KEY: 'fixture' },
      supabase: { createClient: () => ({}) } } };
  vm.runInNewContext(readFileSync(require.resolve('../assets/common.js'), 'utf8'), ctx);
  return ctx.window.App;
}

test('Расходник и выдача имеют разные подписи, старый статус остаётся записью', () => {
  const A = app();
  assert.equal(A.payView('reserved').label, 'Деньги отложены');
  assert.equal(A.payView('paid').label, 'Деньги выданы');
  assert.equal(A.payView('accrued').label, 'Запись');
  assert.equal(A.payView('constructor').label, 'Запись');
});

test('День магазина и дата выдачи используют московское время', () => {
  const A = app();
  assert.equal(A.today(), '2026-11-20');
  assert.equal(A.isoDay('2026-11-19T22:30:00Z'), '2026-11-20');
  assert.equal(A.fmtDate('2026-11-19T22:30:00Z'), '20.11.2026');
  assert.equal(A.fmtDate('2026-11-19'), '19.11.2026');
  assert.equal(A.addDays('2024-02-28', 1), '2024-02-29');
  assert.equal(A.addDays('2026-12-31', 1), '2027-01-01');
});

test('Старая офлайн-выдача требует проверки, изменение заказа отправляется как прежде', () => {
  const A = app();
  const items = [{ id: 'pay', table: 'payouts', op: 'update', row: { status: 'paid', paid_at: '2026-01-01' } },
    { id: 'order', table: 'orders', op: 'update', row: { status: 'delivered' } }];
  const result = A.reviewPayoutQueue(items);
  assert.equal(result.review.length, 1);
  assert.equal(result.ready.length, 1);
  assert.equal(result.ready[0].id, 'order');
  assert.equal(items[0].row.status, 'paid');
});

test('Старый офлайн-ввод сохраняет реквизиты, не подтверждает деньги и не мигрирует повторно', () => {
  const A = app();
  const original = { id: 'pay', table: 'payouts', op: 'insert', row: { status: 'paid', amount: 100, rep_id: 'rep', paid_by: 'forged' } };
  const result = A.reviewPayoutQueue([original]);
  assert.equal(result.ready[0].row.status, 'to_pay');
  assert.equal(result.ready[0].row.amount, 100);
  assert.equal(result.ready[0].row.rep_id, 'rep');
  assert.equal(result.ready[0].row.paid_by, undefined);
  assert.equal(result.review[0].row.status, 'paid');
  assert.equal(A.reviewPayoutQueue(result.ready).review.length, 0);
});

test('Старое редактирование сохраняет сумму и комментарий без неподтверждённого статуса', () => {
  const A = app();
  const { ready, review } = A.reviewPayoutQueue([{ id: 'pay', table: 'payouts', op: 'update', row: { status: 'to_pay', amount: 52.25, comment: 'Тест' } }]);
  assert.equal(ready.length, 1);
  assert.equal(ready[0].row.status, undefined);
  assert.equal(ready[0].row.amount, 52.25);
  assert.equal(ready[0].row.comment, 'Тест');
  assert.equal(review.length, 1);
});

test('Прежнее офлайн-удаление выплаты требует проверки, новое остаётся в очереди', () => {
  const A = app();
  const { ready, review } = A.reviewPayoutQueue([
    { id: 'old', table: 'payouts', op: 'delete', row: {} },
    { id: 'new', table: 'payouts', op: 'delete', row: {}, queue_version: 2 },
  ]);
  assert.equal(ready.length, 1);
  assert.equal(ready[0].id, 'new');
  assert.equal(review.length, 1);
  assert.equal(review[0].id, 'old');
});
