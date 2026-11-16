const assert = require('node:assert/strict');
const { test } = require('node:test');
const Doc1C = require('../assets/import1c.js');

const invoice = 'Приходная накладная';
const doc = (number, day) => invoice + ' ' + number + ' от ' + day + '.11.2026 10:30';
const list = (...rows) => Doc1C.parse([
  ['Тип объекта: Документ', 'Имя объекта: ' + invoice],
  [invoice, 'Контрагент', 'Сумма документа', 'Входящий номер документа'],
  ...rows,
]);

test('Суммы округляются до копейки и проверяются целиком', () => {
  assert.equal(Doc1C.num('1 234,565'), 1234.57);
  assert.equal(Doc1C.num(-1.005), -1.01);
  assert.equal(Doc1C.num(1e-7), 0);
  assert.equal(Doc1C.num(' '), null);
  assert.equal(Doc1C.num('12 сом'), null);
  assert.equal(Doc1C.num('1000000000000'), null);
});

test('Даты проверяются и сохраняют время из Excel', () => {
  assert.equal(Doc1C.date('29.02.2024 9:05', true), '2024-02-29T09:05:00');
  assert.equal(Doc1C.date('29.02.2026'), null);
  assert.equal(Doc1C.date('31.11.2026'), null);
  assert.equal(Doc1C.date('01.11.2026 24:00'), null);
  assert.equal(Doc1C.date('01.11.2026 неверное время'), null);
  assert.equal(Doc1C.date(25569.5, true), '1970-01-01T12:00:00');
  assert.equal(Doc1C.date(60), null);
});

test('Ошибка в строке 1С видна до отправки', () => {
  assert.throws(() => list([doc('001', '05'), 'Тест', 1], [doc('002', '31'), 'Тест', 2]), /Строка 4: неверная дата/);
  assert.throws(() => list([doc('001', '05'), 'Тест', 'ошибка']), /Строка 3: неверная сумма/);
});

test('Пропущенные строки исключают автоматическую пометку отсутствующих документов', () => {
  const parsed = list([doc('001', '05'), 'Тест', 1], [doc('002', '08'), '', 2]);
  assert.equal(parsed.skipped, 1);
  assert.equal(parsed.scope.from, null);
  assert.equal(parsed.rows.length, 1);
});

test('Одинаковые списки не меняют источник суммы и не удваивают документы', () => {
  const a = list([doc('001', '05'), 'Тест', 1, '0009']);
  const [group] = Doc1C.merge([a, a]);
  assert.equal(group.rows.length, 1);
  assert.equal(group.rows[0].src, 'l');
  assert.equal(group.rows[0].in_no, '0009');
  assert.throws(() => Doc1C.merge([a, list([doc('001', '05'), 'Тест', 2])]), /разные сведения/);
});

test('Взаиморасчёты определяют сумму, список дополняет номер', () => {
  const a = list([doc('001', '05'), 'Тест', 1, '0009']);
  const report = Doc1C.parse([
    ['Контрагент', 'Увеличение долга', 'Уменьшение долга'],
    ['Тест'],
    [doc('001', '05'), '2,30', ''],
  ]);
  const [group] = Doc1C.merge([a, report]);
  assert.equal(group.rows[0].src, 'v');
  assert.equal(group.rows[0].inc, 2.3);
  assert.equal(group.rows[0].in_no, '0009');
});

test('РКО без суммы дополняется ведомостью, прочие операции не считаются оплатой поставщику', () => {
  const cashOrder = 'Расходный кассовый ордер';
  const title = (n) => `${cashOrder} ${n} от 05.11.2026 10:30`;
  const a = Doc1C.parse([
    ['Тип объекта: Документ', 'Имя объекта: ' + cashOrder],
    [cashOrder, 'Контрагент', 'Сумма', 'Вид операции', 'Планируемая сумма оплаты'],
    [title('001'), 'Тест', null, 'Выплата контрагенту', 999],
    [title('002'), 'Тест', '', 'Выплата контрагенту', 420],
    [title('003'), 'Тест', 75, 'Выплата сотруднику'],
    [title('004'), 'Тест', 0, 'Выплата контрагенту'],
  ]);
  const report = Doc1C.parse([
    ['Контрагент', 'Увеличение долга', 'Уменьшение долга'],
    ['Тест'], [title('001'), null, 100],
  ]);
  assert.deepEqual(a.missingAmounts, [3, 4]);
  assert.equal(a.otherOperations, 1);
  assert.equal(a.scope.from, null);
  const { groups, stats } = Doc1C.prepareDocs([a, report]);
  assert.deepEqual(stats.get(a), { blank: 1, recovered: 1, unconfirmed: 0 });
  assert.deepEqual(groups.flatMap((g) => g.rows).map((r) => [r.num, r.dec]), [['001', 100], ['004', 0]]);
  assert.deepEqual(Doc1C.merge([a]).flatMap((g) => g.rows).map((r) => r.num), ['004']);
});

test('Ведомость с проверенным итогом определяет состав движений за тот же период', () => {
  const period = 'Период: 01.11.2026 - 30.11.2026';
  const a = Doc1C.parse([
    [period, 'Тип объекта: Документ', 'Имя объекта: ' + invoice],
    [invoice, 'Контрагент', 'Сумма документа'],
    [doc('001', '05'), 'Тест', 1], [doc('002', '05'), 'Тест', 7],
  ]);
  const statement = [
    [period], ['Контрагент', 'Увеличение долга', 'Уменьшение долга'],
    ['Тест'], [doc('001', '05'), 1, null], ['Итого', 1, null],
  ];
  const report = Doc1C.parse(statement);
  const prepared = Doc1C.prepareDocs([a, report]);
  assert.equal(prepared.stats.get(a).unconfirmed, 1);
  assert.deepEqual(prepared.groups.flatMap((g) => g.rows).map((r) => r.num), ['001']);
  const filtered = Doc1C.parse([['Отбор: Контрагент = Тест'], ...statement]);
  assert.equal(Doc1C.merge([a, filtered]).flatMap((g) => g.rows).length, 2);
  assert.throws(() => Doc1C.parse([...statement.slice(0, -1), ['Итого', 2, null]]), /не совпадают/);
});

const register = (kind, secondCost, costTotal) => {
  const config = Doc1C.registers[kind];
  const returns = kind === 'returns_by_reason';
  return Doc1C.parse([
    [], ['Тип объекта: Регистр накопления', 'Имя объекта: ' + config.title, 'Период: 01.01.2024 - 14.11.2026'],
    ['Номенклатура', null, 'Склад', config.supplier, config.reason, 'Количество', 'Себестоимость в регламентной валюте',
      'Приходная сумма в регламентной валюте', 'Приходная сумма в управленческой валюте', 'Розничная сумма в регламентной валюте',
      'Количество записей', ...(returns ? ['Договор'] : [])],
    ['Товар', null, 'Магазин', 'Тест', 'Брак', '1,234', '10,01', 11, 12, 13, 2, ...(returns ? ['Основной'] : [])],
    [null, null, 'Магазин', 'Тест', null, 0.001, secondCost, null, null, null, 1],
    ['Итого', null, null, null, null, '1,235', costTotal, 11, 12, 13, 3],
  ]);
};

test('Регистры сверяются с итогом 1С и обновляются целиком за период', () => {
  const a = register('returns_by_reason', null, '10,01');
  const b = register('writeoff_reasons', '1,03', '11,04');
  assert.equal(a.report.rows[0].contract, 'Основной');
  assert.equal(b.report.rows[1].reason, null);
  assert.equal(b.report.summary.total.quantity, 1235);
  assert.equal(b.report.summary.total.cost, 1104);
  assert.equal(b.report.summary.total.movements, 3);
  assert.equal(Doc1C.mergeReports([a, b, a]).length, 2);
  assert.throws(() => Doc1C.mergeReports([a, register('returns_by_reason', 1, '11,01')]), /разные версии/);
  assert.throws(() => register('writeoff_reasons', '1,03', '11,05'), /не совпадают/);
  assert.throws(() => register('writeoff_reasons', 'ошибка', '11,04'), /Строка 5/);
});
