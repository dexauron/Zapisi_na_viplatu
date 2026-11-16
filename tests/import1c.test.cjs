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
