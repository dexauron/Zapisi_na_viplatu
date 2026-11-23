const { test } = require('node:test');
const assert = require('node:assert/strict');
const Search = require('../assets/search.js');

const person = { names: ['Иванов Иван Иванович'], companies: ['ИП Петров Алексей Сергеевич'], phones: ['+7 (900) 123-45-67'] };
for (const query of ['Иванов Иван', 'иван иванов', 'Иванов И. И.', 'Иванов И.И.', 'Ivanov Ivan', 'Bdfyjd', 'Иванво', 'И.П. Петров', 'индивидуальный предприниматель Петров', '+79001234567']) {
  test('ФИО / ИП: ' + query, () => assert.ok(Search.score(query, person) > 0));
}
test('Запрос не теряет часть ФИО и не подбирает произвольного человека', () => {
  assert.equal(Search.score('Иванов Петр', { names: person.names }), 0);
  assert.equal(Search.score('Иванов И. П.', { names: person.names }), 0);
  assert.equal(Search.score('ИП Иванов', { names: ['Иванов Иван'], companies: [] }), 0);
});
test('Другая раскладка сохраняет клавиши с пунктуацией', () => {
  assert.ok(Search.score('F,lekkf', { names: ['Абдулла'] }) > 0);
});
test('Инициалы перед фамилией не требуют компанию ИП', () => {
  const fields = { names: ['Иванов Иван Петрович'] };
  assert.ok(Search.score('И. П. Иванов', fields) > 0);
  assert.ok(Search.score('И.П. Иванов', fields) > 0);
  assert.equal(Search.score('И. П. Иванов', { names: ['Иванов Иван Иванович'] }), 0);
});
test('Слово рублей распознаётся как валюта, фамилия Рубцов остаётся именем', () => {
  assert.ok(Search.score('15000,50 рублей', { amounts: [15000.5] }) > 0);
  assert.ok(Search.score('Рубцов 12345', { names: ['Рубцов'], numbers: ['12345'] }) > 0);
});
test('Подсветка после № и составных Unicode-символов сохраняет позиции', () => {
  assert.equal(Search.mark('№ ПФ-00012345', '12345'), '№ ПФ-000<mark>12345</mark>');
  assert.equal(Search.mark('ﬁ Иванов', 'Иванов'), 'ﬁ <mark>Иванов</mark>');
});
test('Неподдерживаемая транслитерация не становится пустым совпадением', () => {
  assert.equal(Search.score('محمد', { names: ['Иванов Иван'] }), 0);
  assert.ok(Search.score('محمد', { names: ['محمد أحمد'] }) > 0);
});
for (const query of ['+7 (900) 123-45-67', '8 900 123 45 67', '79001234567']) {
  test('Вставленный номер телефона: ' + query, () => assert.ok(Search.score(query, person) > 0));
}
test('Точное ФИО выше опечатки и вхождения в комментарий', () => {
  const rows = [{ id: 1, names: ['Ивановв'], text: [] }, { id: 2, names: [], text: ['звонок Иванову'] }, { id: 3, names: ['Иванов'] }];
  assert.equal(Search.rank('Иванов', rows, r => r)[0].id, 3);
});
for (const query of ['15000.5', '15000,50', '15 000,50', '15\u202f000,50 ₽', '15.000,50', 'сумма 15000,50']) {
  test('Сумма: ' + query, () => {
    assert.ok(Search.score(query, { amounts: [15000.5] }) > 0);
    assert.equal(Search.score(query, { amounts: [15000.51] }), 0);
    assert.equal(Search.score(query, { amounts: [150000.5] }), 0);
  });
}
test('Сумма сравнивается целиком, а не как набор цифр в разных полях', () => {
  assert.equal(Search.score('15 000,50', { numbers: ['15', '000', '50'], amounts: [15] }), 0);
  assert.equal(Search.score('15000,50 ₽', { numbers: ['1500050'], amounts: [10] }), 0);
  assert.equal(Search.amountCents('15 00,50'), null);
});
test('Сумма и ФИО работают в одном запросе и в любом порядке', () => {
  const doc = { ...person, amounts: [15000.5] };
  assert.ok(Search.score('Петров 15 000,50', doc) > 0);
  assert.ok(Search.score('15000,50 Петров', doc) > 0);
  assert.equal(Search.score('Петров 15000,51', doc), 0);
});
for (const query of ['12345', '№ 12345', 'ПФ-00012345', 'пф12345', 'PF12345', 'накладная 12345']) {
  test('Номер накладной: ' + query, () => assert.ok(Search.score(query, { numbers: ['ПФ-00012345'] }) > 0));
}
test('Номера не получают допуск на опечатки', () => {
  assert.equal(Search.score('12354', { numbers: ['12345'] }), 0);
  assert.equal(Search.score('12346', { numbers: ['12345'] }), 0);
  assert.equal(Search.score('KA-13245', { numbers: ['КА-12345'] }), 0);
  assert.ok(Search.score('KA-12345', { numbers: ['КА-12345'] }) > 0);
});
test('Точная сумма и номер выше совпадения части номера', () => {
  const rows = [{ id: 1, numbers: ['1234500'], amounts: [2] }, { id: 2, numbers: ['12345'], amounts: [3] }, { id: 3, numbers: [], amounts: [12345] }];
  const ids = Search.rank('12345', rows, r => r).map(r => r.id);
  assert.ok(ids.indexOf(2) < ids.indexOf(1));
  assert.ok(ids.indexOf(3) < ids.indexOf(1));
});
test('Пустой запрос, пустые поля и неподдерживаемый ввод безопасны', () => {
  assert.equal(Search.matches('', null, undefined), true);
  assert.equal(Search.score('!!!', person), 0);
  assert.equal(Search.score('x'.repeat(161), person), 0);
  assert.equal(Search.score('-15000', { amounts: [15000] }), 0);
});
test('Подсветка экранирует HTML и не меняет пользовательский текст', () => {
  assert.equal(Search.mark('<img onerror=alert(1)> Иванов', 'Иванов'), '&lt;img onerror=alert(1)&gt; <mark>Иванов</mark>');
  assert.equal(Search.mark('ИВАНОВ', 'иванов'), '<mark>ИВАНОВ</mark>');
});
test('Старый интерфейс matches сохраняется для неструктурированных вызовов', () => {
  assert.equal(Search.matches('иван', 'Иванов', null), true);
  assert.equal(Search.matches('15000,50', 'Накладная', 15000.5), true);
});
