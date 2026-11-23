// Сценарии реальных страниц с вымышленным API. JSDOM проверяет поведение, не CSS.
const assert = require('node:assert/strict');
const { fixture, server, adm, rep, ids } = require('./ui-payouts.cjs');
let checks = 0;
const ok = (v, message) => { assert.ok(v, message); checks++; };
const json = body => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
const rep2 = '33333333-3333-4333-8333-333333333333';
const docId = '44444444-4444-4444-8444-444444444444';
const reps = [{ id: rep, full_name: 'Иванов Иван Петрович', company: 'ИП Примеров Алексей', active: true },
  { id: rep2, full_name: 'Иванов Пётр Сергеевич', company: 'ООО Пример', active: true }];
const pays = [
  { id: ids[0], rep_id: rep, amount: 15000.50, status: 'reserved', reserved_amount: 100, payout_date: '2012-01-01', invoice_no: 'ПФ-00012345', doc_id: docId },
  { id: ids[1], rep_id: rep, amount: 500, status: 'to_pay', reserved_amount: 0, payout_date: '2026-11-20', invoice_no: '123456' },
  { id: ids[2], rep_id: rep2, amount: 15000.51, status: 'to_pay', reserved_amount: 0, payout_date: '2026-11-20', invoice_no: '12346' },
];
const archived = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4', rep_id: rep, amount: 15000.5, status: 'paid', payout_date: '2010-01-01', paid_at: '2010-01-01T07:00:00Z', paid_by: adm, invoice_no: 'ARCH-1' };
const invoice = { id: '55555555-5555-4555-8555-555555555555', rep_id: rep, in_no: '87654', num: 'TEST-87654', at: '2011-01-01T10:00:00', inc: 123.45, open: 123.45 };

(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + server.address().port, windows = [];
  try {
    const requests = []; let releaseOld;
    const f = await fixture(base, '/app.html', 390, { reps, pays,
      state: { history: 0, invoiceError: false },
      async respond(url, init, state) {
        if (url.pathname === '/rest/v1/payouts' && url.searchParams.has('payout_date')) {
          state.history++; return json([archived]);
        }
        if (url.pathname.endsWith('/rpc/search_invoices')) {
          const params = JSON.parse(init.body); requests.push(params);
          if (state.invoiceError) return new Response(JSON.stringify({ code: 'PGRST000', message: 'Failed to fetch' }), { status: 503 });
          if (params.p_filter.query === '87654') return new Promise(resolve => { releaseOld = () => resolve(json({ items: [invoice], total: 1 })); });
          if (params.p_filter.query === '98765' || params.p_filter.query === '43210') return json({ items: [{ ...invoice, in_no: params.p_filter.query }], total: 55 });
          return json({ items: [], total: 0 });
        }
      }
    }); windows.push(f.dom.window);
    const { doc, click, until, state } = f, w = f.dom.window;
    const search = value => { const input = doc.querySelector('#q'); input.value = value; input.dispatchEvent(new w.Event('input', { bubbles: true })); input.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); };
    await until(() => doc.querySelector('#tabs [data-tab=payouts]'));
    ok(!doc.querySelector('#nav-plus'), 'Нет дублирующего плюса в шапке');
    click('#tabs [data-tab=payouts]');
    ok(doc.querySelectorAll('#view-create').length === 1, 'На вкладке одна кнопка создания');
    click('[data-seg=reserved].stat'); search('15000,50');
    await until(() => state.history && doc.querySelector('[data-pay="'+archived.id+'"]'));
    ok(doc.querySelectorAll('[data-pay]').length === 2, 'Сумма найдена в активной и старой выданной записи');
    ok(!doc.querySelector('[data-pay="'+ids[2]+'"]'), 'Лишняя копейка не подходит');
    ok(doc.querySelector('.search-summary').textContent.includes('По всем датам'), 'Поиск показывает завершённую загрузку истории');
    ok(!doc.querySelector('[data-seg=reserved]').classList.contains('on'), 'Старый фильтр не скрывает найденное');
    search('12345');
    await until(() => doc.querySelectorAll('[data-pay]').length === 2);
    ok(doc.querySelector('[data-pay]').dataset.pay === ids[0], 'Точный старый номер выше нового частичного');
    search('И. П. Иванов');
    await until(() => requests.some(r => r.p_filter.query === 'И. П. Иванов'));
    const sent = requests.find(r => r.p_filter.query === 'И. П. Иванов').p_filter;
    ok(sent.rep_ids.length === 1 && sent.rep_ids[0] === rep, 'Инициалы дают правильного поставщика в архиве');
    ok(sent.exclude_ids.includes(docId), 'Накладная найденной выплаты исключается из второй выдачи');
    search('87654'); await until(() => releaseOld);
    search('98765'); await until(() => doc.querySelector('[data-inv-rec]'));
    releaseOld(); await new Promise(resolve => setImmediate(resolve));
    ok(doc.querySelector('#inv-found').textContent.includes('98765') && !doc.querySelector('#inv-found').textContent.includes('87654'), 'Медленный старый ответ не заменяет новый поиск');
    ok(!doc.querySelector('[data-inv-paid]') && !doc.querySelector('#inv-found').textContent.includes('Деньги выданы'), 'В поиске нет быстрого подтверждения выдачи');
    ok(doc.querySelector('#inv-found').textContent.includes('1 из 55'), 'Архив сообщает полный счётчик');
    ok(doc.querySelector('[data-search-count]').textContent === '55', 'Общий счётчик включает архивные накладные');
    click('#inv-more'); await until(() => requests.some(r => r.p_filter.query === '98765' && r.p_limit === 80));
    ok(requests.some(r => r.p_limit === 80), 'Можно загрузить следующую порцию накладных');
    state.invoiceError = true; search('43210'); await until(() => doc.querySelector('#inv-retry'));
    ok(doc.querySelector('#inv-found').textContent.includes('Сохранённые записи'), 'Ошибка архива не объявляется отсутствием результатов');
    state.invoiceError = false; click('#inv-retry'); await until(() => doc.querySelector('[data-inv-rec]'));
    ok(doc.querySelector('#inv-found').textContent.includes('43210'), 'Повторный запрос после ошибки работает');
    state.online = false; search('15000,50');
    ok(doc.querySelector('.search-summary').textContent.includes('без сети'), 'Видна граница поиска без интернета');
    ok(doc.querySelectorAll('[data-pay]').length === 2, 'Без сети доступна сохранённая история');
    doc.querySelector('#q').dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    ok(doc.querySelector('#q').value === '' && !doc.querySelector('.search-summary'), 'Escape очищает поиск и возвращает обычный список');
    state.online = true; click('#tabs [data-tab=today]'); search('ARCH-1');
    await until(() => doc.querySelector('[data-pay="'+archived.id+'"]'));
    ok(doc.querySelector('[data-pay="'+archived.id+'"]'), 'Сегодня ищет старую запись');
    ok(state.calls === 0, 'Поиск не меняет выдачу денег');
    ok(f.errors.length === 0, f.errors.join('; '));
    f.dom.window.close();

    const r = await fixture(base, '/index.html#'+'a'.repeat(36), 390, { reps, pays: pays.slice(0, 2) }); windows.push(r.dom.window);
    await r.until(() => r.doc.querySelector('#seg [data-t=payouts]')); r.click('#seg [data-t=payouts]');
    const ri = r.doc.querySelector('#q'); ri.value = '12345'; ri.dispatchEvent(new r.dom.window.Event('input', { bubbles: true })); ri.dispatchEvent(new r.dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    ok(r.doc.querySelector('#list [data-id]').dataset.id === ids[0], 'Кабинет ТП сохраняет релевантность вместо сортировки по дате');
    ok(!r.doc.querySelector('#list .section-h'), 'Поиск в кабинете не смешивает релевантность с месяцами');
    ok(r.errors.length === 0, r.errors.join('; ')); r.dom.window.close();
    const s = await fixture(base, '/list.html#'+'b'.repeat(36), 390, { reps, pays }); windows.push(s.dom.window);
    await s.until(() => s.doc.querySelector('[data-rep]'));
    const si = s.doc.querySelector('#q'); si.value = '15 000,50'; si.dispatchEvent(new s.dom.window.Event('input', { bubbles: true })); si.dispatchEvent(new s.dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    ok(s.doc.querySelector('#list').textContent.includes('ПФ-00012345'), 'Общий график ищет сумму с разделителями');
    ok(!s.doc.querySelector('#list').textContent.includes('12346'), 'Общий график не теряет копейки');
    ok(s.errors.length === 0, s.errors.join('; ')); s.dom.window.close();
    console.log('Search DOM PASS: '+checks+' checks; CSS rendering not tested');
  } finally { for (const w of windows) w.close(); server.close(); }
})().catch(error => { console.error(error); server.close(); process.exitCode = 1; });
