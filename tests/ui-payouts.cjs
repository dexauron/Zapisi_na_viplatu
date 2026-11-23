// Проверки настоящих HTML-страниц на вымышленных ответах API. Боевая база не используется.
// JSDOM_MODULE=/path/to/jsdom node tests/ui-payouts.cjs
// Проверяется поведение DOM, а не визуальная отрисовка CSS.
const { JSDOM, VirtualConsole } = require(process.env.JSDOM_MODULE || 'jsdom');
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const adm = '11111111-1111-4111-8111-111111111111';
const rep = '22222222-2222-4222-8222-222222222222';
const ids = ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3'];
let checks = 0;
const ok = (value, message) => { assert.ok(value, message); checks++; };
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };
const server = http.createServer(async (req, res) => {
  try {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    if (pathname === '/assets/config.js') {
      res.setHeader('Content-Type', 'text/javascript');
      return res.end("window.APP_CONFIG={SUPABASE_URL:'https://fixture.supabase.invalid',SUPABASE_KEY:'fixture'};");
    }
    const filename = path.resolve(root, '.' + pathname);
    if (!filename.startsWith(root + path.sep)) { res.writeHead(403); return res.end(); }
    const content = await fs.readFile(filename);
    res.setHeader('Content-Type', mime[path.extname(filename)] || 'application/octet-stream'); res.end(content);
  } catch { res.writeHead(404); res.end(); }
});

async function fixture(base, target, width, options = {}) {
  const errors = [], state = { calls: 0, stale: false, accept: false, online: true, ...options.state };
  const reps = options.reps || [{ id: rep, full_name: 'Тестовый торговый', company: 'Тестовая компания', active: true }];
  const pays = (options.pays || [
    { id: ids[0], rep_id: rep, amount: 150, status: 'reserved', reserved_amount: 100, reserved_at: '2026-11-01T07:00:00Z', payout_date: '2026-01-01', invoice_no: 'RES-1' },
    { id: ids[1], rep_id: rep, amount: 50, status: 'to_pay', reserved_amount: 0, payout_date: '2026-11-20', invoice_no: 'PLAN-1' },
    { id: ids[2], rep_id: rep, amount: 25, status: 'paid', reserved_amount: 25, payout_date: '2026-11-20', invoice_no: 'DONE-1', paid_at: '2026-11-20T06:00:00Z', paid_by: adm },
  ]).map(p => ({ basis: null, comment: null, received_at: null, paid_at: null, paid_by: null, created_at: '2026-11-01T06:00:00Z', updated_at: '2026-11-20T06:00:00.000001Z', ...p }));
  const console = new VirtualConsole();
  console.on('jsdomError', e => errors.push(e.message));
  const dom = await JSDOM.fromURL(base + target, {
    resources: 'usable', runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: console,
    beforeParse(w) {
      const NativeDate = w.Date;
      w.Date = class extends NativeDate { constructor(...args) { super(...(args.length ? args : ['2026-11-20T07:00:00Z'])); } static now() { return new NativeDate('2026-11-20T07:00:00Z').getTime(); } };
      Object.assign(w, { TextEncoder, TextDecoder, Request, Response, Headers, AbortController,
        scrollTo: () => {}, confirm: () => state.accept, matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) });
      Object.defineProperty(w, 'innerWidth', { value: width });
      Object.defineProperty(w.navigator, 'onLine', { get: () => state.online });
      const payload = Buffer.from(JSON.stringify({ sub: adm, role: 'authenticated', exp: 2000000000 })).toString('base64url');
      w.localStorage.setItem('sb-fixture-auth-token', JSON.stringify({ access_token: 'fixture.' + payload + '.fixture', refresh_token: 'fixture', token_type: 'bearer', expires_at: 2000000000, user: { id: adm, email: 'fixture@staff.zapisi.app' } }));
      w.fetch = async (input, init = {}) => {
        if (!state.online) throw new TypeError('Failed to fetch');
        const url = new URL(typeof input === 'string' ? input : input.url);
        if (options.respond) { const response = await options.respond(url, init, state); if (response !== undefined) return response; }
        const rpc = url.pathname.split('/rpc/')[1];
        let body = [];
        if (rpc === 'app_bootstrap') body = { me: { user_id: adm, role: 'admin', active: true, full_name: 'Тестовый администратор' },
          reps, stores: [], orders: options.orders || [], payouts: pays,
          staff: [{ user_id: adm, full_name: 'Тестовый администратор', role: 'admin', active: true }], access: [], rep_users: [], unrec: { n: 0, sum: 0 }, open1c: { n: 0, sum: 0 } };
        else if (rpc === 'get_rep_data') body = { rep: reps[0], shop: 'Тестовый магазин', orders: options.repOrders || [], docs: options.docs || [], debt: 0, payouts: pays.map(p => ({ ...p, date: p.payout_date, store: 'Тестовый магазин' })) };
        else if (rpc === 'get_payout_schedule') body = pays.filter(p => p.status !== 'paid').map(p => ({ ...p, date: p.payout_date, rep: reps.find(r => r.id === p.rep_id)?.full_name, company: reps.find(r => r.id === p.rep_id)?.company }));
        else if (rpc === 'set_payout_paid') {
          state.calls++;
          if (state.stale) return new Response(JSON.stringify({ code: '40001', message: 'Запись уже изменилась. Обновите список и проверьте сумму' }), { status: 409, headers: { 'Content-Type': 'application/json' } });
          const params = JSON.parse(init.body), p = pays.find(x => x.id === params.p_id);
          Object.assign(p, { status: params.p_paid ? 'paid' : p.reserved_amount ? 'reserved' : 'to_pay', paid_at: params.p_paid ? '2026-11-20T07:00:00Z' : null, paid_by: params.p_paid ? adm : null, updated_at: '2026-11-20T07:00:00.000002Z' });
          body = p;
        } else if (url.pathname === '/auth/v1/user') body = { id: adm, email: 'fixture@staff.zapisi.app' };
        return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
      };
    },
  });
  const doc = dom.window.document;
  const until = async (condition) => { for(let i=0;i<400;i++){if(condition())return;await new Promise(r=>setTimeout(r,20));} throw new Error('DOM timeout: '+doc.body.textContent.slice(0,1200)+'; '+errors.join('; ')); };
  const click = selector => { const e = doc.querySelector(selector); assert.ok(e, 'Нет элемента '+selector); e.click(); };
  return { dom, doc, state, errors, until, click };
}

module.exports = { fixture, server, adm, rep, ids };
if (require.main === module) (async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  const windows = [];
  try {
    for(const width of [390,1280]) {
      const f = await fixture(base, '/app.html', width); windows.push(f.dom.window);
      const { doc, state, click, until } = f;
      await until(() => doc.querySelector('#tabs [data-tab=payouts]'));
      click('#tabs [data-tab=payouts]');
      ok(doc.querySelector('[data-seg=to_pay].stat .v').textContent.includes('200,00'),'Ожидающая сумма включает незарезервированную часть');
      ok(doc.querySelector('[data-seg=reserved].stat .v').textContent.includes('100,00'),'В конвертах учитывается только сумма РКО');
      ok(doc.querySelector('[data-seg=reserved].stat').textContent.includes('Деньги отложены'), 'Резерв имеет нужное название');
      click('[data-seg=reserved].stat');
      ok(doc.querySelectorAll('[data-pay]').length===1,'Отдельный фильтр резерва');
      ok(doc.querySelector('[data-pay]').textContent.includes('RES-1'),'Старая запись видна вне текущего месяца');
      click('[data-pay] [data-tick]');
      ok(state.calls===0,'Отмена диалога не подтверждает выдачу');
      await new Promise(r=>setImmediate(r));
      state.accept=true;
      click('[data-pay] [data-tick]');click('[data-pay] [data-tick]');
      await until(()=>doc.querySelector('[data-seg=paid].stat').textContent.includes('Деньги выданы · 2'));
      ok(state.calls===1,'Двойное нажатие отправляет одну команду');
      click('[data-seg=paid].stat');click('[data-pay="'+ids[0]+'"]');
      ok(doc.querySelector('.sheet').textContent.includes('Деньги выданы'),'Карточка подтверждённой выдачи');
      ok(!doc.querySelector('.sheet [data-act=delete]'),'Выданную выплату нельзя удалить');
      f.dom.window.App.dismissOverlays();
      click('[data-seg=paid].stat');
      state.online=false;click('[data-pay="'+ids[1]+'"] [data-tick]');
      await until(()=>doc.body.textContent.includes('подключитесь к сети'));
      ok(state.calls===1,'Офлайн-выдача не отправляется');
      state.online=true;state.stale=true;click('[data-pay="'+ids[1]+'"] [data-tick]');
      await until(()=>doc.body.textContent.includes('Запись уже изменилась'));
      ok(state.calls===2,'Обрабатывается конфликт версий');
      ok(f.errors.length===0,f.errors.join('; '));
      f.dom.window.close();
      const r=await fixture(base,'/index.html#'+'a'.repeat(36),width);windows.push(r.dom.window);
      await r.until(()=>r.doc.querySelector('#seg [data-t=payouts]'));
      r.click('#seg [data-t=payouts]');
      ok(r.doc.querySelector('#stats [data-k=to_pay] .v').textContent.includes('200,00'),'ТП видит всю ожидающую сумму');
      r.click('#stats [data-k=reserved]');
      ok(r.doc.querySelector('#list').textContent.includes('RES-1'),'ТП видит резерв вне периода');
      r.click('#list .cell');
      ok(!r.doc.querySelector('#got'),'Получение невыданного резерва подтвердить нельзя');
      ok(r.errors.length===0,r.errors.join('; '));r.dom.window.close();
      const s=await fixture(base,'/list.html#'+'b'.repeat(36),width);windows.push(s.dom.window);
      await s.until(()=>s.doc.querySelector('[data-rep]'));
      ok(s.doc.querySelector('#list').textContent.includes('Деньги отложены'),'Общая ссылка показывает резерв');
      ok(!s.doc.querySelector('#list').textContent.includes('DONE-1'),'Общая ссылка скрывает выданное');
      ok(s.errors.length===0,s.errors.join('; '));s.dom.window.close();
    }
    console.log('DOM PASS: '+checks+' checks, administrator, representative and shared link; CSS rendering not tested');
  } finally { for(const w of windows)w.close();server.close(); }
})().catch(error=>{console.error(error);server.close();process.exitCode=1;});
