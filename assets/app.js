// Приложение сотрудников магазина и администратора
(function () {
  const A = window.App;
  const sb = A.sb;
  const $ = (id) => document.getElementById(id);
  const E = A.esc;
  const STAFF_DOMAIN = 'staff.zapisi.app', REP_DOMAIN = 'rep.zapisi.app';

  const st = {
    me: null, tab: 'today', back: 'today', cal: null,
    reps: [], stores: [], orders: [], payouts: [], access: [], repUsers: [], staff: [],
    seg: { today: 'today', orders: 'wait', payouts: 'all', dir: 'reps' }, q: { orders: '', payouts: '', dir: '' },
  };
  const isAdmin = () => st.me?.role === 'admin';

  const SVG = (d) => `<svg viewBox="0 0 24 24"><path d="${d}"/></svg>`;
  const TABS = [
    { id: 'today', label: 'Сегодня', icon: SVG('M7 2h2v2h6V2h2v2h2a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2V2ZM5 9v10h14V9H5Zm2 2h4v4H7v-4Z') },
    { id: 'orders', label: 'Заказы', icon: SVG('M7 4h10l1 3h3v2h-1.3l-1.6 10.2A2 2 0 0 1 16.1 21H7.9a2 2 0 0 1-2-1.8L4.3 9H3V7h3l1-3Zm-.7 5 1.6 10h8.2l1.6-10H6.3ZM8.4 6l-.3 1h7.8l-.3-1H8.4Z') },
    { id: 'payouts', label: 'Выплаты', admin: true, icon: SVG('M3 6h18a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1Zm1 2v8h16V8H4Zm8 1.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5ZM6 10h2v4H6v-4Zm10 0h2v4h-2v-4Z') },
    { id: 'sum', label: 'Сводка', admin: true, icon: SVG('M4 20V10h3v10H4Zm6.5 0V4h3v16h-3ZM17 20v-7h3v7h-3Z') },
    { id: 'dir', label: 'Представители', icon: SVG('M9 4a4 4 0 1 1 0 8 4 4 0 0 1 0-8Zm0 2a2 2 0 1 0 0 4 2 2 0 0 0 0-4Zm-7 14c0-3.3 3.1-5 7-5s7 1.7 7 5v1H2v-1Zm2.2-1h9.6c-.5-1.3-2.3-2-4.8-2s-4.3.7-4.8 2ZM16.5 5a3.5 3.5 0 0 1 0 7v-2a1.5 1.5 0 0 0 0-3V5Zm1.3 10c2.5.4 4.2 1.8 4.2 4v2h-3v-2c0-1.3-.6-2.4-1.2-3.1V15Z') },
    // «Ещё» внизу не показывается: его открывает кнопка с тремя чёрточками справа вверху
    { id: 'more', label: 'Ещё', top: true },
  ];

  // ---------- общие помощники ----------
  const fail = (error) => { if (error) A.toast(humanError(error), true); return !!error; };
  function humanError(e) {
    const m = e?.message || String(e);
    if (/foreign key|violates foreign/i.test(m)) return 'Нельзя удалить: есть связанные записи';
    if (/duplicate key/i.test(m)) return 'Такая запись уже есть';
    if (/Invalid login/i.test(m)) return 'Неверный логин или пароль';
    if (/banned/i.test(m)) return 'Учётная запись отключена';
    if (/row-level security/i.test(m)) return 'Недостаточно прав';
    if (/Failed to fetch|NetworkError/i.test(m)) return 'Нет связи с сервером';
    if (/expected_date/i.test(m)) return 'Дата прихода раньше даты заказа';
    return m;
  }
  const parseAmount = (v) => { const n = parseFloat(String(v).replace(/\s/g, '').replace(',', '.')); return Number.isFinite(n) ? Math.round(n * 100) / 100 : NaN; };
  const repById = (id) => st.reps.find((r) => r.id === id);
  const storeById = (id) => st.stores.find((s) => s.id === id);
  const coKey = (c) => String(c || '').toLowerCase().replace(/ё/g, 'е').replace(/[\s.,«»"']+/g, '');
  const repLabel = (r) => (r ? r.full_name + (r.company ? ` · ${r.company}` : '') : '—');
  const staffName = (id) => st.staff.find((s) => s.user_id === id)?.full_name;
  const sortRu = (arr, key) => arr.sort((a, b) => String(a[key]).localeCompare(String(b[key]), 'ru'));
  const field = (label, inner, cls = '') => `<label class="field ${cls}"><span>${E(label)}</span>${inner}</label>`;
  const opts = (items, label, sel) => items.map((i) => `<option value="${i.id}" ${i.id === sel ? 'selected' : ''}>${E(label(i))}</option>`).join('');
  const info = (rows) => `<div class="list">${rows.filter(([, v]) => v != null && v !== '').map(([k, v]) =>
    `<div class="cell static"><div class="main">${E(k)}</div><div class="value" style="text-align:right;white-space:normal;max-width:62%">${E(v)}</div></div>`).join('')}</div>`;
  const btn = (id, label, cls = 'plain') => `<button class="btn ${cls}" data-act="${id}" type="button">${E(label)}</button>`;
  const onActs = (api, map) => api.body.addEventListener('click', (e) => { const a = e.target.closest('[data-act]')?.dataset.act; if (a && map[a]) map[a](); });
  async function confirmAct(text) { return window.confirm(text); }

  // ---------- вход ----------
  $('login').addEventListener('submit', async (e) => {
    e.preventDefault();
    const u = $('l-user').value.trim().toLowerCase();
    const email = u.includes('@') ? u : `${u}@${STAFF_DOMAIN}`;
    const b = e.target.querySelector('button'); b.disabled = true;
    let { error } = await sb.auth.signInWithPassword({ email, password: $('l-pass').value });
    // логин представителя: его кабинет — на главной странице, там только его данные
    if (error && /Invalid login/i.test(error.message) && !u.includes('@')) {
      const r2 = await sb.auth.signInWithPassword({ email: `${u}@${REP_DOMAIN}`, password: $('l-pass').value });
      if (!r2.error) return location.replace('index.html');
    }
    b.disabled = false;
    if (fail(error)) return;
    try { localStorage.removeItem('sverka-cache'); } catch { /* */ }
    boot();
  });

  const withTimeout = (pr, ms) => Promise.race([pr, new Promise((_, no) => setTimeout(() => no(new Error('network timeout')), ms))]);
  async function boot() {
    $('boot').classList.remove('hidden');
    // Мгновенный старт: показываем сохранённые данные, свежие подгружаются фоном
    if (hasSavedSession() && cacheLoad() && st.me) {
      applyQueue(); showApp();
      if (navigator.onLine) refresh(true, false, true);
      return;
    }
    // Первый запуск на этом устройстве
    let session = null;
    try { ({ data: { session } } = await withTimeout(sb.auth.getSession(), 6000)); } catch { session = null; }
    if (!session) return showLogin();
    if (!(await loadAll())) return;
    lastLoad = Date.now();
    showApp();
  }
  function hasSavedSession() { try { return Object.keys(localStorage).some((k) => /^sb-.*-auth-token$/.test(k)); } catch { return false; } }
  function showApp() {
    if (!isAdmin() && (st.tab === 'payouts' || st.tab === 'sum')) st.tab = 'today';
    $('boot').classList.add('hidden');
    ['nav', 'page', 'tabbar'].forEach((id) => $(id).classList.remove('hidden'));
    document.body.classList.add('app-on');
    $('login').classList.add('hidden');
    renderTabs(); render(); offlineBar();
  }
  function showLogin() {
    $('boot').classList.add('hidden');
    ['nav', 'page', 'tabbar'].forEach((id) => $(id).classList.add('hidden'));
    document.body.classList.remove('app-on');
    $('login').classList.remove('hidden');
  }

  // Все данные одним запросом (RPC app_bootstrap). true — данные есть (с сервера или из кэша)
  async function loadAll() {
    if (!navigator.onLine && cacheLoad()) { applyQueue(); offlineBar(); return true; }
    if (queue.length) await flush();
    let r;
    try { r = await sb.rpc('app_bootstrap'); } catch (e) { r = { error: e }; }
    if (r.error) {
      if (isNetErr(r.error) && cacheLoad()) { applyQueue(); offlineBar(); return true; }
      if (/JWT|token|401|PGRST30/i.test(r.error.message + (r.error.code || ''))) { await signOutClean('Сессия истекла — войдите снова'); return false; }
      fail(r.error); return !!st.me;
    }
    const d = r.data || {};
    if (!d.me || !d.me.active) {
      const { data: { session } } = await sb.auth.getSession();
      if (!d.me && session?.user?.email?.endsWith('@' + REP_DOMAIN)) { location.replace('index.html'); return false; }
      await signOutClean('Нет доступа: учётная запись не активна'); return false;
    }
    st.me = d.me;
    st.reps = sortRu(d.reps || [], 'full_name'); st.stores = sortRu(d.stores || [], 'name');
    st.orders = d.orders || []; st.staff = sortRu(d.staff || [], 'full_name');
    st.payouts = d.payouts || []; st.access = d.access || []; st.repUsers = d.rep_users || [];
    st.unrec = d.unrec || null; st.open1c = d.open1c || null; st.dbMb = d.db_mb ?? null;
    applyQueue(); cacheSave(); offlineBar();
    return true;
  }
  async function signOutClean(msg) {
    try { localStorage.removeItem(CKEY); } catch { /* */ }
    st.me = null; await sb.auth.signOut().catch(() => {});
    A.toast(msg, true); showLogin();
  }
  const ordView = (o) => A.orderView({ status: o.status, expected: o.expected_date });

  // ---------- оболочка ----------
  function renderTabs() {
    $('tabs').innerHTML = TABS.filter((t) => !t.top && (!t.admin || isAdmin())).map((t) =>
      `<button data-tab="${t.id}" class="${st.tab === t.id ? 'on' : ''}">${t.icon}<span>${t.label}</span>${t.id === 'today' && badgeCount() ? `<em class="tab-badge">${badgeCount()}</em>` : ''}</button>`).join('');
    const n = badgeCount();
    try { n ? navigator.setAppBadge?.(n) : navigator.clearAppBadge?.(); } catch { /* значок на иконке поддерживается не везде */ }
  }
  function openTab(t) {
    st.tab = t; render(); window.scrollTo(0, 0);
    $('page').classList.remove('enter'); void $('page').offsetWidth; $('page').classList.add('enter');
  }
  $('tabs').addEventListener('click', (e) => {
    const t = e.target.closest('button')?.dataset.tab; if (!t) return;
    if (t === st.tab) { window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
    A.haptic(); openTab(t);
  });
  // Три чёрточки справа вверху открывают «Ещё», слева появляется «Назад» на прежнюю вкладку
  $('nav-more').addEventListener('click', () => { if (st.tab === 'more') return; A.haptic(); st.back = st.tab; openTab('more'); });
  $('nav-left').addEventListener('click', () => { if (st.tab !== 'more') return; A.haptic(); openTab(st.back || 'today'); });
  A.navScroll($('nav'));
  $('nav-plus').addEventListener('click', () => {
    if (st.tab === 'orders' || st.tab === 'today') orderForm(null, st.tab === 'today' && st.seg.today === 'cal' && st.cal?.day > A.today() ? { expected_date: st.cal.day } : {});
    else if (st.tab === 'payouts') payoutForm();
    else if (st.tab === 'dir') repForm();
    else if (st.tab === 'more' && isAdmin()) staffForm();
  });

  function render() {
    const t = TABS.find((x) => x.id === st.tab);
    $('nav-title').textContent = t.label;
    $('nav-plus').style.visibility = (st.tab === 'more' && !isAdmin()) || st.tab === 'sum' ? 'hidden' : 'visible';
    $('nav-more').style.visibility = st.tab === 'more' ? 'hidden' : 'visible';
    $('nav-left').textContent = st.tab === 'more' ? '\u2039 Назад' : '';
    ({ today: renderToday, orders: renderOrders, payouts: renderPayouts, sum: renderSummary, dir: renderDir, more: renderMore })[st.tab]();
    renderTabs();
  }
  // Каркас вкладки: заголовок, сегменты, поиск; список перерисовывается отдельно, чтобы поиск не терял фокус
  function frame(title, segs, segKey, searchPh) {
    $('page').innerHTML = `<div class="large-title">${E(title)}</div>
      ${segs ? `<div class="segmented" id="seg">${segs.map(([k, l]) => `<button data-k="${k}" class="${st.seg[segKey] === k ? 'on' : ''}">${E(l)}</button>`).join('')}</div>` : ''}
      ${searchPh ? A.searchBox('q', searchPh) : ''}<div id="body"></div>`;
    if (segs) $('seg').addEventListener('click', (e) => { const k = e.target.closest('button')?.dataset.k; if (k) { st.seg[segKey] = k; render(); } });
    if (searchPh) { $('q').value = st.q[segKey] || ''; $('q').parentElement.querySelector('.clear').classList.toggle('hidden', !$('q').value);
      A.bindSearch($('q'), () => { st.q[segKey] = $('q').value; render.body(); }); }
  }
  const setBody = (html) => { $('body').innerHTML = html; };
  // Значение плитки итогов: ноль — прочерком, чтобы глаз цеплялся за непустое
  const statV = (sum) => (Number(sum) ? `<div class="v">${A.fmtMoney(sum)}</div>` : '<div class="v none">—</div>');

  // Внутри группы: ИП/компания, у которой здесь 2+ строки, — заголовок ветки и вложенные строки (по алфавиту).
  // cell(x, child) рисует строку; заголовок ветки сворачивается нажатием.
  function treeList(items, cell, keepOrder = false) {
    const nodes = new Map();
    for (const x of items) {
      const r = repById(x.rep_id), k = r?.company ? 'c:' + coKey(r.company) : 'r:' + (x.rep_id || x.id);
      if (!nodes.has(k)) nodes.set(k, { co: r?.company || null, name: r?.company || r?.full_name || '', items: [] });
      nodes.get(k).items.push(x);
    }
    const flat = [];
    for (const n of nodes.values()) {
      if (n.co && n.items.length >= 2) flat.push(n);
      else for (const x of n.items) flat.push({ name: repById(x.rep_id)?.full_name || '', items: [x] });
    }
    if (!keepOrder) flat.sort((a, b) => a.name.localeCompare(b.name, 'ru'));
    return flat.map((n) => (n.co && n.items.length >= 2
      ? `<div class="tgrp"><button type="button" class="cell co-h"><div class="avatar co-ic">${E(A.initials(n.co.replace(/^(ИП|ООО|ОАО|ЗАО|ТД)\s+/i, '')))}</div>
          <div class="main"><div class="t"><b>${E(n.co)}</b></div><div class="s">${new Set(n.items.map((x) => x.rep_id)).size} торг. · ${n.items.length} шт.</div></div>
          <div class="r"><div class="amt">${A.fmtMoney(A.sum(n.items))}</div></div><span class="chev">›</span></button>${n.items.map((x) => cell(x, true)).join('')}</div>`
      : cell(n.items[0], false))).join('');
  }
  // Секции по датам (сегодня → будущие → прошедшие) с деревом ИП в каждой; перед прошедшими — разделитель
  function dateSections(rows, dateOf, cell, opt = {}) {
    let html = '', sep = false;
    for (const g of A.dayGroups(rows, dateOf)) {
      if (g.past && !sep && opt.pastLabel !== false) { html += `<div class="past-sep"><span>${E(opt.pastLabel || 'Прошедшие')}</span></div>`; sep = true; }
      const title = (opt.title ? opt.title(g) : null) || g.title;
      html += `<div class="section-h ${g.past && opt.pastRed ? 'red' : ''} ${g.today ? 'today' : ''}"><span>${E(title)} · ${g.items.length}</span><span>${A.fmtMoney(A.sum(g.items))}</span></div>
        <div class="list">${treeList(g.items, cell)}</div>`;
    }
    return html;
  }

  // =====================================================================
  // ЗАКАЗЫ
  // =====================================================================
  function renderOrders() {
    frame('Заказы', [['wait', 'Ожидаются'], ['delivered', 'Пришли'], ['all', 'Все']], 'orders', 'Имя, № заказа, сумма');
    render.body = renderOrdersBody; renderOrdersBody();
  }
  function orderMatches(o) {
    const r = repById(o.rep_id), s = storeById(o.store_id);
    return A.matches(st.q.orders, r?.full_name, r?.company, s?.name, o.order_no, o.comment, o.amount, A.fmtMoney(o.amount), A.fmtDate(o.order_date), staffName(o.created_by));
  }
  function renderOrdersBody() {
    const seg = st.seg.orders;
    let rows = st.orders.filter(orderMatches);
    let html = '';
    if (seg === 'wait') {
      rows = rows.filter((o) => o.status === 'ordered')
        .sort((a, b) => (a.expected_date || '9999').localeCompare(b.expected_date || '9999'));
      const late = rows.filter((o) => ordView(o).key === 'late');
      html += `<div class="stats">
        <div class="stat" style="cursor:default"><div class="k"><span class="dot" style="background:var(--blue)"></span>Ожидается · ${rows.length}</div>${statV(A.sum(rows))}</div>
        <div class="stat" style="cursor:default"><div class="k"><span class="dot" style="background:var(--red)"></span>Просрочено · ${late.length}</div>${statV(A.sum(late))}</div></div>`;
      html += dateSections(rows, (o) => o.expected_date, orderCell, { pastLabel: 'Просрочено', pastRed: true,
        title: (g) => (g.key === 'none' ? 'Без даты прихода' : null) });
    } else {
      if (seg === 'delivered') rows = rows.filter((o) => o.status === 'delivered');
      const dateOf = seg === 'delivered' ? (o) => o.delivered_at?.slice(0, 10) || o.order_date : (o) => o.order_date;
      html += dateSections(rows, dateOf, orderCell, { pastLabel: seg === 'delivered' ? false : 'Прошедшие' });
    }
    if (!rows.length) html += A.emptyState(st.q.orders ? 'Ничего не найдено' : seg === 'wait' ? 'Нет ожидаемых заказов' : 'Заказов нет',
      st.q.orders ? 'Измените запрос' : 'Нажмите «+», чтобы записать заказ');
    setBody(html);
    $('body').querySelectorAll('.cell[data-id]').forEach((c) => c.addEventListener('click', () => orderDetail(c.dataset.id)));
  }
  // «пришло 4 870 ₽ (−130 ₽)» — сумма приходной накладной из 1С рядом с заказанной
  function actualNote(o) {
    if (o.actual_amount == null) return '';
    const d = A.toCents(o.actual_amount) - A.toCents(o.amount);
    return `пришло ${A.fmtMoney(o.actual_amount)}${d ? ` (${d > 0 ? '+' : '−'}${A.fmtMoney(Math.abs(d) / 100)})` : ''}`;
  }
  function orderCell(o, child = false) {
    const r = repById(o.rep_id), v = ordView(o);
    const when = [A.orderWhen({ status: o.status, expected: o.expected_date, delivered_at: o.delivered_at }), actualNote(o), child ? '' : r?.company].filter(Boolean).join(' · ');
    return `<button class="cell ${child === true ? 'child' : ''}" data-id="${o.id}"><div class="main"><div class="t"><b>${E(r?.full_name || '—')}</b></div>
      <div class="s">${o._pending ? '<span class="pending">● не отправлено</span> ' : ''}${E(when)}</div></div><div class="r"><div class="amt">${A.fmtMoney(o.amount)}</div>${A.pill(v)}</div></button>`;
  }

  function orderDetail(id) {
    const o = st.orders.find((x) => x.id === id); if (!o) return;
    const r = repById(o.rep_id), s = storeById(o.store_id), v = ordView(o);
    const acts = [];
    if (o.status === 'ordered') acts.push(btn('arrived', 'Отметить: пришёл', 'green'));
    if (o.status === 'ordered' && o.expected_date >= A.today()) acts.push(btn('remind', 'Напомнить в календаре'));
    acts.push(btn('edit', 'Изменить'));
    if (o.status === 'ordered') acts.push(btn('cancel', 'Отменить заказ', 'red'));
    else acts.push(btn('reopen', 'Вернуть в «Ожидается»'));
    if (isAdmin()) acts.push(btn('delete', 'Удалить', 'red'));
    const api = A.sheet({ title: 'Заказ', left: 'Закрыть', body: `
      <div class="hero"><div class="amount">${A.fmtMoney(o.amount)}</div><div class="who">${E(repLabel(r))}</div>${A.pill(v)}</div>
      <div class="section-h"><span>Детали</span></div>
      ${info([['Магазин', s?.name], ['№ заказа', o.order_no], ['Дата заказа', A.fmtDate(o.order_date)],
        ['Ожидаемый приход', o.expected_date ? `${A.fmtDate(o.expected_date)} (${A.relDay(o.expected_date)})` : 'не указан'],
        ['Пришёл', A.fmtDate(o.delivered_at)], ['По накладной 1С', actualNote(o).replace(/^пришло /, '')], ['Комментарий', o.comment]])}
      ${acts.join('')}
      <div class="section-h"><span>История</span></div><div id="hist">${info([['Записал', `${staffName(o.created_by) || '—'}, ${A.fmtDate(o.created_at)}`]])}</div>` });
    loadHistory({ entity_id: id }, api.body.querySelector('#hist'));
    const setStatus = (status, msg) => { api.close(); changeStatus('orders', id, status, msg); };
    onActs(api, {
      arrived: () => setStatus('delivered', 'Отмечено: пришёл'),
      cancel: () => setStatus('cancelled', 'Заказ отменён'),
      reopen: () => setStatus('ordered', 'Заказ снова ожидается'),
      remind: () => ics(`Заказ: ${r?.full_name || ''}`, o.expected_date, `Должен прийти заказ на ${A.fmtMoney(o.amount)}${o.order_no ? ', № ' + o.order_no : ''}.`),
      edit: () => orderForm(o),
      delete: () => { api.close(); deleteWithUndo('orders', id, 'Заказ удалён'); },
    });
  }

  // Подбор ТП/магазина с возможностью создать новый прямо из формы
  const NEW = '__new__';
  const multiStore = () => st.stores.length > 1;
  // Представитель: строка поиска с подсказками, как в поисковике (см. A.rank)
  const repFields = (r) => [r.full_name, r.company, r.phone];
  function recentReps(n) {
    const seen = new Set(), out = [];
    const rows = [...st.orders, ...st.payouts].sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
    for (const x of rows) {
      if (seen.has(x.rep_id)) continue; seen.add(x.rep_id);
      const r = repById(x.rep_id); if (r?.active) out.push(r);
      if (out.length >= n) break;
    }
    return out;
  }
  function repPicker(repId) {
    const r = repById(repId);
    return `<div class="rp">
        <input type="hidden" name="rep_id" value="${E(repId || '')}">
        <button type="button" class="field rp-val ${r ? '' : 'hidden'}"><span>Представитель</span><b>${E(r ? repLabel(r) : '')}</b></button>
        <label class="field rp-q ${r ? 'hidden' : ''}"><span>Представитель</span><input name="rep_q" type="search" placeholder="Имя, фамилия, компания"
          autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" enterkeyhint="search"></label>
        <div class="rp-res"></div>
      </div>
      <div class="hidden" data-new="rep">${field('ФИО', '<input name="new_rep_name" placeholder="Иванов Иван">')}${field('Компания', '<input name="new_rep_company" placeholder="необязательно">')}${field('Телефон', '<input name="new_rep_phone" type="tel" placeholder="необязательно">')}</div>`;
  }
  function bindRepPicker(f, onRep = null) {
    const box = f.querySelector('.rp'); if (!box) return;
    const hid = box.querySelector('[name=rep_id]'), val = box.querySelector('.rp-val'), qrow = box.querySelector('.rp-q');
    const inp = qrow.querySelector('input'), res = box.querySelector('.rp-res'), newBox = f.querySelector('[data-new=rep]');
    let prev = hid.value, list = [];
    const draw = () => {
      const q = inp.value.trim();
      const pool = st.reps.filter((r) => r.active);
      list = q ? A.rank(q, pool, repFields).slice(0, 8) : recentReps(6);
      res.innerHTML = (!q && list.length ? '<div class="rp-h">Недавние</div>' : '')
        + list.map((r) => `<button type="button" class="cell rp-item" data-rid="${r.id}"><div class="main">
            <div class="t">${A.mark(r.full_name, q)}</div>${r.company || r.phone ? `<div class="s">${A.mark([r.company, r.phone].filter(Boolean).join(' · '), q)}</div>` : ''}</div></button>`).join('')
        + (q && !list.length ? '<div class="rp-h">Не найдено</div>' : '')
        + `<button type="button" class="cell rp-item rp-new" data-rid="${NEW}"><div class="main"><div class="t">＋ Новый представитель${q ? ` «${E(q)}»` : ''}</div></div></button>`;
      res.classList.remove('hidden');
    };
    const choose = (id) => {
      hid.value = id; res.innerHTML = ''; onRep?.(id);
      newBox.classList.toggle('hidden', id !== NEW);
      if (id === NEW) {
        const n = newBox.querySelector('[name=new_rep_name]');
        if (!n.value) n.value = inp.value.trim().replace(/(^|\s)\S/g, (c) => c.toUpperCase());
        val.querySelector('b').textContent = 'Новый'; qrow.classList.add('hidden'); val.classList.remove('hidden');
        n.focus(); return;
      }
      val.querySelector('b').textContent = repLabel(repById(id));
      qrow.classList.add('hidden'); val.classList.remove('hidden'); A.haptic();
      // дальше — сумма: клавиатура откроется сразу (действие пользователя)
      f.querySelector('[name=amount]')?.focus();
    };
    // повторное открытие: прежний выбор вернётся, если ничего не выбрать
    val.addEventListener('click', () => {
      prev = hid.value; hid.value = ''; newBox.classList.add('hidden'); val.classList.add('hidden'); onRep?.(null); qrow.classList.remove('hidden');
      inp.value = ''; inp.focus(); draw();
    });
    inp.addEventListener('focus', draw);
    let t; inp.addEventListener('input', () => { clearTimeout(t); t = setTimeout(draw, 60); });
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); if (inp.value.trim() && list[0]) choose(list[0].id); } });
    // нажатие на подсказку не должно сначала убирать фокус и прятать список
    for (const ev of ['pointerdown', 'mousedown']) res.addEventListener(ev, (e) => { if (e.target.closest('.rp-item')) e.preventDefault(); });
    res.addEventListener('click', (e) => { const b = e.target.closest('.rp-item'); if (b) choose(b.dataset.rid); });
    inp.addEventListener('blur', () => setTimeout(() => {
      if (document.activeElement === inp || inp.value.trim()) return;
      res.innerHTML = '';
      if (prev && repById(prev) && !hid.value) { hid.value = prev; qrow.classList.add('hidden'); val.classList.remove('hidden'); onRep?.(prev); }
    }, 150));
  }
  // Магазин: выбор только если их больше одного; иначе подставляется единственный
  function storePicker(storeId) {
    if (!multiStore()) return `<input type="hidden" name="store_id" value="${storeId || st.stores[0]?.id || ''}">`;
    return `${field('Магазин', `<select name="store_id"><option value="">—</option>${opts(st.stores, (s) => s.name, storeId)}<option value="${NEW}">＋ Новый…</option></select>`)}
      <div class="hidden" data-new="store">${field('Название', '<input name="new_store_name" placeholder="Магазин">')}</div>`;
  }
  function bindPickers(api, onRep = null) {
    const f = api.body; bindRepPicker(f, onRep);
    for (const [sel, key] of [['store_id', 'store']]) {
      f.querySelector(`select[name=${sel}]`)?.addEventListener('change', (e) => {
        const box = f.querySelector(`[data-new=${key}]`); box.classList.toggle('hidden', e.target.value !== NEW);
        if (e.target.value === NEW) box.querySelector('input').focus();
      });
    }
  }
  async function resolvePickers(f) {
    const val = (n) => f.querySelector(`[name=${n}]`)?.value.trim();
    let rep_id = val('rep_id'), store_id = val('store_id') || null;
    if (!rep_id) throw new Error('Выберите представителя');
    if ((rep_id === NEW || store_id === NEW) && !navigator.onLine) throw new Error('Новый представитель или магазин добавляется только при наличии сети');
    if (rep_id === NEW) {
      if (!val('new_rep_name')) throw new Error('Укажите ФИО нового представителя');
      const { data, error } = await sb.from('reps').insert({ full_name: val('new_rep_name'), company: val('new_rep_company') || null, phone: val('new_rep_phone') || null }).select().single();
      if (error) throw error; st.reps.push(data); sortRu(st.reps, 'full_name'); rep_id = data.id;
      if (isAdmin()) { const a = await sb.from('rep_access').select('*').eq('rep_id', data.id).single(); if (a.data) st.access.push(a.data); }
    }
    if (store_id === NEW) {
      if (!val('new_store_name')) throw new Error('Укажите название магазина');
      const { data, error } = await sb.from('stores').insert({ name: val('new_store_name') }).select().single();
      if (error) throw error; st.stores.push(data); sortRu(st.stores, 'name'); store_id = data.id;
    }
    return { rep_id, store_id };
  }

  function orderForm(o = null, preset = {}) {
    const t = A.today();
    const lastStore = o ? o.store_id : (localStorage.getItem('lastStore') || '');
    const api = A.sheet({
      title: o ? 'Изменить заказ' : 'Новый заказ', right: { label: 'Готово', onClick: (api) => save(api) },
      body: `<div class="list" style="margin-top:8px">${repPicker(o?.rep_id || preset.rep_id)}
          ${field('Сумма, ₽', `<input name="amount" inputmode="decimal" placeholder="0,00" value="${o ? String(o.amount).replace('.', ',') : ''}" required>`)}
          ${field('Придёт', `<input name="expected_date" type="date" value="${o ? o.expected_date || '' : preset.expected_date || A.addDays(t, 1)}">`)}
        </div>
        <div class="chips" id="chips">${[['Завтра', 1], ['+2 дня', 2], ['+3 дня', 3], ['Неделя', 7], ['Без даты', null]].map(([l, n]) => `<button type="button" class="chip" data-d="${n}">${l}</button>`).join('')}</div>
        <button class="btn plain" type="button" data-act="more" style="background:none;margin-top:10px;padding:8px">Ещё поля</button>
        <div id="extra" class="hidden"><div class="list">
          ${storePicker(o ? o.store_id : (lastStore && storeById(lastStore) ? lastStore : null))}
          ${field('№ заказа', `<input name="order_no" placeholder="необязательно" value="${E(o?.order_no || '')}">`)}
          ${field('Дата заказа', `<input name="order_date" type="date" value="${o?.order_date || t}" required>`)}
          <label class="field"><textarea name="comment" placeholder="Комментарий: что заказали, условия">${E(o?.comment || '')}</textarea></label>
        </div></div>
        <button class="btn blue" type="button" data-act="save">${o ? 'Сохранить' : 'Записать заказ'}</button>`,
    });
    const f = api.body; bindPickers(api);
    const exp = f.querySelector('[name=expected_date]');
    const marks = () => f.querySelectorAll('.chip').forEach((c) => {
      const n = c.dataset.d; const base = f.querySelector('[name=order_date]').value || t;
      c.classList.toggle('on', n === 'null' ? !exp.value : exp.value === A.addDays(base, +n));
    });
    f.querySelector('#chips').addEventListener('click', (e) => {
      const n = e.target.closest('.chip')?.dataset.d; if (n == null) return;
      exp.value = n === 'null' ? '' : A.addDays(f.querySelector('[name=order_date]').value || t, +n); marks();
    });
    exp.addEventListener('change', marks); f.querySelector('[name=order_date]').addEventListener('change', marks); marks();
    const showExtra = () => { f.querySelector('#extra').classList.remove('hidden'); f.querySelector('[data-act=more]').classList.add('hidden'); };
    if (o && (o.order_no || o.comment || o.order_date !== t || multiStore())) showExtra();
    onActs(api, { save: () => save(api), more: showExtra });
    if (!o && !preset.rep_id) setTimeout(() => { const q = f.querySelector('[name=rep_q]'); if (q && !window.matchMedia('(pointer: coarse)').matches) q.focus(); }, 350);

    async function save(api) {
      const v = (n) => f.querySelector(`[name=${n}]`).value.trim();
      const amount = parseAmount(v('amount'));
      if (!(amount > 0)) return A.toast('Укажите сумму больше нуля', true);
      if (v('expected_date') && v('expected_date') < v('order_date')) return A.toast('Дата прихода раньше даты заказа', true);
      api.busy(true);
      try {
        const p = await resolvePickers(f);
        const row = { ...p, amount, order_no: v('order_no') || null, order_date: v('order_date'), expected_date: v('expected_date') || null, comment: v('comment') || null };
        const r = await write('orders', o ? 'update' : 'insert', o?.id, row);
        st.orders.sort((a, b) => b.order_date.localeCompare(a.order_date) || (b.created_at || '').localeCompare(a.created_at || ''));
        if (row.store_id) localStorage.setItem('lastStore', row.store_id);
        api.close(); A.toast((o ? 'Сохранено' : 'Заказ записан') + (r.offline ? ' · отправится при появлении сети' : ''));
        if (st.tab === 'orders') render.body(); else render();
      } catch (e) { api.busy(false); A.toast(humanError(e), true); }
    }
  }

  // =====================================================================
  // ВЫПЛАТЫ (админ)
  // =====================================================================
  function renderPayouts() {
    if (!['all', 'to_pay', 'paid'].includes(st.seg.payouts)) st.seg.payouts = 'all';
    frame('Выплаты', [['all', 'Все'], ['to_pay', 'Записи'], ['paid', 'Оплачено']], 'payouts', 'Имя, № накладной, сумма');
    render.body = renderPayoutsBody; renderPayoutsBody();
  }
  function renderPayoutsBody() {
    const seg = st.seg.payouts;
    const isPaid = (p) => p.status === 'paid';
    const rows = st.payouts.filter((p) => (seg === 'all' || (seg === 'paid') === isPaid(p)) && A.matches(st.q.payouts,
      repById(p.rep_id)?.full_name, repById(p.rep_id)?.company, p.invoice_no, storeById(p.store_id)?.name, p.basis, p.comment, p.amount, A.fmtMoney(p.amount), A.fmtDate(p.payout_date)));
    const open = st.payouts.filter((p) => !isPaid(p)), month = A.today().slice(0, 7);
    const paidM = st.payouts.filter((p) => isPaid(p) && (p.paid_at || p.payout_date).slice(0, 7) === month);
    let html = `<div class="stats">
      <button class="stat ${seg === 'to_pay' ? 'on' : ''}" data-seg="to_pay"><div class="k"><span class="dot" style="background:var(--orange)"></span>Не оплачено · ${open.length}</div>${statV(A.sum(open))}</button>
      <button class="stat ${seg === 'paid' ? 'on' : ''}" data-seg="paid"><div class="k"><span class="dot" style="background:var(--green)"></span>Оплачено за месяц</div>${statV(A.sum(paidM))}</button></div>`;
    const t = A.today(), pc = (x, c) => payoutCell(x, undefined, '', c);
    const ahead = rows.filter((p) => p.payout_date >= t), late = rows.filter((p) => p.payout_date < t && !isPaid(p)), done = rows.filter((p) => p.payout_date < t && isPaid(p));
    html += dateSections(ahead, (p) => p.payout_date, pc, { pastLabel: false });
    if (late.length) html += `<div class="past-sep red"><span>Просрочено · ${A.fmtMoney(A.sum(late))}</span></div>` + dateSections(late, (p) => p.payout_date, pc, { pastLabel: false, pastRed: true });
    html += dateSections(done, (p) => p.payout_date, pc, { pastLabel: 'Оплачено раньше' });
    const q = (st.q.payouts || '').trim();
    if (!rows.length && !q) html += A.emptyState('Выплат нет', 'Нажмите «+», чтобы добавить запись');
    if (rows.length) html += `<button class="btn plain" type="button" id="pay-xls">Выгрузить в Excel · ${rows.length}</button>`;
    if (q) html += '<div id="inv-found"></div>';
    setBody(html);
    $('body').querySelectorAll('.stat[data-seg]').forEach((b) => b.addEventListener('click', () => {
      st.seg.payouts = st.seg.payouts === b.dataset.seg ? 'all' : b.dataset.seg; renderPayouts();
    }));
    bindCells($('body'));
    $('pay-xls')?.addEventListener('click', () => A.toExcel(`Выплаты ${A.fmtDate(A.today())}`,
      ['Дата', 'Поставщик', 'ИП / компания', '№ накладной', 'Сумма', 'Статус', 'Оплачено', 'Получил', 'Основание', 'Комментарий'],
      rows.map((p) => { const r = repById(p.rep_id); return [p.payout_date, r?.full_name || '', r?.company || '', p.invoice_no || '', Number(p.amount),
        A.payView(p.status).label, p.paid_at ? p.paid_at.slice(0, 10) : '', p.received_at ? p.received_at.slice(0, 10) : '', p.basis || '', p.comment || '']; }),
      [11, 28, 24, 14, 12, 11, 11, 11, 20, 24]));
    if (q) findInvoices(q, rows.length);
  }
  // Поиск накладной 1С по номеру прямо в «Выплатах»: сразу «Записать» или «Оплачено»
  let findSeq = 0;
  async function findInvoices(q, localCount) {
    const seq = ++findSeq, box = $('inv-found');
    if (!box) return;
    box.innerHTML = '<div style="margin-top:18px">' + A.skeleton(2) + '</div>';
    const { data, error } = await sb.rpc('find_invoices', { p_q: q });
    if (seq !== findSeq || !box.isConnected) return;
    if (error) { box.innerHTML = isNetErr(error) ? '' : `<div class="footer-note warn">${E(humanError(error))}</div>`; return; }
    if (!data.length) { box.innerHTML = localCount ? '' : A.emptyState('Ничего не найдено', 'Ни записей, ни накладных 1С с таким номером'); return; }
    box.innerHTML = `<div class="section-h"><span>Накладные в 1С · ${data.length}</span></div><div class="list">${data.map((d) => {
      const r = repById(d.rep_id), open = Number(d.open) > 0;
      const state = d.pay_status ? A.payView(d.pay_status) : open ? { label: 'Не оплачено в 1С', c: 'orange' } : { label: 'Оплачено в 1С', c: 'green' };
      // в 1С уже оплачена и записи нет — делать нечего
      const acts = d.pay_status === 'paid' || (!open && !d.pay_id) ? '' : d.pay_id
        ? `<button class="chip on-green" data-inv-paid="${d.id}">Оплачено</button>`
        : `<button class="chip" data-inv-rec="${d.id}">Записать</button><button class="chip on-green" data-inv-paid="${d.id}">Оплачено</button>`;
      return `<div class="cell inv" data-inv="${d.id}"><div class="main"><div class="t"><b>${E(r?.full_name || '—')}</b></div>
          <div class="s">${E([A.docNo({ ...d, kind: 'in' }), A.fmtShort(d.at.slice(0, 10)), open ? 'не оплачено ' + A.fmtMoney(d.open) : ''].filter(Boolean).join(' · '))}</div>
          <div class="inv-acts">${acts}</div></div>
        <div class="r"><div class="amt">${A.fmtMoney(d.inc)}</div>${A.pill(state)}</div></div>`;
    }).join('')}</div>`;
    const byId = new Map(data.map((d) => [d.id, d]));
    box.querySelectorAll('[data-inv-rec]').forEach((b) => b.addEventListener('click', () => {
      const d = byId.get(b.dataset.invRec);
      payoutForm(null, { rep_id: d.rep_id, doc_id: d.id, amount: Number(d.open) > 0 ? Number(d.open) : Number(d.inc), invoice_no: d.in_no || '' });
    }));
    box.querySelectorAll('[data-inv-paid]').forEach((b) => b.addEventListener('click', () => invoicePaid(byId.get(b.dataset.invPaid))));
  }
  // «Оплачено» по накладной: есть запись — отметить её; нет — создать запись сразу оплаченной (с «Вернуть»)
  async function invoicePaid(d) {
    A.haptic();
    if (d.pay_id && st.payouts.some((p) => p.id === d.pay_id)) { await changeStatus('payouts', d.pay_id, 'paid', 'Оплачено'); return; }
    try {
      const amount = Number(d.open) > 0 ? Number(d.open) : Number(d.inc);
      const r = await write('payouts', 'insert', null, { rep_id: d.rep_id, doc_id: d.id, amount, invoice_no: d.in_no || null, payout_date: A.today(), status: 'paid' });
      st.payouts.sort((a, b) => b.payout_date.localeCompare(a.payout_date));
      if (st.unrec?.n > 0 && Number(d.open) > 0 && !d.pay_id) { st.unrec.n--; st.unrec.sum = Math.max(0, st.unrec.sum - amount); }
      rerender();
      A.toast('Оплачено · запись создана' + (r.offline ? ' · отправится при появлении сети' : ''), false, { label: 'Вернуть', run: async () => {
        try { await write('payouts', 'delete', r.id); rerender(); A.haptic(); } catch (e) { A.toast(humanError(e), true); }
      } });
    } catch (e) { A.toast(humanError(e), true); }
  }
  // Строка выплаты: кружок слева — как в «Напоминаниях»: пустой оранжевый = запись, зелёный с галочкой = оплачено
  const payNote = (p) => [p.invoice_no && '№ ' + p.invoice_no, p.basis].filter(Boolean).join(' · ');
  function payoutCell(p, sub, warn = '', child = false) {
    const r = repById(p.rep_id), paid = p.status === 'paid';
    if (sub === true || sub === false) { child = sub; sub = undefined; } // вызов из treeList: (x, child)
    if (sub === undefined) sub = [A.fmtShort(p.payout_date), payNote(p), child ? '' : r?.company].filter(Boolean).join(' · ');
    return `<button class="cell pay ${paid ? 'paid' : ''} ${child ? 'child' : ''}" data-pay="${p.id}">
      ${isAdmin() ? `<span class="tick" data-tick role="checkbox" aria-checked="${paid}" aria-label="${paid ? 'Снять оплату' : 'Отметить оплаченной'}"></span>` : ''}
      <div class="main"><div class="t"><b>${E(r?.full_name || '—')}</b></div>
      <div class="s">${p._pending ? '<span class="pending">● не отправлено</span> ' : ''}${E(sub ?? [A.fmtShort(p.payout_date), payNote(p)].filter(Boolean).join(' · '))}${paid && p.received_at ? ' · <span class="got">получил ✓</span>' : ''}${warn ? ` <span class="warn">${E(warn)}</span>` : ''}</div></div>
      <div class="r"><div class="amt">${A.fmtMoney(p.amount)}</div>${A.pill(A.payView(p.status))}</div></button>`;
  }
  async function togglePaid(id, cell) {
    const p = st.payouts.find((x) => x.id === id); if (!p) return;
    A.haptic();
    if (p.status === 'paid') await changeStatus('payouts', id, 'to_pay', 'Оплата снята');
    else await changeStatus('payouts', id, 'paid', 'Оплачено');
    // строка в открытой карточке не перерисовывается вместе со страницей — обновить на месте
    if (cell?.isConnected) {
      const paid = p.status === 'paid';
      cell.classList.toggle('paid', paid);
      cell.querySelector('[data-tick]')?.setAttribute('aria-checked', String(paid));
      const pill = cell.querySelector('.pill'); if (pill) pill.outerHTML = A.pill(A.payView(p.status));
    }
  }
  // Переходы из любых списков: заказ, выплата
  function bindCells(root) {
    root.querySelectorAll('.cell[data-id]').forEach((c) => c.addEventListener('click', () => orderDetail(c.dataset.id)));
    root.querySelectorAll('.cell[data-pay]').forEach((c) => c.addEventListener('click', (e) => {
      if (e.target.closest('[data-tick]')) { e.stopPropagation(); togglePaid(c.dataset.pay, c); return; }
      payoutDetail(c.dataset.pay);
    }));
  }
  function payoutDetail(id) {
    const p = st.payouts.find((x) => x.id === id); if (!p) return;
    const paid = p.status === 'paid';
    const api = A.sheet({ title: 'Выплата', left: 'Закрыть', body: `
      <div class="hero"><div class="amount ${paid ? 'paid' : ''}">${A.fmtMoney(p.amount)}</div><div class="who">${E(repLabel(repById(p.rep_id)))}</div>${A.pill(A.payView(p.status))}</div>
      <div class="section-h"><span>Детали</span></div>
      ${info([['№ накладной', p.invoice_no], ['Дата выплаты', A.fmtDate(p.payout_date)], ['Магазин', storeById(p.store_id)?.name], ['Основание', p.basis], ['Оплачено', A.fmtDate(p.paid_at)], ['Представитель получил', p.received_at ? A.fmtDate(p.received_at) : (paid ? 'ещё не подтвердил' : null)], ['Комментарий', p.comment]])}
      ${paid ? btn('st_to_pay', 'Снять оплату') : btn('st_paid', 'Отметить оплаченной', 'green')}${p.status !== 'paid' && p.payout_date >= A.today() ? btn('remind', 'Напомнить в календаре') : ''}${btn('edit', 'Изменить')}${btn('delete', 'Удалить', 'red')}
      <div class="section-h"><span>История</span></div><div id="hist"></div>` });
    loadHistory({ entity_id: id }, api.body.querySelector('#hist'));
    if (p.doc_id) {
      sb.from('docs').select('*').eq('id', p.doc_id).maybeSingle().then(({ data: d }) => {
        if (!d || !api.el.isConnected) return;
        const box = document.createElement('div');
        box.innerHTML = `<div class="section-h"><span>Накладная в 1С</span></div>${info([['Накладная', A.docNo({ ...d, kind: 'in' })],
          ['Дата', A.fmtDate(d.doc_at.slice(0, 10))], ['Сумма', A.fmtMoney(d.inc)],
          ['В 1С', d.deleted ? 'удалена' : Number(d.open_amount) > 0 ? `не оплачено ${A.fmtMoney(d.open_amount)}` : 'оплачена']])}
          ${paid && Number(d.open_amount) > 0 && !d.deleted ? '<div class="footer-note warn">Отмечено «Оплачено», а в 1С расходника на эту накладную нет.</div>' : ''}`;
        api.body.querySelector('.section-h').before(box);
      });
    }
    const map = {
      remind: () => ics(`Выплата: ${repById(p.rep_id)?.full_name || ''}`, p.payout_date, `Выплатить ${A.fmtMoney(p.amount)}${payNote(p) ? ' — ' + payNote(p) : ''}.`),
      edit: () => payoutForm(p),
      delete: () => { api.close(); deleteWithUndo('payouts', id, 'Выплата удалена'); },
      st_paid: () => { api.close(); changeStatus('payouts', id, 'paid', 'Оплачено'); },
      st_to_pay: () => { api.close(); changeStatus('payouts', id, 'to_pay', 'Оплата снята'); },
    };
    onActs(api, map);
  }
  function payoutForm(p = null, preset = {}) {
    const api = A.sheet({
      title: p ? 'Изменить выплату' : 'Новая выплата', right: { label: 'Готово', onClick: (a) => save(a) },
      body: `<div class="section-h"><span>Кому</span></div><div class="list">${repPicker(p?.rep_id || preset.rep_id)}${storePicker(p?.store_id)}</div>
        <div id="inv1c"></div>
        <div class="section-h"><span>Выплата</span></div><div class="list">
          ${field('Сумма, ₽', `<input name="amount" inputmode="decimal" placeholder="0,00" value="${p ? String(p.amount).replace('.', ',') : preset.amount ? String(preset.amount).replace('.', ',') : ''}">`)}
          <input type="hidden" name="doc_id" value="${E(p?.doc_id || preset.doc_id || '')}">
          ${field('№ накладной', `<input name="invoice_no" placeholder="необязательно" maxlength="64" autocomplete="off" autocorrect="off" spellcheck="false" value="${E(p?.invoice_no || preset.invoice_no || '')}">`)}
          ${field('Дата выплаты', `<input name="payout_date" type="date" value="${p?.payout_date || preset.payout_date || A.today()}">`)}
          <div class="field"><span>Статус</span><input type="hidden" name="status" value="${p?.status === 'paid' ? 'paid' : 'to_pay'}">
            <div class="segmented in-field" data-status>${Object.entries(A.PAY).map(([k, v]) =>
              `<button type="button" data-v="${k}" class="${k === (p?.status === 'paid' ? 'paid' : 'to_pay') ? 'on' : ''}">${v.label}</button>`).join('')}</div></div>
          ${field('Основание', `<input name="basis" placeholder="бонус, акция" value="${E(p?.basis || '')}">`)}
        </div>
        <div class="section-h"><span>Комментарий</span></div><div class="list"><label class="field"><textarea name="comment">${E(p?.comment || '')}</textarea></label></div>
        <button class="btn blue" type="button" data-act="save">${p ? 'Сохранить' : 'Добавить'}</button>`,
    });
    const f = api.body; onActs(api, { save: () => save(api) });
    // Долг поставщика по 1С прямо в форме. Новая запись — можно отметить несколько накладных:
    // сохранится по записи на каждую (у каждой своя сумма и №), так сверка с 1С остаётся точной.
    const box1c = f.querySelector('#inv1c'); let seq1c = 0, all1c = false, data1c = [];
    const picked = new Set(p?.doc_id || preset.doc_id ? [p?.doc_id || preset.doc_id] : []);
    const amountIn = f.querySelector('[name=amount]'), noIn = f.querySelector('[name=invoice_no]'), docIn = f.querySelector('[name=doc_id]');
    let docRep = picked.size ? (p?.rep_id || preset.rep_id) : null;
    const applyPicked = () => {
      const sel = data1c.filter((d) => picked.has(d.id));
      const multi = sel.length > 1;
      docIn.value = sel.length === 1 ? sel[0].id : '';
      if (sel.length) {
        amountIn.value = String(sel.reduce((a, d) => a + A.toCents(d.open_amount), 0) / 100).replace('.', ',');
        noIn.value = sel.map((d) => d.in_no || 'б/н').join(', ');
        if (sel.length === 1 && !sel[0].in_no) noIn.value = '';
      }
      amountIn.readOnly = multi; noIn.readOnly = multi;
      amountIn.closest('.field').classList.toggle('ro', multi); noIn.closest('.field').classList.toggle('ro', multi);
    };
    async function load1c(repId) {
      const my = ++seq1c; box1c.innerHTML = ''; data1c = [];
      if (!repId || repId === NEW || !isAdmin() || !navigator.onLine) return;
      const { data, error } = await sb.from('docs').select('id,in_no,doc_at,inc,open_amount')
        .eq('rep_id', repId).eq('kind', 'in').eq('deleted', false).gt('open_amount', 0).order('doc_at');
      if (my !== seq1c || error || !data?.length || !box1c.isConnected) return;
      data1c = data;
      const linked = new Set(st.payouts.filter((x) => x.doc_id && x.id !== p?.id).map((x) => x.doc_id));
      const t = A.today(), days = (d) => Math.max(0, Math.round((new Date(t + 'T12:00:00') - new Date(d.doc_at.slice(0, 10) + 'T12:00:00')) / 864e5));
      const draw = () => {
        const list = all1c ? data : data.slice(0, 5);
        const sel = data.filter((d) => picked.has(d.id)), selSum = sel.reduce((a, d) => a + A.toCents(d.open_amount), 0) / 100;
        box1c.innerHTML = `<div class="section-h"><span>Долг по 1С · ${data.length} накл.</span><span>${A.fmtMoney(data.reduce((a, d) => a + A.toCents(d.open_amount), 0) / 100)}</span></div>
          <div class="list">${list.map((d) => `<button type="button" class="cell inv-pick ${picked.has(d.id) ? 'on' : ''}" data-doc="${d.id}" ${linked.has(d.id) ? 'disabled' : ''}>
            <span class="pick-ic"></span><div class="main"><div class="t">${E(A.docNo({ ...d, kind: 'in' }))}</div>
            <div class="s">${E(A.fmtShort(d.doc_at.slice(0, 10)))} · <span class="${A.ageCls(days(d))}">${days(d)} дн.</span>${linked.has(d.id) ? ' · есть запись' : ''}</div></div>
            <div class="r"><div class="amt">${A.fmtMoney(d.open_amount)}</div></div></button>`).join('')}
          ${data.length > list.length ? `<button type="button" class="cell action" data-all>Показать все ${data.length}</button>` : ''}
          ${!p && data.length > 1 ? `<button type="button" class="cell action" data-pickall>${sel.length === data.filter((d) => !linked.has(d.id)).length ? 'Снять все' : 'Выбрать все'}</button>` : ''}</div>
          <div class="footer-note">${sel.length > 1 ? `Выбрано ${sel.length} накл. на ${A.fmtMoney(selSum)} — сохранится ${sel.length} записи, по одной на накладную.`
            : p ? 'Нажмите накладную — подставятся сумма и номер.' : 'Нажмите накладную — подставятся сумма и номер. Можно выбрать несколько.'}</div>`;
      };
      draw();
      box1c.onclick = (e) => {
        if (e.target.closest('[data-all]')) { all1c = true; draw(); return; }
        if (e.target.closest('[data-pickall]')) {
          const free = data.filter((d) => !linked.has(d.id)), allOn = free.every((d) => picked.has(d.id));
          picked.clear(); if (!allOn) { free.forEach((d) => picked.add(d.id)); all1c = true; }
          docRep = picked.size ? f.querySelector('[name=rep_id]').value : null;
          A.haptic(); applyPicked(); draw(); return;
        }
        const b = e.target.closest('[data-doc]'); if (!b || b.disabled) return;
        const id = b.dataset.doc;
        A.haptic();
        if (picked.has(id)) picked.delete(id);
        else { if (p) picked.clear(); picked.add(id); } // у существующей записи — одна накладная
        docRep = picked.size ? f.querySelector('[name=rep_id]').value : null;
        applyPicked(); draw();
      };
    }
    // накладные привязаны к поставщику: сменили поставщика — выбор снимается
    bindPickers(api, (id) => { if (id && docRep && id !== docRep) { picked.clear(); docRep = null; applyPicked(); } load1c(id); });
    if (p?.rep_id || preset.rep_id) load1c(p?.rep_id || preset.rep_id);
    f.querySelector('[data-status]').addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      f.querySelector('[name=status]').value = b.dataset.v; A.haptic();
      f.querySelectorAll('[data-status] button').forEach((x) => x.classList.toggle('on', x === b));
    });
    async function save(api) {
      const v = (n) => f.querySelector(`[name=${n}]`).value.trim();
      const amount = parseAmount(v('amount'));
      if (!(amount > 0)) return A.toast('Укажите сумму больше нуля', true);
      api.busy(true);
      try {
        const pk = await resolvePickers(f);
        const many = !p ? data1c.filter((d) => picked.has(d.id)) : [];
        if (many.length > 1) {
          // по записи на каждую накладную
          let off = false, total = 0, done = 0, err = null;
          for (const d of many) {
            const one = { ...pk, amount: Number(d.open_amount), invoice_no: d.in_no || null, doc_id: d.id, payout_date: v('payout_date'), status: v('status'), basis: v('basis') || null, comment: v('comment') || null };
            try { const r = await write('payouts', 'insert', null, one); off = off || r.offline; }
            catch (e) { err = e; break; }
            done++; total += A.toCents(d.open_amount);
            picked.delete(d.id);
            if (st.unrec?.n > 0) { st.unrec.n--; st.unrec.sum = Math.max(0, st.unrec.sum - Number(d.open_amount)); }
          }
          st.payouts.sort((a, b) => b.payout_date.localeCompare(a.payout_date));
          if (err) { // часть сохранена — не дублируем её при повторе: выбор оставшихся сохраняется
            api.busy(false); applyPicked(); render();
            return A.toast(`Сохранено ${done} из ${many.length}. ${humanError(err)}`, true);
          }
          api.close(); A.toast(`Записей: ${done} на ${A.fmtMoney(total / 100)}` + (off ? ' · отправятся при появлении сети' : '')); render();
          preset.after?.();
          return;
        }
        const row = { ...pk, amount, invoice_no: v('invoice_no') || null, ...(v('doc_id') ? { doc_id: v('doc_id') } : {}), payout_date: v('payout_date'), status: v('status'), basis: v('basis') || null, comment: v('comment') || null };
        const r = await write('payouts', p ? 'update' : 'insert', p?.id, row);
        st.payouts.sort((a, b) => b.payout_date.localeCompare(a.payout_date));
        api.close(); A.toast('Сохранено' + (r.offline ? ' · отправится при появлении сети' : '')); render();
        if (row.doc_id && st.unrec?.n > 0 && !p) { st.unrec.n--; st.unrec.sum = Math.max(0, st.unrec.sum - amount); }
        preset.after?.();
      } catch (e) { api.busy(false); A.toast(humanError(e), true); }
    }
  }

  // =====================================================================
  // СПРАВОЧНИК
  // =====================================================================
  function renderDir() {
    st.seg.dir = 'reps';
    frame('Представители', null, 'dir', 'Имя, компания, телефон');
    render.body = renderDirBody; renderDirBody();
  }
  // Компания или ИП → её торговые (как дерево). Ключ — название без регистра, точек и пробелов.
  const siblingsOf = (r) => (r.company ? st.reps.filter((x) => x.id !== r.id && coKey(x.company) === coKey(r.company)) : []);
  // Список: ИП с двумя и более торговыми — раскрывающаяся строка; остальные — как есть. Порциями при прокрутке.
  function renderDirBody() {
    const q = st.q.dir;
    st.dirOpen = st.dirOpen || new Set();
    const ranked = A.rank(q, st.reps, repFields);
    if (!ranked.length) { setBody(A.emptyState(q ? 'Ничего не найдено' : 'Представителей нет', q ? '' : 'Нажмите «+», чтобы добавить')); return; }
    const waiting = waitingMap();
    // все торговые каждой компании (для числа в строке ИП), найденные — в порядке поиска
    const allBy = new Map();
    for (const r of st.reps) if (r.company && r.active) { const k = coKey(r.company); if (!allBy.has(k)) allBy.set(k, []); allBy.get(k).push(r); }
    const nodes = []; const seen = new Map();
    for (const r of ranked.filter((x) => x.active)) {
      const k = r.company ? coKey(r.company) : null;
      if (k && (allBy.get(k)?.length || 0) >= 2) {
        if (!seen.has(k)) { const node = { co: r.company, k, kids: [] }; seen.set(k, node); nodes.push(node); }
        seen.get(k).kids.push(r);
      } else nodes.push({ rep: r });
    }
    // без поиска — по алфавиту (ИП по названию, торговый по имени); с поиском — по похожести
    const label = (n) => n.co || n.rep.full_name;
    if (!q) nodes.sort((x, y) => label(x).localeCompare(label(y), 'ru'));
    const nodeHtml = (n) => {
      if (n.rep) return repCell(n.rep, false, waiting);
      const open = !!q || st.dirOpen.has(n.k), all = allBy.get(n.k) || n.kids, kids = q ? n.kids : all;
      const wait = all.reduce((a, r) => a + (waiting.get(r.id) || 0), 0);
      return `<button class="cell co ${open ? 'open' : ''}" data-co="${E(n.k)}"><div class="avatar co-ic">${E(A.initials(n.co.replace(/^(ИП|ООО|ОАО|ЗАО|ТД)\s+/i, '')))}</div>
          <div class="main"><div class="t"><b>${A.mark(n.co, q)}</b></div><div class="s">${all.length} торговых${q && kids.length < all.length ? ` · найдено ${kids.length}` : ''}</div></div>
          ${wait ? `<div class="r"><span class="pill c-blue">ждём ${wait}</span></div>` : ''}<span class="chev">›</span></button>`
        + (open ? kids.map((r) => repCell(r, true, waiting)).join('') : '');
    };
    const off = ranked.filter((r) => !r.active);
    const coCount = nodes.filter((n) => n.co).length;
    setBody(`<div class="section-h"><span>${q ? 'Найдено' : 'Поставщики'} · ${ranked.length - off.length}</span>${coCount ? `<span>ИП и компаний: ${coCount}</span>` : ''}</div><div class="list" data-g="0"></div>`
      + (off.length ? `<div class="section-h"><span>Отключённые · ${off.length}</span></div><div class="list" data-g="1"></div>` : '') + '<div id="more-sentinel" style="height:1px"></div>');
    const boxes = [{ el: $('body').querySelector('[data-g="0"]'), list: nodes, html: nodeHtml, shown: 0 }];
    if (off.length) boxes.push({ el: $('body').querySelector('[data-g="1"]'), list: off, html: (r) => repCell(r, false, waiting), shown: 0 });
    const step = (n) => {
      for (const b of boxes) {
        if (b.shown >= b.list.length) continue;
        const next = b.list.slice(b.shown, b.shown + n); b.shown += next.length;
        b.el.insertAdjacentHTML('beforeend', next.map(b.html).join('')); n -= next.length;
        if (n <= 0) return true;
      }
      return boxes.some((b) => b.shown < b.list.length);
    };
    step(60);
    const sentinel = $('more-sentinel');
    if (boxes.some((b) => b.shown < b.list.length) && 'IntersectionObserver' in window) {
      const io = new IntersectionObserver((en) => { if (en[0].isIntersecting && !step(150)) io.disconnect(); }, { rootMargin: '800px' });
      io.observe(sentinel);
    } else while (step(500)) { /* старые браузеры: всё сразу */ }
    if (!renderDirBody.bound) {
      renderDirBody.bound = true;
      $('page').addEventListener('click', (e) => {
        if (st.tab !== 'dir') return;
        const co = e.target.closest('[data-co]');
        if (co) {
          // раскрыть/свернуть на месте, без перерисовки всего списка
          const k = co.dataset.co, open = !co.classList.contains('open');
          if (open) st.dirOpen.add(k); else st.dirOpen.delete(k);
          A.haptic(); co.classList.toggle('open', open);
          let nx = co.nextElementSibling; while (nx && nx.classList.contains('child')) { const x = nx; nx = nx.nextElementSibling; x.remove(); }
          if (open) {
            const kids = st.reps.filter((r) => r.active && coKey(r.company) === k).sort((x, y) => x.full_name.localeCompare(y.full_name, 'ru'));
            const w = waitingMap();
            co.insertAdjacentHTML('afterend', kids.map((r) => repCell(r, true, w)).join(''));
          }
          return;
        }
        const c = e.target.closest('[data-rep]'); if (c) repDetail(c.dataset.rep);
      });
    }
  }
  function waitingMap() {
    const m = new Map();
    for (const o of st.orders) if (o.status === 'ordered') m.set(o.rep_id, (m.get(o.rep_id) || 0) + 1);
    return m;
  }
  // Строка торгового; child — внутри ветки ИП (компания уже видна в заголовке ветки)
  function repCell(r, child, waiting = null) {
    const n = (waiting || waitingMap()).get(r.id) || 0;
    return `<button class="cell ${child ? 'child' : ''}" data-rep="${r.id}">${A.av(r.full_name)}
      <div class="main"><div class="t"><b>${E(r.full_name)}</b></div>${(() => { const sub = (child ? [r.phone] : [r.company, r.phone]).filter(Boolean).join(' · ');
        return sub ? `<div class="s">${E(sub)}</div>` : ''; })()}</div>
      ${n ? `<div class="r"><span class="pill c-blue">ждём ${n}</span></div>` : ''}</button>`;
  }


  const repLink = (rep) => { const t = st.access.find((a) => a.rep_id === rep.id)?.token; return t ? new URL('index.html', location.href).href.split('#')[0] + '#' + t : null; };
  const newToken = () => Array.from(crypto.getRandomValues(new Uint8Array(18)), (b) => b.toString(16).padStart(2, '0')).join('');

  // Документы 1С: «ПФ0000040007665» → «40007665»
  const shortNum = (n) => String(n || '').replace(/^\D+/, '').replace(/^0+(?=\d)/, '') || String(n || '');
  const DOC_LABEL = { in: 'Приход', pay: 'Оплата', ret: 'Возврат' };
  const docLabel = (d) => DOC_LABEL[d.kind] || d.title;
  const daysSince = (at) => Math.max(0, Math.round((new Date(A.today() + 'T12:00:00') - new Date(String(at).slice(0, 10) + 'T12:00:00')) / 864e5));
  // Выгрузка карточки поставщика в Excel: заказы, выплаты и документы 1С — каждое своим блоком
  function repExcel(r, ords, pays, docs) {
    const rows = [];
    for (const o of ords) rows.push(['Заказ', o.order_date, o.order_no || '', Number(o.amount), ordView(o).label, o.expected_date || '', o.comment || '']);
    for (const p of pays) rows.push(['Выплата', p.payout_date, p.invoice_no || '', Number(p.amount), A.payView(p.status).label, p.paid_at ? p.paid_at.slice(0, 10) : '', p.comment || p.basis || '']);
    for (const d of docs || []) if (!d.deleted) rows.push([docLabel(d), d.at.slice(0, 10), d.in_no || shortNum(d.num), Number(d.inc) || -Number(d.dec),
      d.kind === 'in' ? (Number(d.open) > 0 ? 'Не оплачено ' + A.fmtMoney(d.open) : 'Оплачено') : '', '', d.comment || '']);
    if (!rows.length) return A.toast('Нечего выгружать', true);
    A.toExcel(`${r.full_name} ${A.fmtDate(A.today())}`, ['Вид', 'Дата', '№', 'Сумма', 'Статус', 'Срок / оплачено', 'Комментарий'], rows, [12, 11, 14, 13, 22, 14, 30]);
  }
  function mergeRows(list, rows) {
    const have = new Set(list.map((x) => x.id));
    for (const x of rows || []) if (!have.has(x.id)) list.push(x);
  }
  function repDetail(id, tab = null) {
    const r = repById(id); if (!r) return;
    let ords, wait, pays, unpaid, docs = null, debt = null;
    const recount = () => {
      ords = st.orders.filter((o) => o.rep_id === id).sort((a, b) => b.order_date.localeCompare(a.order_date));
      wait = ords.filter((o) => o.status === 'ordered');
      pays = st.payouts.filter((p) => p.rep_id === id).sort((a, b) => b.payout_date.localeCompare(a.payout_date));
      unpaid = pays.filter((p) => p.status !== 'paid');
    };
    recount();
    // открыть вкладку, где есть данные: заказы → выплаты → документы 1С
    if (!tab) tab = ords.length ? 'orders' : isAdmin() && pays.length ? 'payouts' : isAdmin() && r.ext_key ? 'docs' : 'orders';
    const phone1 = (r.phone || '').split(',')[0].trim();
    const tabs = () => [['orders', `Заказы · ${ords.length}`], ...(isAdmin() ? [['payouts', `Выплаты · ${pays.length}`], ['docs', '1С']] : []), ['history', 'История']];
    let acts = '';
    if (isAdmin()) {
      const ru = st.repUsers.find((u) => u.rep_id === id);
      acts = `<div class="list" style="margin-top:24px"><button class="cell more-row" data-act="access"><div class="main"><div class="t">Доступ и управление</div>
        <div class="s">${E(['личная ссылка', ru ? 'логин ' + ru.login + (ru.active ? '' : ' (отключён)') : 'без логина', r.active ? '' : 'отключён'].filter(Boolean).join(' · '))}</div></div><span class="chev">›</span></button></div>`;
    }
    const statsHtml = () => `
        <div class="stat" style="cursor:default"><div class="k"><span class="dot" style="background:var(--blue)"></span>Ожидается · ${wait.length}</div>${statV(A.sum(wait))}</div>
        ${isAdmin() ? (debt != null
          ? `<div class="stat" style="cursor:default"><div class="k"><span class="dot" style="background:var(--orange)"></span>Долг по 1С</div>${statV(debt)}</div>`
          : `<div class="stat" style="cursor:default"><div class="k"><span class="dot" style="background:var(--orange)"></span>Не оплачено · ${unpaid.length}</div>${statV(A.sum(unpaid))}</div>`)
          : `<div class="stat" style="cursor:default"><div class="k"><span class="dot" style="background:var(--green)"></span>Пришло · ${ords.filter((o) => o.status === 'delivered').length}</div><div class="v">${A.fmtMoney(A.sum(ords.filter((o) => o.status === 'delivered')))}</div></div>`}`;
    const api = A.sheet({ title: '', left: 'Закрыть', body: `
      <div class="hero">${A.av(r.full_name, 'width:72px;height:72px;font-size:26px;margin:0 auto 10px;border-radius:24px')}
        <div style="font-size:23px;font-weight:720;letter-spacing:-.02em">${E(r.full_name)}</div><div class="who">${E([r.company, phone1].filter(Boolean).join(' · ') || 'Торговый представитель')}${r.active ? '' : ' · отключён'}</div></div>
      <div class="quick" style="--qn:${1 + isAdmin() + !!phone1 + isAdmin()};margin:16px 0 4px">
        <button class="qbtn" data-act="order"><span class="qi">${QI.order}</span><span>Заказ</span></button>
        ${isAdmin() ? `<button class="qbtn" data-act="payout"><span class="qi">${QI.pay}</span><span>Выплата</span></button>` : ''}
        ${phone1 ? `<button class="qbtn" data-act="call"><span class="qi">${QI.call}</span><span>Звонок</span></button>` : ''}
        ${isAdmin() ? `<button class="qbtn" data-act="xls"><span class="qi">${QI.xls}</span><span>В Excel</span></button>` : ''}
      </div>
      <div class="stats" id="rstats" style="margin-top:10px">${statsHtml()}</div>
      ${siblingsOf(r).length ? `<div class="section-h"><span>${E(r.company)} · ещё ${siblingsOf(r).length}</span></div>
        <div class="chips sib">${siblingsOf(r).sort((x, y) => x.full_name.localeCompare(y.full_name, 'ru')).map((x) => `<button type="button" class="chip" data-sib="${x.id}">${E(x.full_name)}</button>`).join('')}</div>` : ''}
      <div class="segmented" id="rseg"></div>
      <div id="rtab"></div>
      ${acts}` });
    const box = api.body.querySelector('#rtab');
    let cur = tab;
    const drawSeg = () => { api.body.querySelector('#rseg').innerHTML = tabs().map(([k, l]) => `<button data-k="${k}" class="${k === cur ? 'on' : ''}">${E(l)}</button>`).join(''); };
    drawSeg();
    const docById = () => new Map((docs || []).map((d) => [d.id, d]));
    function payWarn(x) {
      const d = x.doc_id && docs ? docById().get(x.doc_id) : null;
      return d && x.status === 'paid' && !d.deleted && Number(d.open) > 0 ? 'в 1С не оплачено' : '';
    }
    function showTab(k) {
      cur = k; drawSeg();
      if (k === 'history') { box.innerHTML = A.skeleton(5, true); loadHistory({ rep_id: id }, box); return; }
      if (k === 'docs') { box.innerHTML = docsHtml(); bindDocs(); return; }
      const rows = k === 'orders' ? ords : pays;
      if (!rows.length) { box.innerHTML = A.emptyState(k === 'orders' ? 'Заказов нет' : 'Выплат нет'); return; }
      let html = '';
      for (const [ym, items] of A.groupBy(rows, (x) => (k === 'orders' ? x.order_date : x.payout_date).slice(0, 7))) {
        html += `<div class="section-h"><span>${A.fmtMonth(ym)}</span><span>${A.fmtMoney(A.sum(items.filter((x) => x.status !== 'cancelled')))}</span></div><div class="list">`
          + items.map((x) => (k === 'orders' ? orderRow(x) : payoutCell(x, [A.fmtShort(x.payout_date), payNote(x)].filter(Boolean).join(' · '), payWarn(x)))).join('') + '</div>';
      }
      box.innerHTML = html; bindCells(box);
    }
    // Вкладка «1С»: что не оплачено и вся история документов
    function docRow(d) {
      const link = st.payouts.find((p) => p.doc_id === d.id);
      const money = d.kind === 'in' || Number(d.inc) > 0 ? A.fmtMoney(d.inc) : '−' + A.fmtMoney(d.dec);
      const openIn = d.kind === 'in' && !d.deleted && Number(d.open) > 0, age = openIn ? daysSince(d.at) : 0;
      const sub = E([A.fmtShort(d.at.slice(0, 10)),
        d.deleted ? 'удалён в 1С' : d.kind === 'in' ? (openIn ? `не оплачено ${A.fmtMoney(d.open)}` : 'оплачено') : d.article].filter(Boolean).join(' · '))
        + (openIn ? ` · <span class="${A.ageCls(age)}">${age} дн.</span>` : '');
      const pill = openIn ? A.pill(link ? A.payView(link.status) : { label: 'Нет записи', c: 'orange' }) : '';
      return `<button class="cell doc ${d.deleted ? 'deleted' : ''} k-${d.kind}" data-doc="${d.id}">${A.docIcon(d.kind)}<div class="main">
        <div class="t">${E(docTitle(d))}</div><div class="s">${sub}</div></div>
        <div class="r"><div class="amt">${money}</div>${pill}</div></button>`;
    }
    // «Приход № 36», «Приход б/н», «Оплата накладной № 36», «Возврат»
    function docTitle(d) {
      const basis = d.kind !== 'in' && d.basis_id ? docById().get(d.basis_id) : null;
      if (basis) return `${docLabel(d)} накладной ${A.docNo(basis)}`;
      return `${docLabel(d)} ${A.docNo(d)}`.trim();
    }
    function docsHtml() {
      if (!docs) return A.skeleton(6);
      if (!docs.length) return A.emptyState('Документов 1С нет', 'Загрузите выгрузки 1С: ☰ → «Загрузить из 1С»');
      let html = window.Act ? '<button class="btn plain" type="button" data-act="act" style="margin:4px 0 0">Акт сверки · PDF</button>' : '';
      const open = docs.filter((d) => d.kind === 'in' && !d.deleted && Number(d.open) > 0).sort((a, b) => a.at.localeCompare(b.at));
      html += '';
      if (open.length) {
        html += `<div class="section-h"><span>Не оплачено · ${open.length}</span><span>${A.fmtMoney(open.reduce((a, d) => a + A.toCents(d.open), 0) / 100)}</span></div>
          <div class="list">${open.map(docRow).join('')}</div>`;
      }
      const shown = docs.slice(0, 300);
      for (const [ym, items] of A.groupBy(shown, (d) => d.at.slice(0, 7))) {
        const inc = items.filter((d) => !d.deleted).reduce((a, d) => a + A.toCents(d.inc), 0) / 100;
        html += `<div class="section-h"><span>${A.fmtMonth(ym)}</span><span>приход ${A.fmtMoney(inc)}</span></div><div class="list">${items.map(docRow).join('')}</div>`;
      }
      if (docs.length > shown.length) html += `<div class="footer-note">Показаны последние ${shown.length} документов из ${docs.length}.</div>`;
      return html;
    }
    function bindDocs() { box.querySelectorAll('[data-doc]').forEach((c) => c.addEventListener('click', () => docSheet(docById().get(c.dataset.doc)))); }
    function docSheet(d) {
      if (!d) return;
      const link = st.payouts.find((p) => p.doc_id === d.id), basis = d.basis_id ? docById().get(d.basis_id) : null;
      const canRecord = d.kind === 'in' && !d.deleted && Number(d.open) > 0 && !link;
      const a2 = A.sheet({ title: docLabel(d), left: 'Закрыть', body: `
        <div class="hero"><div class="amount">${A.fmtMoney(Number(d.inc) || Number(d.dec))}</div><div class="who">${E(docTitle(d))}</div>
          ${d.deleted ? A.pill({ label: 'Удалён в 1С', c: 'red' }) : d.kind === 'in' ? A.pill(Number(d.open) > 0 ? { label: `Не оплачено ${A.fmtMoney(d.open)}`, c: 'orange' } : { label: 'Оплачено', c: 'green' }) : ''}</div>
        <div class="section-h"><span>Из 1С</span></div>
        ${info([['Дата', A.fmtDate(d.at.slice(0, 10)) + ' ' + d.at.slice(11, 16)], ['Входящий №', d.kind === 'in' ? d.in_no || 'нет (ручная накладная)' : d.in_no],
          ['В розничных ценах', d.retail != null ? A.fmtMoney(d.retail) : null],
          ['Оплатить до', d.pay_due ? A.fmtDate(d.pay_due) : null], ['Статья', d.article], ['Касса', d.cash],
          ['По накладной', basis ? `${A.docNo(basis)} от ${A.fmtShort(basis.at.slice(0, 10))}` : null], ['Комментарий', d.comment],
          ['Номер в 1С', shortNum(d.num)]])}
        ${canRecord ? btn('record', 'Записать на выплату', 'blue') : ''}${link ? btn('openpay', 'Открыть запись на выплату') : ''}` });
      onActs(a2, {
        record: () => payoutForm(null, { rep_id: id, doc_id: d.id, amount: Number(d.open), invoice_no: d.in_no || '',
          payout_date: d.pay_due && d.pay_due >= A.today() ? d.pay_due : A.today(), after: () => setTimeout(() => repDetail(id, 'docs'), 350) }),
        openpay: () => payoutDetail(link.id),
      });
    }
    api.body.querySelector('#rseg').addEventListener('click', (e) => { const k = e.target.closest('button')?.dataset.k; if (k) showTab(k); });
    api.body.querySelector('.sib')?.addEventListener('click', (e) => { const b = e.target.closest('[data-sib]'); if (b) { A.haptic(); repDetail(b.dataset.sib, cur); } });
    showTab(tab);
    // Вся история поставщика и документы 1С — по запросу (стартовая загрузка берёт только свежее)
    if (navigator.onLine) sb.rpc('rep_history', { p_rep: id }).then(({ data, error }) => {
      if (error || !data || !api.el.isConnected) { if (!data && cur === 'docs') { docs = []; showTab('docs'); } return; }
      mergeRows(st.orders, data.orders); if (data.payouts) mergeRows(st.payouts, data.payouts);
      docs = data.docs || []; debt = data.debt != null && docs.length ? Number(data.debt) : null;
      recount(); api.body.querySelector('#rstats').innerHTML = statsHtml(); showTab(cur);
    });
    onActs(api, {
      order: () => orderForm(null, { rep_id: id }),
      payout: () => payoutForm(null, { rep_id: id }),
      act: () => {
        if (!docs) return;
        const byId = docById(), store = st.stores.length === 1 ? `магазином «${st.stores[0].name}»` : 'магазином';
        window.Act.open({ party: [r.company, r.full_name].filter(Boolean).join(' · '), store,
          docs: docs.map((d) => { const bs = d.basis_id && byId.get(d.basis_id);
            return { ...d, basisNo: bs ? (bs.in_no ? '№ ' + bs.in_no : 'от ' + A.fmtDate(bs.at.slice(0, 10))) : '' }; }) });
      },
      call: () => (location.href = 'tel:' + phone1.replace(/[^\d+]/g, '')),
      access: () => accessSheet(id),
      xls: () => repExcel(r, ords, pays, docs),
    });
  }

  // Доступ и управление представителем: ссылка, логин и пароль, данные, отключение
  function accessSheet(id) {
    const r = repById(id); if (!r) return;
    const ru = st.repUsers.find((u) => u.rep_id === id), phone1 = (r.phone || '').split(',')[0].trim();
    const api = A.sheet({ title: r.full_name, left: '\u2039 Карточка', body: `
      <div class="section-h"><span>Личная ссылка</span></div><div class="list">
        <button class="cell action" data-act="copy">Скопировать ссылку</button>
        <button class="cell action" data-act="wa">Отправить в WhatsApp</button>
        <button class="cell action" data-act="open">Открыть кабинет</button>
        <button class="cell action" data-act="regen">Выдать новую ссылку</button></div>
      <div class="section-h"><span>Вход по логину и паролю</span></div><div class="list">${ru
        ? `<div class="cell static"><div class="main">Логин</div><div class="value">${E(ru.login)}${ru.active ? '' : ' · отключён'}</div></div>
          <button class="cell action" data-act="acc_pass">Сменить пароль</button>
          <button class="cell ${ru.active ? 'danger' : 'action'}" data-act="acc_toggle">${ru.active ? 'Отключить вход' : 'Включить вход'}</button>
          <button class="cell danger" data-act="acc_del">Удалить вход</button>`
        : '<button class="cell action" data-act="acc_new">Создать логин и пароль</button>'}</div>
      <div class="footer-note">По желанию. Представитель видит только своё: заказы, записи, накладные, оплаты, возвраты, долг. Ссылка продолжает работать.</div>
      <div class="section-h"><span>Управление</span></div><div class="list">
        <button class="cell action" data-act="edit">Изменить данные</button>
        <button class="cell ${r.active ? 'danger' : 'action'}" data-act="toggle">${r.active ? 'Отключить доступ' : 'Включить доступ'}</button>
        <button class="cell danger" data-act="delete">Удалить</button></div>` });
    api.el.querySelector('[data-x=left]').addEventListener('click', () => setTimeout(() => repDetail(id), 330));
    const link = () => repLink(r);
    const update = async (patch, msg) => {
      const { data, error } = await sb.from('reps').update(patch).eq('id', id).select().single(); if (fail(error)) return;
      Object.assign(r, data); A.toast(msg); api.close(); render();
    };
    onActs(api, {
      copy: async () => { try { await navigator.clipboard.writeText(link()); A.toast('Ссылка скопирована'); } catch { window.prompt('Скопируйте ссылку', link()); } },
      wa: () => {
        const phone = phone1.replace(/\D/g, '').replace(/^8(?=\d{10}$)/, '7');
        const text = `${r.full_name}, здесь ваши заказы и выплаты: ${link()}`;
        window.open(`https://wa.me/${phone}?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
      },
      open: () => window.open(link(), '_blank', 'noopener'),
      regen: async () => {
        if (!(await confirmAct('Старая ссылка перестанет работать. Выдать новую?'))) return;
        const { data, error } = await sb.from('rep_access').update({ token: newToken() }).eq('rep_id', id).select().single(); if (fail(error)) return;
        const a = st.access.find((x) => x.rep_id === id); if (a) a.token = data.token; else st.access.push(data);
        A.toast('Новая ссылка готова — отправьте её');
      },
      edit: () => repForm(r),
      acc_new: () => repAccountForm(r, () => setTimeout(() => accessSheet(id), 300)),
      acc_pass: () => repAccountForm(r, null, st.repUsers.find((u) => u.rep_id === id)),
      acc_toggle: async () => {
        const ru = st.repUsers.find((u) => u.rep_id === id); if (!ru) return;
        if (ru.active && !(await confirmAct(`Отключить вход «${ru.login}»? Ссылка продолжит работать.`))) return;
        try { const d = await staffCall({ action: 'rep_update', rep_id: id, active: !ru.active }); Object.assign(ru, d.rep_user);
          A.toast(ru.active ? 'Вход включён' : 'Вход отключён'); setTimeout(() => accessSheet(id), 50); }
        catch (e) { A.toast(e.message, true); }
      },
      acc_del: async () => {
        const ru = st.repUsers.find((u) => u.rep_id === id); if (!ru) return;
        if (!(await confirmAct(`Удалить вход «${ru.login}»? Заказы и выплаты останутся, ссылка продолжит работать.`))) return;
        try { await staffCall({ action: 'rep_delete', rep_id: id }); st.repUsers = st.repUsers.filter((u) => u.rep_id !== id);
          A.toast('Вход удалён'); setTimeout(() => accessSheet(id), 50); }
        catch (e) { A.toast(e.message, true); }
      },
      toggle: () => update({ active: !r.active }, r.active ? 'Доступ отключён' : 'Доступ включён'),
      delete: async () => {
        if (!(await confirmAct(`Удалить «${r.full_name}»?`))) return;
        const { error } = await sb.from('reps').delete().eq('id', id); if (fail(error)) return;
        st.reps = st.reps.filter((x) => x.id !== id); api.close(); A.toast('Удалено'); render();
      },
    });
  }
  // Заказ в карточке представителя: имя не повторяем, показываем дату и срок
  function orderRow(o) {
    const v = ordView(o);
    const when = [A.orderWhen({ status: o.status, expected: o.expected_date, delivered_at: o.delivered_at }), actualNote(o)].filter(Boolean).join(' · ');
    return `<button class="cell" data-id="${o.id}"><div class="main"><div class="t">Заказ от ${E(A.fmtShort(o.order_date))}${o.order_no ? ' · № ' + E(o.order_no) : ''}</div>
      <div class="s">${E(when)}</div></div><div class="r"><div class="amt">${A.fmtMoney(o.amount)}</div>${A.pill(v)}</div></button>`;
  }
  function repForm(r = null) {
    const api = A.sheet({ title: r ? 'Изменить' : 'Новый представитель', right: { label: 'Готово', onClick: (a) => save(a) }, body: `
      <div class="section-h"><span>Данные</span></div><div class="list">
        ${field('ФИО', `<input name="full_name" value="${E(r?.full_name || '')}" placeholder="обязательно">`)}
        ${field('Компания', `<input name="company" value="${E(r?.company || '')}" placeholder="поставщик / дистрибьютор">`)}
        ${field('Телефон', `<input name="phone" type="tel" value="${E(r?.phone || '')}" placeholder="+7…">`)}</div>
      <button class="btn blue" type="button" data-act="save">${r ? 'Сохранить' : 'Добавить'}</button>` });
    onActs(api, { save: () => save(api) });
    async function save(api) {
      const v = (n) => api.body.querySelector(`[name=${n}]`).value.trim();
      if (!v('full_name')) return A.toast('Укажите ФИО', true);
      const row = { full_name: v('full_name'), company: v('company') || null, phone: v('phone') || null };
      api.busy(true);
      const q = r ? sb.from('reps').update(row).eq('id', r.id) : sb.from('reps').insert(row);
      const { data, error } = await q.select().single(); api.busy(false); if (fail(error)) return;
      if (r) Object.assign(r, data); else { st.reps.push(data); if (isAdmin()) { const a = await sb.from('rep_access').select('*').eq('rep_id', data.id).single(); if (a.data) st.access.push(a.data); } }
      sortRu(st.reps, 'full_name'); api.close(); A.toast('Сохранено'); render();
    }
  }
  function storeForm(s = null) {
    const canEdit = !s || isAdmin();
    const api = A.sheet({ title: s ? 'Магазин' : 'Новый магазин', left: canEdit ? 'Отмена' : 'Закрыть', right: canEdit ? { label: 'Готово', onClick: (a) => save(a) } : null, body: `
      <div class="section-h"><span>Данные</span></div><div class="list">
        ${field('Название', `<input name="name" value="${E(s?.name || '')}" ${canEdit ? '' : 'readonly'}>`)}
        ${field('Адрес', `<input name="address" value="${E(s?.address || '')}" ${canEdit ? '' : 'readonly'} placeholder="необязательно">`)}</div>
      ${canEdit ? btn('save', s ? 'Сохранить' : 'Добавить', 'blue') : ''}${s && isAdmin() ? btn('delete', 'Удалить', 'red') : ''}` });
    onActs(api, {
      save: () => save(api),
      delete: async () => {
        if (!(await confirmAct(`Удалить «${s.name}»?`))) return;
        const { error } = await sb.from('stores').delete().eq('id', s.id); if (fail(error)) return;
        st.stores = st.stores.filter((x) => x.id !== s.id); api.close(); A.toast('Удалено'); render();
      },
    });
    async function save(api) {
      const v = (n) => api.body.querySelector(`[name=${n}]`).value.trim();
      if (!v('name')) return A.toast('Укажите название', true);
      const row = { name: v('name'), address: v('address') || null };
      api.busy(true);
      const q = s ? sb.from('stores').update(row).eq('id', s.id) : sb.from('stores').insert(row);
      const { data, error } = await q.select().single(); api.busy(false); if (fail(error)) return;
      if (s) Object.assign(s, data); else st.stores.push(data);
      sortRu(st.stores, 'name'); api.close(); A.toast('Сохранено'); render();
    }
  }

  // =====================================================================
  // ЕЩЁ: профиль, сотрудники, выход
  // =====================================================================
  function renderMore() {
    frame('Ещё', null, null, null);
    render.body = renderMore;
    const roleName = (s) => (s.role === 'admin' ? 'Администратор' : 'Сотрудник');
    let html = '';
    if (isAdmin()) {
      html += `<div class="section-h"><span>Сотрудники</span></div><div class="list">` + st.staff.map((s) =>
        `<button class="cell" data-staff="${s.user_id}">${A.av(s.full_name)}<div class="main"><div class="t">${E(s.full_name)}${s.user_id === st.me.user_id ? ' <span class="value">· вы</span>' : ''}</div>
          <div class="s">${E(s.login)} · ${roleName(s)}${s.active ? '' : ' · отключён'}</div></div></button>`).join('')
        + `<button class="cell action" data-act-add>＋ Добавить сотрудника</button></div>
        <div class="section-h"><span>${st.stores.length > 1 ? 'Магазины' : 'Магазин'}</span></div><div class="list">`
        + st.stores.map((s) => `<button class="cell" data-store="${s.id}"><div class="main"><div class="t">${E(s.name)}</div>${s.address ? `<div class="s">${E(s.address)}</div>` : ''}</div></button>`).join('')
        + `<button class="cell action" data-act-store>＋ Добавить магазин</button></div>
        <div class="section-h"><span>Контроль</span></div><div class="list">
          <button class="cell action" data-act-history>История изменений</button></div>
        <div class="section-h"><span>Общая ссылка для представителей</span></div><div class="list">
          <button class="cell action" data-shared="copy">Скопировать ссылку</button>
          <button class="cell action" data-shared="wa">Отправить в WhatsApp</button>
          <button class="cell action" data-shared="open">Открыть</button>
          <button class="cell action" data-shared="reset">Выдать новую ссылку</button></div>
        <div class="footer-note">Одна ссылка для всех: кто и на какое число записан на выплату. Выплаченные не видны. Новая ссылка отключает старую.</div>
        <div class="section-h"><span>1С</span></div><div class="list">
          <button class="cell action" data-act-import>Загрузить из 1С</button>
          ${st.open1c?.n ? `<button class="cell action" data-act-unrec>Не оплачено в 1С · ${st.open1c.n}</button>` : ''}
          <button class="cell danger" data-act-purge>Удалить загруженное за период</button></div>
        <div class="footer-note">Контрагенты, приходные накладные, расходные кассовые ордера, возвраты, «Взаиморасчёты с контрагентами» — можно несколько файлов сразу.
          Повторная загрузка обновляет изменения, копий не будет.</div>
        ${st.dbMb != null ? `<div class="section-h"><span>Место</span></div><div class="list"><div class="cell static"><div class="main">База данных</div>
          <div class="value" style="color:var(--${st.dbMb >= 400 ? 'red' : 'label2'})">${st.dbMb} МБ из 500</div></div></div>
          ${st.dbMb >= 400 ? '<div class="footer-note warn">База почти заполнена — сообщите, чтобы перенести старые документы в архив.</div>' : ''}` : ''}`;
    } else {
      html += `<div class="list" style="margin-top:12px"><div class="cell static">${A.av(st.me.full_name)}
        <div class="main"><div class="t"><b>${E(st.me.full_name)}</b></div><div class="s">${E(st.me.login)} · ${roleName(st.me)}</div></div></div></div>`;
    }
    if (/iPhone|iPad|iPod/.test(navigator.userAgent) && !navigator.standalone) {
      html += `<div class="section-h"><span>На iPhone</span></div><div class="list"><div class="cell static"><div class="main"><div class="s" style="white-space:normal">
        Safari → «Поделиться» → «На экран Домой». Приложение откроется без адресной строки, как обычное.</div></div></div></div>`;
    }
    html += `<div class="section-h"><span>Связь</span></div><div class="list"><button class="cell action" id="netcheck">Проверить связь</button></div>
      <div class="footer-note">Включите и выключите VPN и проверьте оба раза: видно, доходят ли данные без VPN.</div>`;
    html += `<div class="section-h"><span>Оформление</span></div><div class="segmented" id="theme">${[['light', 'Светлое'], ['dark', 'Тёмное'], ['auto', 'Как в системе']]
      .map(([k, l]) => `<button data-k="${k}" class="${A.getTheme() === k ? 'on' : ''}">${l}</button>`).join('')}</div>
      <div class="section-h"><span>Размер текста</span></div><div class="segmented" id="fz">${[['n', 'Обычный'], ['l', 'Крупный'], ['xl', 'Очень крупный']]
      .map(([k, l]) => `<button data-k="${k}" class="${A.getFz() === k ? 'on' : ''}">${l}</button>`).join('')}</div>
      <div class="list" style="margin-top:24px"><button class="cell danger" id="logout">Выйти</button></div>`;
    setBody(html);
    $('body').querySelectorAll('[data-store]').forEach((c) => c.addEventListener('click', () => storeForm(storeById(c.dataset.store))));
    $('body').querySelector('[data-act-store]')?.addEventListener('click', () => storeForm());
    $('body').querySelector('[data-act-import]')?.addEventListener('click', () => import1C());
    $('body').querySelector('[data-act-purge]')?.addEventListener('click', () => purge1C());
    $('body').querySelector('[data-act-unrec]')?.addEventListener('click', () => debtSheet('all'));
    $('body').querySelector('[data-act-history]')?.addEventListener('click', () => historySheet());
    $('body').querySelectorAll('[data-shared]').forEach((c) => c.addEventListener('click', () => sharedLink(c.dataset.shared)));
    $('body').querySelectorAll('[data-staff]').forEach((c) => c.addEventListener('click', () => staffForm(st.staff.find((s) => s.user_id === c.dataset.staff))));
    $('body').querySelector('[data-act-add]')?.addEventListener('click', () => staffForm());
    $('netcheck').addEventListener('click', netCheck);
    $('theme').addEventListener('click', (e) => { const k = e.target.closest('button')?.dataset.k; if (k) { A.haptic(); A.setTheme(k); renderMore(); } });
    $('fz').addEventListener('click', (e) => { const k = e.target.closest('button')?.dataset.k; if (k) { A.haptic(); A.setFz(k); renderMore(); } });
    $('logout').addEventListener('click', async () => {
      if (queue.length && !(await confirmAct(`Не отправлено изменений: ${queue.length}. При выходе они пропадут. Выйти?`))) return;
      queue = []; saveQueue(); try { localStorage.removeItem(CKEY); } catch { /* */ }
      await sb.auth.signOut(); st.me = null; showLogin(); });
  }


  // =====================================================================
  // ЗАПИСЬ ДАННЫХ: работа без сети, кэш, отмена действия
  // =====================================================================
  const QKEY = 'sverka-queue', CKEY = 'sverka-cache';
  // crypto.randomUUID нет в старых iOS/Android — запасной вариант на getRandomValues
  const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, (c) => (c ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (c / 4)))).toString(16)));
  const isNetErr = (e) => !navigator.onLine || /Failed to fetch|NetworkError|Load failed|network|fetch/i.test(e?.message || String(e || ''));
  let queue = []; try { queue = JSON.parse(localStorage.getItem(QKEY) || '[]'); } catch { queue = []; }
  const saveQueue = () => { try { localStorage.setItem(QKEY, JSON.stringify(queue)); } catch { /* переполнено */ } offlineBar(); };
  const listOf = (table) => (table === 'orders' ? st.orders : st.payouts);

  async function send(w) {
    let q;
    if (w.op === 'insert') q = sb.from(w.table).insert({ ...w.row, id: w.id }).select().single();
    else if (w.op === 'update') q = sb.from(w.table).update(w.row).eq('id', w.id).select().single();
    else q = sb.from(w.table).delete().eq('id', w.id);
    const { data, error } = await q;
    if (error && w.op === 'insert' && error.code === '23505') return (await sb.from(w.table).select('*').eq('id', w.id).single()).data; // уже записано раньше
    if (error && w.op === 'update' && error.code === 'PGRST116') return null; // запись удалили
    if (error) throw error;
    return data;
  }
  // Местное отражение изменения (до ответа сервера или без сети)
  function applyLocal(w, pending) {
    const list = listOf(w.table);
    if (w.op === 'delete') { const i = list.findIndex((x) => x.id === w.id); if (i >= 0) list.splice(i, 1); return; }
    let row = list.find((x) => x.id === w.id);
    if (!row) {
      const now = new Date().toISOString();
      row = { id: w.id, status: w.table === 'orders' ? 'ordered' : 'to_pay', created_at: now, updated_at: now, created_by: st.me?.user_id, ...w.row };
      list.unshift(row);
    } else Object.assign(row, w.row);
    if (w.row.status === 'delivered' && !row.delivered_at) row.delivered_at = new Date().toISOString();
    if (w.row.status && w.row.status !== 'delivered') row.delivered_at = null;
    if (w.row.status === 'paid' && !row.paid_at) row.paid_at = new Date().toISOString();
    if (w.table === 'payouts' && w.row.status && w.row.status !== 'paid') row.paid_at = null;
    row._pending = pending;
  }
  // Записать: сразу на сервер; без сети — в очередь, отправится сама
  async function write(table, op, id, row = {}) {
    const w = { table, op, id: id || uuid(), row };
    if (queue.length) await flush();
    if (!queue.length) {
      try {
        const data = await send(w);
        if (data) { const list = listOf(table); const r = list.find((x) => x.id === w.id); if (r) { Object.assign(r, data); delete r._pending; } else list.unshift(data); }
        else applyLocal(w, false);
        cacheSave();
        return { id: w.id, offline: false };
      } catch (e) { if (!isNetErr(e)) throw e; }
    }
    queue.push(w); saveQueue(); applyLocal(w, true); cacheSave();
    return { id: w.id, offline: true };
  }
  let flushing = null;
  function flush() {
    if (flushing) return flushing;
    flushing = (async () => {
      let sent = 0;
      while (queue.length) {
        try { await send(queue[0]); queue.shift(); sent++; saveQueue(); }
        catch (e) {
          if (isNetErr(e)) break;
          A.toast('Не удалось отправить изменение: ' + humanError(e), true); queue.shift(); saveQueue();
        }
      }
      if (sent) A.toast(`Отправлено изменений: ${sent}`);
      return sent;
    })().finally(() => { flushing = null; });
    return flushing;
  }
  function applyQueue() { for (const w of queue) applyLocal(w, true); }
  function cacheSave() {
    try { localStorage.setItem(CKEY, JSON.stringify({ me: st.me, reps: st.reps, stores: st.stores, orders: st.orders, payouts: st.payouts, access: st.access, repUsers: st.repUsers, staff: st.staff, unrec: st.unrec, open1c: st.open1c, dbMb: st.dbMb })); }
    catch { /* мало места — без кэша */ }
  }
  function cacheLoad() {
    try { const c = JSON.parse(localStorage.getItem(CKEY) || 'null'); if (!c) return false; Object.assign(st, c); return true; } catch { return false; }
  }
  // Полоска «нет сети»
  function offlineBar() {
    let bar = $('offline');
    if (!bar) { bar = document.createElement('div'); bar.id = 'offline'; bar.className = 'offline-bar'; document.body.append(bar); }
    const off = !navigator.onLine, n = queue.length;
    bar.textContent = off ? (n ? `Нет сети · не отправлено: ${n}. Отправится само` : 'Нет сети · показаны сохранённые данные')
      : n ? `Отправка изменений: ${n}…` : '';
    bar.classList.toggle('show', !!(st.me && (off || n)));
  }
  window.addEventListener('online', async () => { offlineBar(); if (await flush()) { await loadAll(); render(); } offlineBar(); });
  window.addEventListener('offline', offlineBar);

  // Смена статуса с кнопкой «Вернуть»
  async function changeStatus(table, id, status, msg) {
    const row = listOf(table).find((x) => x.id === id); if (!row) return;
    const prev = row.status;
    try {
      const r = await write(table, 'update', id, { status });
      rerender();
      A.toast(r.offline ? msg + ' · отправится при появлении сети' : msg, false, { label: 'Вернуть', run: async () => {
        try { await write(table, 'update', id, { status: prev }); rerender(); A.haptic(); } catch (e) { A.toast(humanError(e), true); }
      } });
    } catch (e) { A.toast(humanError(e), true); }
  }
  // Удаление с отсрочкой 5 секунд: можно вернуть
  const pendingDeletes = new Map();
  function deleteWithUndo(table, id, label) {
    const list = listOf(table), i = list.findIndex((x) => x.id === id); if (i < 0) return;
    const [row] = list.splice(i, 1); rerender();
    const timer = setTimeout(() => commitDelete(table, id, row, i), 5000);
    pendingDeletes.set(id, { table, row, i, timer });
    A.toast(label, false, { label: 'Вернуть', run: () => {
      const p = pendingDeletes.get(id); if (!p) return;
      clearTimeout(p.timer); pendingDeletes.delete(id); listOf(table).splice(Math.min(p.i, listOf(table).length), 0, p.row); rerender(); A.haptic();
    } });
  }
  async function commitDelete(table, id, row, i) {
    pendingDeletes.delete(id);
    try { await write(table, 'delete', id); }
    catch (e) { listOf(table).splice(Math.min(i, listOf(table).length), 0, row); rerender(); A.toast(humanError(e), true); }
  }
  // Закрыли вкладку раньше 5 секунд — удаление всё равно выполняется
  window.addEventListener('pagehide', () => { for (const [id, p] of pendingDeletes) { clearTimeout(p.timer); commitDelete(p.table, id, p.row, p.i); } });
  function rerender() { if (!st.me) return; (render.body || render)(); renderTabs(); }

  // ---------- проверка связи ----------
  // Сайт приходит с GitHub, данные — из Supabase через Cloudflare. Часть провайдеров РФ обрывает
  // соединения с Cloudflare после ~16 КБ: маленькие запросы проходят, большие — нет. Проверка показывает это на месте.
  async function netCheck() {
    const api = A.sheet({ title: 'Проверка связи', left: 'Закрыть', body: '<div class="list" id="nc" style="margin-top:8px"></div><div class="footer-note" id="ncn"></div>' });
    const box = api.body.querySelector('#nc'), note = api.body.querySelector('#ncn'), rows = [];
    const row = (k, v, ok) => `<div class="cell static"><div class="main">${E(k)}</div><div class="value" style="text-align:right;color:var(--${ok == null ? 'label2' : ok ? 'green' : 'red'})">${E(v)}</div></div>`;
    const show = (extra = '') => { box.innerHTML = rows.join('') + extra; };
    const kb = (n) => Math.max(1, Math.round(n / 1024)) + ' КБ', sec = (ms) => (ms / 1000).toFixed(1).replace('.', ',') + ' с';
    async function measure(url, opts = {}) {
      const t0 = performance.now(), ctl = new AbortController(), to = setTimeout(() => ctl.abort(), 15000);
      let got = 0;
      try {
        const r = await fetch(url, { ...opts, signal: ctl.signal, cache: 'no-store' });
        const rd = r.body.getReader();
        for (;;) { const { done, value } = await rd.read(); if (done) break; got += value.length; }
        return { ok: r.ok, got, ms: performance.now() - t0 };
      } catch { return { ok: false, got, ms: performance.now() - t0 }; } finally { clearTimeout(to); }
    }
    // разовый сбой (например, сразу после включения/выключения VPN) — повторить один раз
    const measure2 = async (url, opts) => { const m = await measure(url, opts); if (m.ok) return m; const r = await measure(url, opts); r.retried = true; return r; };
    const res = (m) => (m.ok ? `${kb(m.got)} за ${sec(m.ms)}${m.retried ? ' (со 2-й попытки)' : ''}` : m.got ? `оборвалось на ${kb(m.got)}` : `нет ответа (${sec(m.ms)})`);
    rows.push(row('Интернет', navigator.onLine ? 'есть' : 'нет', navigator.onLine));
    show(row('Сайт (GitHub)', 'проверяю…'));
    const site = await measure2(new URL(`vendor/supabase.js?v=nc${Date.now()}`, location.href).href);
    rows.push(row('Сайт (GitHub)', res(site), site.ok));
    show(row('База: короткий ответ', 'проверяю…'));
    const { SUPABASE_URL, SUPABASE_KEY } = window.APP_CONFIG;
    const small = await measure2(`${SUPABASE_URL}/auth/v1/health`, { headers: { apikey: SUPABASE_KEY } });
    rows.push(row('База: короткий ответ', res(small), small.ok));
    show(row('База: все данные', 'проверяю…'));
    const token = (await sb.auth.getSession()).data.session?.access_token;
    const big = await measure2(`${SUPABASE_URL}/rest/v1/rpc/app_bootstrap`, { method: 'POST',
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${token || SUPABASE_KEY}`, 'Content-Type': 'application/json' }, body: '{}' });
    rows.push(row('База: все данные', res(big), big.ok)); show();
    note.textContent = big.ok ? (small.ok ? 'Связь в порядке: данные доходят полностью.' : 'Данные доходят полностью; короткий запрос не прошёл — разовый сбой сети.')
      : small.ok ? 'Короткие ответы проходят, большие обрываются: провайдер ограничивает Cloudflare, через который работает база. Сообщите — подключу обходной путь.'
      : site.ok ? 'Сайт открывается, а база не отвечает: провайдер ограничивает доступ к ней. Сообщите — подключу обходной путь.' : 'Нет связи с интернетом или сайтом.';
  }

  // ---------- быстрые действия свайпом по строке ----------
  const quickStatus = changeStatus;
  function swipeActions(cell) {
    if (cell.dataset.id) {
      const o = st.orders.find((x) => x.id === cell.dataset.id);
      if (!o || o.status !== 'ordered') return o ? [{ label: 'Ожидается', color: 'blue', run: () => quickStatus('orders', o.id, 'ordered', 'Заказ снова ожидается') }] : [];
      return [{ label: 'Пришёл', color: 'green', run: () => quickStatus('orders', o.id, 'delivered', 'Отмечено: пришёл') },
        { label: 'Отменить', color: 'red', run: () => quickStatus('orders', o.id, 'cancelled', 'Заказ отменён') }];
    }
    const p = st.payouts.find((x) => x.id === cell.dataset.pay);
    if (!p || !isAdmin()) return [];
    if (p.status === 'paid') return [{ label: 'Не оплачено', color: 'gray', run: () => quickStatus('payouts', p.id, 'to_pay', 'Оплата снята') }];
    return [{ label: 'Оплачено', color: 'green', run: () => quickStatus('payouts', p.id, 'paid', 'Оплачено') }];
  }
  A.swipeRows($('page'), swipeActions);
  // Ветка ИП в списках сворачивается/разворачивается нажатием на заголовок
  document.addEventListener('click', (e) => {
    const h = e.target.closest('.co-h'); if (!h) return;
    h.closest('.tgrp')?.classList.toggle('closed'); A.haptic();
  });
  A.pullToRefresh(() => refresh(true, true));


  // =====================================================================
  // СВОДКА (админ): долг по 1С, его возраст, выплаты недели, приход и оплаты по месяцам, кто дольше ждёт
  // =====================================================================
  const AGE = [['a', 'до 30 дней', 'var(--age1)'], ['b', '31–60 дней', 'var(--age2)'], ['c', '61–90 дней', 'var(--age3)'], ['d', 'больше 90', 'var(--age4)']];
  const MON = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
  const shortMoney = (v) => { const n = Math.abs(Number(v) || 0);
    return n >= 1e6 ? (n / 1e6).toLocaleString('ru-RU', { maximumFractionDigits: 1 }) + ' млн' : n >= 1e3 ? Math.round(n / 1e3).toLocaleString('ru-RU') + ' тыс' : String(Math.round(n)); };
  function renderSummary() {
    frame('Сводка', null, 'sum', null);
    render.body = renderSummary;
    const t = A.today();
    // выплаты на 7 дней вперёд — из уже загруженных записей
    const days7 = Array.from({ length: 7 }, (_, i) => A.addDays(t, i));
    const open = st.payouts.filter((p) => p.status !== 'paid');
    const late = open.filter((p) => p.payout_date < t);
    const wk = days7.map((d) => ({ d, rows: open.filter((p) => p.payout_date === d) }));
    const wd = (d) => new Date(d + 'T12:00:00').toLocaleDateString('ru-RU', { weekday: 'short' });
    setBody(`<div class="subtitle">Долг по накладным 1С и записи на выплату</div>
      <div id="s-debt">${A.skeleton(3)}</div>
      <div class="section-h"><span>Выплаты на неделю</span><span>${A.moneyOrDash(A.sum(wk.flatMap((x) => x.rows)))}</span></div>
      <div class="wk">${wk.map((x) => `<button type="button" class="${x.d === t ? 'today' : ''} ${x.rows.length ? 'has' : ''}" data-day="${x.d}">
        <div class="d">${E(wd(x.d))}</div><div class="n">${Number(x.d.slice(8))}</div><div class="s">${x.rows.length ? shortMoney(A.sum(x.rows)) : '—'}</div></button>`).join('')}</div>
      ${late.length ? `<div class="list" style="margin-top:10px"><button class="cell" data-late><div class="main"><div class="t"><b>Просрочено</b></div>
        <div class="s">${late.length} зап. · самая старая на ${A.fmtShort(late.reduce((m, p) => (p.payout_date < m ? p.payout_date : m), t))}</div></div>
        <div class="r"><div class="amt" style="color:var(--red)">${A.fmtMoney(A.sum(late))}</div></div><span class="chev">›</span></button></div>` : ''}
      <div id="s-rest"></div>`);
    $('body').querySelectorAll('[data-day]').forEach((b) => b.addEventListener('click', () => {
      const d = b.dataset.day; A.haptic(); st.tab = 'today'; st.seg.today = 'cal'; st.cal = { ym: d.slice(0, 7), day: d }; render();
    }));
    $('body').querySelector('[data-late]')?.addEventListener('click', () => { st.seg.payouts = 'to_pay'; openTab('payouts'); });
    if (!navigator.onLine) { $('s-debt').innerHTML = A.emptyState('Нет сети', 'Сводка по 1С считается на сервере'); return; }
    sb.rpc('summary_stats').then(({ data, error }) => {
      if (st.tab !== 'sum' || !$('s-debt')) return;
      if (error) { $('s-debt').innerHTML = A.emptyState('Не удалось загрузить', humanError(error)); return; }
      drawSummary(data);
    });
  }
  function drawSummary(d) {
    const ag = d.aging || {}, total = Number(d.open?.sum || 0);
    const bar = AGE.map(([k, , c]) => { const v = Number(ag[k]?.sum || 0); return v > 0 ? `<span style="flex:${v};background:${c}" title="${A.fmtMoney(v)}"></span>` : ''; }).join('');
    $('s-debt').innerHTML = `<div class="kpi">
        <div class="lbl">Не оплачено по накладным</div>
        <div class="big">${A.fmtMoney(total)}</div>
        ${total ? `<div class="agebar" role="img" aria-label="Возраст долга">${bar}</div>
        <div class="age-legend">${AGE.map(([k, l, c]) => `<button type="button"><i style="background:${c}"></i><span><span class="t">${l}</span>
          <b>${A.fmtMoney(ag[k]?.sum || 0)}</b></span></button>`).join('')}</div>` : ''}
        <div class="footer-note" style="margin:12px 0 0">${Number(d.open?.n || 0).toLocaleString('ru-RU')} накл. без расходника${d.debt != null ? ` · по взаиморасчётам ${A.fmtMoney(d.debt)}` : ''}</div>
      </div>`;
    // приход и оплаты по месяцам — сгруппированные столбцы, нажатие на месяц показывает цифры
    const months = (d.months || []).slice(-12);
    let html = '';
    if (months.length) {
      const W = 340, H = 168, top = 8, base = 140, left = 34;
      const max = Math.max(1, ...months.flatMap((m) => [Number(m.in), Number(m.pay)]));
      const nice = (() => { const p = 10 ** Math.floor(Math.log10(max)); const f = max / p; return ([1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].find((x) => x >= f) || 10) * p; })();
      const y = (v) => base - (Number(v) / nice) * (base - top);
      const slot = (W - left) / months.length, bw = Math.max(4, Math.min(12, (slot - 8) / 2));
      const rbar = (x, v, cls) => { const yy = y(v), h = base - yy; if (h < 0.5) return '';
        const r = Math.min(3, h, bw / 2); return `<path class="${cls}" d="M${x},${base}V${yy + r}Q${x},${yy} ${x + r},${yy}H${x + bw - r}Q${x + bw},${yy} ${x + bw},${yy + r}V${base}Z"/>`; };
      const grid = [0, 0.5, 1].map((f) => `<line x1="${left}" x2="${W}" y1="${y(nice * f)}" y2="${y(nice * f)}"/><text class="ax" x="${left - 6}" y="${y(nice * f) + 4}" text-anchor="end">${f ? shortMoney(nice * f) : '0'}</text>`).join('');
      const marks = months.map((m, i) => { const cx = left + slot * i + slot / 2, mo = Number(m.m.slice(5)) - 1;
        return `<rect class="hit" data-m="${i}" x="${left + slot * i}" y="${top}" width="${slot}" height="${H - top}" rx="6"/>
          ${rbar(cx - bw - 1, m.in, 'bar-in')}${rbar(cx + 1, m.pay, 'bar-pay')}
          <text class="ax" x="${cx}" y="${base + 16}" text-anchor="middle">${MON[mo]}</text>`; }).join('');
      html += `<div class="section-h"><span>Приход и оплаты по месяцам</span></div>
        <div class="chart"><div class="legend"><span><i style="background:var(--c-in)"></i>Пришло</span><span><i style="background:var(--c-pay)"></i>Оплачено</span></div>
          <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Приход и оплаты по месяцам"><g class="grid">${grid}</g>${marks}</svg>
          <div class="tip" id="s-tip"></div></div>`;
      $('s-rest').innerHTML = html;
      const tip = (i) => {
        const m = months[i], mo = Number(m.m.slice(5)) - 1, diff = Number(m.in) - Number(m.pay) - Number(m.ret);
        $('s-rest').querySelectorAll('.hit').forEach((h) => h.classList.toggle('on', Number(h.dataset.m) === i));
        $('s-tip').innerHTML = `<div class="m">${MON[mo][0].toUpperCase() + MON[mo].slice(1)} ${m.m.slice(0, 4)}</div>
          <span>Пришло</span><em>${A.fmtMoney(m.in)}</em><span>Оплачено</span><em>${A.fmtMoney(m.pay)}</em>
          <span>Возвраты</span><em>${A.fmtMoney(m.ret)}</em><span>${diff >= 0 ? 'Долг вырос на' : 'Долг уменьшился на'}</span><em>${A.fmtMoney(Math.abs(diff))}</em>`;
      };
      $('s-rest').querySelector('svg').addEventListener('click', (e) => { const h = e.target.closest('.hit'); if (h) { A.haptic(); tip(Number(h.dataset.m)); } });
      $('s-rest').querySelector('svg').addEventListener('mousemove', (e) => { const h = e.target.closest('.hit'); if (h && !h.classList.contains('on')) tip(Number(h.dataset.m)); });
      tip(months.length - 1);
    }
    // кто дольше и больше всех ждёт оплаты
    const topRows = (d.top || []).map((x) => ({ ...x, r: repById(x.rep_id) }));
    if (topRows.length) {
      const mx = Math.max(...topRows.map((x) => Number(x.sum)));
      $('s-rest').insertAdjacentHTML('beforeend', `<div class="section-h"><span>Больше всего ждут оплаты</span><span>топ ${topRows.length}</span></div>
        <div class="list">${topRows.map((x) => { const dd = daysSince(x.since);
          return `<button class="cell" data-rep="${x.rep_id}">${A.av(x.r?.full_name || '?')}<div class="main"><div class="t"><b>${E(x.r?.full_name || '—')}</b></div>
            <div class="s">${x.n} накл. · <span class="${A.ageCls(dd)}">ждёт ${dd} дн.</span></div>
            <div class="meter"><i style="width:${Math.max(3, Math.round((Number(x.sum) / mx) * 100))}%"></i></div></div>
            <div class="r"><div class="amt">${A.fmtMoney(x.sum)}</div></div></button>`; }).join('')}</div>`);
      $('s-rest').querySelectorAll('[data-rep]').forEach((c) => c.addEventListener('click', () => repDetail(c.dataset.rep, 'docs')));
    }
    $('s-rest').insertAdjacentHTML('beforeend', `<div class="list" style="margin-top:22px"><button class="cell action" data-sxls>Выгрузить сводку в Excel</button>
      <button class="cell action" data-sdebt>Все неоплаченные накладные</button></div>`);
    $('s-rest').querySelector('[data-sdebt]').addEventListener('click', () => debtSheet('all'));
    $('s-rest').querySelector('[data-sxls]').addEventListener('click', () => {
      const rows = [['Не оплачено по накладным', '', Number(total)], ...AGE.map(([k, l]) => ['  ' + l, Number(ag[k]?.n || 0), Number(ag[k]?.sum || 0)]), [], ['Месяц', 'Пришло', 'Оплачено', 'Возвраты'],
        ...months.map((m) => [m.m, Number(m.in), Number(m.pay), Number(m.ret)]), [], ['Больше всего ждут', 'Накладных', 'Сумма', 'С даты'],
        ...topRows.map((x) => [x.r?.full_name || '', Number(x.n), Number(x.sum), x.since])];
      A.toExcel(`Сводка ${A.fmtDate(A.today())}`, ['Показатель', 'Кол-во', 'Сумма', ''], rows, [30, 14, 16, 12]);
    });
  }
  // =====================================================================
  // СЕГОДНЯ и КАЛЕНДАРЬ
  // =====================================================================
  const QI = {
    order: SVG('M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6V5Z'),
    pay: SVG('M3 6h18a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1Zm1 2v8h16V8H4Zm8 1.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5Z'),
    call: SVG('M6.6 10.8a15 15 0 0 0 6.6 6.6l2.2-2.2a1 1 0 0 1 1-.25 11.4 11.4 0 0 0 3.6.57 1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.25.2 2.46.57 3.6a1 1 0 0 1-.25 1l-2.2 2.2Z'),
    cal: SVG('M7 2h2v2h6V2h2v2h2a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2V2ZM5 9v10h14V9H5Z'),
    doc: SVG('M6 2h8l6 6v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Zm7 1.5V9h5.5L13 3.5ZM8 13h8v2H8v-2Zm0 4h8v2H8v-2Z'),
    upload: SVG('M11 16V7.8l-3.6 3.6L6 10l6-6 6 6-1.4 1.4L13 7.8V16h-2Zm-7 2h16v2H4v-2Z'),
    xls: SVG('M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Zm0 2v4h6V5H5Zm8 0v4h6V5h-6Zm-8 6v8h6v-8H5Zm8 0v8h6v-8h-6Z'),
  };
  const lateOrders = () => st.orders.filter((o) => o.status === 'ordered' && o.expected_date && o.expected_date < A.today());
  const ordersOn = (d) => st.orders.filter((o) => o.status === 'ordered' && o.expected_date === d);
  const duePayouts = () => (isAdmin() ? st.payouts.filter((p) => p.status !== 'paid' && p.payout_date <= A.today()) : []);
  const payoutsOn = (d) => (isAdmin() ? st.payouts.filter((p) => p.payout_date === d) : []);
  function badgeCount() { return st.me ? lateOrders().length + ordersOn(A.today()).length + duePayouts().length : 0; }
  const weekday = (d) => { const x = new Date(d + 'T12:00:00').toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' }); return x[0].toUpperCase() + x.slice(1); };

  function renderToday() {
    frame('Сегодня', [['today', 'Список'], ['cal', 'Календарь']], 'today', isAdmin() ? 'Имя, № накладной, сумма' : 'Имя, № заказа, сумма');
    render.body = () => ((st.q.today || '').trim() ? renderTodaySearch() : st.seg.today === 'cal' ? renderCalendar() : renderTodayBody());
    render.body();
  }
  // Один поиск на «Сегодня»: поставщики, записи на выплату, заказы и накладные 1С
  function renderTodaySearch() {
    const q = st.q.today.trim(), w = waitingMap();
    const reps = A.rank(q, st.reps.filter((r) => r.active), repFields).slice(0, 8);
    const pays = isAdmin() ? st.payouts.filter((p) => { const r = repById(p.rep_id);
      return A.matches(q, r?.full_name, r?.company, p.invoice_no, p.basis, p.comment, p.amount, A.fmtMoney(p.amount), A.fmtDate(p.payout_date)); }).slice(0, 15) : [];
    const ords = st.orders.filter((o) => { const r = repById(o.rep_id);
      return A.matches(q, r?.full_name, r?.company, o.order_no, o.comment, o.amount, A.fmtMoney(o.amount), A.fmtDate(o.order_date)); }).slice(0, 15);
    let html = '';
    if (reps.length) html += `<div class="section-h"><span>Поставщики</span></div><div class="list">${reps.map((r) => repCell(r, false, w)).join('')}</div>`;
    if (pays.length) html += `<div class="section-h"><span>Записи на выплату</span></div><div class="list">${pays.map((p) => payoutCell(p)).join('')}</div>`;
    if (ords.length) html += `<div class="section-h"><span>Заказы</span></div><div class="list">${ords.map(orderCell).join('')}</div>`;
    const local = reps.length + pays.length + ords.length;
    if (isAdmin()) html += '<div id="inv-found"></div>';
    else if (!local) html = A.emptyState('Ничего не найдено', 'Измените запрос');
    setBody(html); bindCells($('body'));
    $('body').querySelectorAll('[data-rep]').forEach((c) => c.addEventListener('click', () => repDetail(c.dataset.rep)));
    if (isAdmin()) findInvoices(q, local);
  }
  function quickActions() {
    const b = (k, ic, l) => `<button class="qbtn" data-q="${k}"><span class="qi">${QI[ic]}</span><span>${l}</span></button>`;
    const list = isAdmin() ? [b('order', 'order', 'Заказ'), b('payout', 'pay', 'Выплата'), b('debt', 'doc', 'Долг 1С'), b('import', 'upload', 'Загрузить')]
      : [b('order', 'order', 'Заказ'), b('cal', 'cal', 'Календарь')];
    return `<div class="quick" style="--qn:${list.length}">${list.join('')}</div>`;
  }
  function bindQuick(root) {
    root.querySelectorAll('[data-q]').forEach((b) => b.addEventListener('click', () => {
      const q = b.dataset.q;
      if (q === 'order') orderForm(); else if (q === 'payout') payoutForm(); else if (q === 'debt') debtSheet('all');
      else if (q === 'import') import1C(); else if (q === 'cal') { st.seg.today = 'cal'; render(); }
    }));
  }
  // «Чек дня»: главное за день одной полосой, как кассовая лента; строка ведёт к своему разделу
  function daySlip({ today, dueToday, tomO, tomP, late, dueLate }) {
    const row = (k, label, v, n, cls = '') => `<button type="button" class="slip-row ${cls} ${v ? '' : 'zero'}" data-go="${k}">
      <span class="k">${E(label)}</span><span class="lead"></span>${n ? `<span class="n">${E(n)}</span>` : ''}<span class="v">${v ? A.fmtMoney(v) : '—'}</span></button>`;
    const cnt = (a, one, few, many) => { const n = a.length; if (!n) return ''; const m10 = n % 10, m100 = n % 100;
      return `${n} ${m10 === 1 && m100 !== 11 ? one : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? few : many}`; };
    const zak = (a) => cnt(a, 'заказ', 'заказа', 'заказов'), zap = (a) => cnt(a, 'запись', 'записи', 'записей');
    let rows = row('s-in', 'Придут сегодня', A.sum(today), zak(today));
    if (isAdmin()) rows += row('s-pay', 'Выплатить сегодня', A.sum(dueToday), zap(dueToday));
    rows += row('s-tom', 'Завтра', A.sum(tomO) + (isAdmin() ? A.sum(tomP) : 0), [zak(tomO), isAdmin() ? zap(tomP) : ''].filter(Boolean).join(', '));
    const lateSum = A.sum(late) + A.sum(dueLate);
    rows += row('s-late', 'Просрочено', lateSum, [zak(late), zap(dueLate)].filter(Boolean).join(', '), lateSum ? 'red' : '');
    const o = isAdmin() ? st.open1c || st.unrec : null;
    if (o?.n) rows += `<div class="slip-total">${row('debt', 'Долг по 1С', o.sum, `${Number(o.n).toLocaleString('ru-RU')} накл.`)}</div>`;
    return `<div class="slip"><div class="slip-head"><b>${E(weekday(A.today()))}</b><span>${E(st.me.full_name || '')}</span></div>${rows}</div>`;
  }
  function renderTodayBody() {
    const t = A.today(), t1 = A.addDays(t, 1);
    const late = lateOrders(), today = ordersOn(t), due = duePayouts().sort((a, b) => a.payout_date.localeCompare(b.payout_date));
    const tomO = ordersOn(t1), tomP = payoutsOn(t1).filter((p) => p.status !== 'paid');
    const sec = (title, items, cells, cls = '', id = '') => (items.length ? `<div class="section-h ${cls}" ${id ? `id="${id}"` : ''}><span>${E(title)}</span><span>${A.fmtMoney(A.sum(items))}</span></div><div class="list">${cells}</div>` : '');
    // сначала сегодня, потом завтра, просроченное — в конце
    const dueToday = due.filter((p) => p.payout_date === t), dueLate = due.filter((p) => p.payout_date < t);
    let html = daySlip({ today, dueToday, tomO, tomP, late, dueLate }) + quickActions();
    const oc = orderCell, pcell = (x, c) => payoutCell(x, [x.payout_date < t ? 'было на ' + A.fmtShort(x.payout_date) : '', payNote(x), c ? '' : repById(x.rep_id)?.company].filter(Boolean).join(' · ') || 'выплата', '', c);
    html += sec(`Придут сегодня · ${today.length}`, today, treeList(today, oc), 'today', 's-in');
    html += sec(`Выплатить сегодня · ${dueToday.length}`, dueToday, treeList(dueToday, pcell), 'today', 's-pay');
    if (!today.length && !dueToday.length && !late.length && !dueLate.length) {
      html += `<div class="empty"><div class="done-mark">✓</div><div class="big">На сегодня всё</div>Просроченных заказов${isAdmin() ? ' и выплат' : ''} нет</div>`;
    }
    html += sec(`Завтра придут · ${tomO.length}`, tomO, treeList(tomO, oc), '', 's-tom');
    html += sec(`Завтра выплатить · ${tomP.length}`, tomP, treeList(tomP, pcell), '', tomO.length ? '' : 's-tom');
    if (late.length || dueLate.length) html += '<div class="past-sep red" id="s-late"><span>Просрочено</span></div>';
    html += sec(`Заказы не пришли · ${late.length}`, late, treeList(late, oc), 'red');
    html += sec(`Выплаты не сделаны · ${dueLate.length}`, dueLate, treeList(dueLate, pcell), 'red');
    setBody(html); bindCells($('body')); bindQuick($('body'));
    $('body').querySelector('.slip')?.addEventListener('click', (e) => {
      const k = e.target.closest('[data-go]')?.dataset.go; if (!k) return;
      A.haptic();
      if (k === 'debt') return debtSheet('all');
      const el = $(k);
      if (el) window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 60, behavior: 'smooth' });
      else if (k === 's-tom') { st.seg.today = 'cal'; const d1 = A.addDays(A.today(), 1); st.cal = { ym: d1.slice(0, 7), day: d1 }; render(); }
    });
  }

  // Неоплаченные в 1С накладные без записи на выплату — по поставщикам
  // Долг по накладным: всё, что в 1С не закрыто расходником. Фильтр «без записи», вид «по поставщикам» / «по накладным».
  const unrecSheet = () => debtSheet('norec');
  async function debtSheet(start = 'all') {
    const api = A.sheet({ title: 'Не оплачено в 1С', left: 'Закрыть', body: '<div style="margin-top:12px">' + A.skeleton(8) + '</div>' });
    const { data, error } = await sb.rpc('open_invoices');
    if (!api.el.isConnected) return;
    if (error) { api.body.innerHTML = A.emptyState('Не удалось загрузить', humanError(error)); return; }
    const t = A.today();
    const days = (d) => Math.max(0, Math.round((new Date(t + 'T12:00:00') - new Date(d.at.slice(0, 10) + 'T12:00:00')) / 864e5));
    const money = (rows) => rows.reduce((a, d) => a + A.toCents(d.open), 0) / 100;
    let flt = start, view = 'reps', q = '', limit = 150;
    const draw = () => {
      const rows = data.filter((d) => flt === 'all' || !d.rec);
      const norec = data.filter((d) => !d.rec);
      api.body.querySelector('#dseg').innerHTML = [['all', `Все · ${data.length}`], ['norec', `Без записи · ${norec.length}`]]
        .map(([k, l]) => `<button data-f="${k}" class="${flt === k ? 'on' : ''}">${l}</button>`).join('');
      api.body.querySelector('#dview').innerHTML = [['reps', 'По поставщикам'], ['docs', 'По накладным']]
        .map(([k, l]) => `<button data-v="${k}" class="${view === k ? 'on' : ''}">${l}</button>`).join('');
      api.body.querySelector('#dsum').innerHTML = `<div class="stat" style="cursor:default"><div class="k"><span class="dot" style="background:var(--orange)"></span>Накладных · ${rows.length}</div>
          <div class="v">${A.fmtMoney(money(rows))}</div></div>
        <div class="stat" style="cursor:default"><div class="k"><span class="dot" style="background:var(--red)"></span>Дольше 30 дней</div>
          <div class="v">${A.fmtMoney(money(rows.filter((d) => days(d) > 30)))}</div></div>`;
      let html = '';
      if (view === 'reps') {
        const groups = [...A.groupBy(rows, (d) => d.rep_id).entries()].map(([rid, items]) => ({ rid, items, sum: money(items), first: items[0] }))
          .sort((a, b) => b.sum - a.sum);
        const list = q ? A.rank(q, groups, (g) => { const r = repById(g.rid); return [r?.full_name, r?.company]; }) : groups;
        // ИП с несколькими должниками-торговыми — веткой с общей суммой
        const supRow = (g, child) => {
          const r = repById(g.rid), dd = days(g.first);
          return `<button class="cell ${child ? 'child' : ''}" data-rep="${g.rid}"><div class="main"><div class="t"><b>${E(r?.full_name || '—')}</b></div>
            <div class="s">${E([`${g.items.length} накл.`, `с ${A.fmtShort(g.first.at.slice(0, 10))}`].join(' · '))} · <span class="${A.ageCls(dd)}">${dd} дн.</span>${child || !r?.company ? '' : ' · ' + E(r.company)}</div></div>
            <div class="r"><div class="amt">${A.fmtMoney(g.sum)}</div></div></button>`;
        };
        const items = list.slice(0, limit).map((g) => ({ rep_id: g.rid, amount: g.sum, g }));
        html = list.length ? `<div class="list">${q ? items.map((x) => supRow(x.g, false)).join('') : treeList(items, (x, c) => supRow(x.g, c), true)}</div>` : A.emptyState('Ничего не найдено');
        if (list.length > limit) html += '<button class="btn plain" type="button" data-more>Показать ещё</button>';
      } else {
        const list = q ? A.rank(q, rows, (d) => { const r = repById(d.rep_id); return [r?.full_name, r?.company, d.in_no, d.open]; }) : rows;
        html = list.length ? `<div class="list">${list.slice(0, limit).map((d) => {
          const r = repById(d.rep_id), dd = days(d);
          return `<button class="cell" data-rep="${d.rep_id}"><div class="main"><div class="t"><b>${E(r?.full_name || '—')}</b></div>
            <div class="s">${E([A.docNo({ ...d, kind: 'in' }), A.fmtShort(d.at.slice(0, 10))].join(' · '))} · <span class="${A.ageCls(dd)}">${dd} дн.</span></div></div>
            <div class="r"><div class="amt">${A.fmtMoney(d.open)}</div>${A.pill(d.rec ? A.payView(d.rec) : { label: 'Нет записи', c: 'orange' })}</div></button>`;
        }).join('')}</div>` : A.emptyState('Ничего не найдено');
        if (list.length > limit) html += '<button class="btn plain" type="button" data-more>Показать ещё</button>';
      }
      api.body.querySelector('#dl').innerHTML = html;
    };
    api.body.innerHTML = `<div class="footer-note" style="margin:8px 4px 10px">Приходные накладные, на которые в 1С нет расходника (оплаты).
        Оплаты с «Документом основанием» закрывают свою накладную, остальные — самые старые.</div>
      <div class="segmented" id="dseg"></div><div class="stats" id="dsum"></div><div class="segmented" id="dview"></div>
      ${A.searchBox('dq', 'Поставщик, № накладной, сумма')}<div id="dl"></div>
      <button class="btn plain" type="button" data-xls>Выгрузить в Excel</button>`;
    draw();
    A.bindSearch(api.body.querySelector('#dq'), () => { q = api.body.querySelector('#dq').value; limit = 150; draw(); });
    api.body.addEventListener('click', (e) => {
      const f = e.target.closest('[data-f]'); if (f) { flt = f.dataset.f; limit = 150; A.haptic(); draw(); return; }
      const v = e.target.closest('[data-v]'); if (v) { view = v.dataset.v; limit = 150; A.haptic(); draw(); return; }
      if (e.target.closest('[data-more]')) { limit += 300; draw(); return; }
      if (e.target.closest('[data-xls]')) {
        const rows = data.filter((d) => flt === 'all' || !d.rec);
        return A.toExcel(`Долг по 1С ${A.fmtDate(t)}`, ['Поставщик', 'ИП / компания', '№ накладной', 'Дата', 'Дней', 'Не оплачено', 'Запись'],
          rows.map((d) => { const r = repById(d.rep_id); return [r?.full_name || '', r?.company || '', d.in_no || '', d.at.slice(0, 10), days(d), Number(d.open), d.rec ? A.payView(d.rec).label : 'Нет']; }),
          [28, 24, 14, 11, 7, 13, 10]);
      }
      const c = e.target.closest('[data-rep]'); if (c) repDetail(c.dataset.rep, 'docs');
    });
  }

  function renderCalendar() {
    const t = A.today();
    st.cal = st.cal || { ym: t.slice(0, 7), day: t };
    const [y, m] = st.cal.ym.split('-').map(Number);
    const offset = (new Date(y, m - 1, 1).getDay() + 6) % 7, dim = new Date(y, m, 0).getDate();
    const cells = Math.ceil((offset + dim) / 7) * 7;
    let grid = '';
    for (let i = 0; i < cells; i++) {
      const n = i - offset + 1;
      if (n < 1 || n > dim) { grid += '<div class="cal-day empty"></div>'; continue; }
      const d = `${st.cal.ym}-${String(n).padStart(2, '0')}`;
      const o = st.orders.filter((x) => x.expected_date === d && x.status !== 'cancelled');
      const p = payoutsOn(d);
      const dots = [
        o.some((x) => x.status === 'ordered') && `<i style="background:var(--${d < t ? 'red' : 'blue'})"></i>`,
        (o.some((x) => x.status === 'delivered') || p.some((x) => x.status === 'paid')) && '<i style="background:var(--green)"></i>',
        p.some((x) => x.status !== 'paid') && `<i style="background:var(--${d < t ? 'red' : 'gray'})"></i>`,
      ].filter(Boolean).join('');
      grid += `<button class="cal-day ${d === t ? 'today' : ''} ${d === st.cal.day ? 'sel' : ''}" data-d="${d}"><span>${n}</span><b>${dots}</b></button>`;
    }
    const d = st.cal.day;
    const dayOrders = st.orders.filter((x) => x.expected_date === d && x.status !== 'cancelled');
    const dayPays = payoutsOn(d);
    let list = '';
    if (dayOrders.length) list += `<div class="section-h"><span>Заказы · ${dayOrders.length}</span><span>${A.fmtMoney(A.sum(dayOrders))}</span></div><div class="list">${treeList(dayOrders, orderCell)}</div>`;
    if (dayPays.length) list += `<div class="section-h"><span>Выплаты · ${dayPays.length}</span><span>${A.fmtMoney(A.sum(dayPays))}</span></div><div class="list">${treeList(dayPays, (x, c) => payoutCell(x, [c ? '' : repById(x.rep_id)?.company, payNote(x)].filter(Boolean).join(' · ') || A.payView(x.status).label, '', c))}</div>`;
    if (!list) list = `<div class="empty" style="padding:28px 16px">${d >= t ? 'На этот день ничего нет' : 'В этот день ничего не было'}</div>`;
    setBody(`<div class="cal list">
        <div class="cal-head"><button class="nav-btn" data-m="-1" aria-label="Предыдущий месяц">‹</button>
          <b>${E(A.fmtMonth(st.cal.ym))}</b>
          <button class="nav-btn right" data-m="1" aria-label="Следующий месяц">›</button></div>
        <div class="cal-grid wd">${['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].map((x) => `<div>${x}</div>`).join('')}</div>
        <div class="cal-grid">${grid}</div>
        <div class="cal-legend"><span><i style="background:var(--blue)"></i>придёт заказ</span>${isAdmin() ? '<span><i style="background:var(--gray)"></i>выплата</span>' : ''}<span><i style="background:var(--green)"></i>готово</span><span><i style="background:var(--red)"></i>просрочено</span></div>
      </div>
      <div class="section-h" style="margin-top:20px"><span>${E(weekday(d))}</span>${d !== t ? '<button class="link-btn" data-m="0">Сегодня</button>' : ''}</div>${list}`);
    $('body').querySelectorAll('[data-d]').forEach((b) => b.addEventListener('click', () => { A.haptic(); st.cal.day = b.dataset.d; renderCalendar(); }));
    A.swipeX($('body').querySelector('.cal'), () => $('body').querySelector('[data-m="1"]').click(), () => $('body').querySelector('[data-m="-1"]').click());
    $('body').querySelectorAll('[data-m]').forEach((b) => b.addEventListener('click', () => {
      const k = +b.dataset.m;
      if (!k) { st.cal = { ym: t.slice(0, 7), day: t }; return renderCalendar(); }
      const nd = new Date(y, m - 1 + k, 1); st.cal.ym = `${nd.getFullYear()}-${String(nd.getMonth() + 1).padStart(2, '0')}`;
      st.cal.day = st.cal.ym === t.slice(0, 7) ? t : `${st.cal.ym}-01`; renderCalendar();
    }));
    bindCells($('body'));
  }

  // =====================================================================
  // ИСТОРИЯ ИЗМЕНЕНИЙ
  // =====================================================================
  const FIELD = { amount: 'сумма', expected_date: 'приход', order_date: 'дата заказа', order_no: '№', comment: 'комментарий', status: 'статус',
    payout_date: 'дата выплаты', basis: 'основание', invoice_no: '№ накладной', received_at: 'получено представителем', inc: 'приход', dec: 'расход', deleted: 'удалён в 1С', kontr: 'контрагент', full_name: 'ФИО', company: 'компания', phone: 'телефон', active: 'доступ',
    store_id: 'магазин', rep_id: 'представитель', name: 'название', address: 'адрес', ext_key: 'ключ 1С' };
  function fmtVal(k, v) {
    if (v == null || v === '') return '—';
    if (k === 'amount' || k === 'inc' || k === 'dec') return A.fmtMoney(v);
    if (k === 'deleted') return v ? 'да' : 'нет';
    if (/date$/.test(k)) return A.fmtShort(v);
    if (/_at$/.test(k)) return A.fmtDate(v);
    if (k === 'status') return A.ORD[v]?.label || A.payView(v).label;
    if (k === 'active') return v ? 'включён' : 'отключён';
    if (k === 'rep_id') return repById(v)?.full_name || '—';
    if (k === 'store_id') return storeById(v)?.name || '—';
    return String(v);
  }
  // Одна строка истории: кто → что сделал → с чем
  function histText(e) {
    const d = e.data || {}, ch = e.changes || {};
    const who = staffName(e.user_id) || (e.user_id ? 'Сотрудник' : e.changes?.received_at ? 'Представитель' : 'Система');
    const repName = repById(e.rep_id)?.full_name || d.full_name || '';
    const subj = e.entity === 'orders' ? `заказ ${repName ? '«' + repName + '», ' : ''}${A.fmtMoney(d.amount)}`
      : e.entity === 'payouts' ? `выплату ${repName ? '«' + repName + '», ' : ''}${A.fmtMoney(d.amount)}`
      : e.entity === 'reps' ? `представителя «${d.full_name || ''}»` : e.entity === 'stores' ? `магазин «${d.name || ''}»`
      : e.entity === 'docs' ? `${(d.title || 'документ').toLowerCase()} ${d.in_no ? '№ ' + d.in_no : 'от ' + A.fmtDate(String(d.doc_at || '').slice(0, 10))}${d.kontr ? ' («' + d.kontr + '»)' : ''}` : '';
    let what;
    if (e.action === 'import') what = d.kind === 'docs' ? `загрузил документы 1С${(d.files || []).length ? ': ' + d.files.map((f) => f.kind).join(', ') : ''}${d.deleted ? ', удалено в 1С ' + d.deleted : ''}`
      : `загрузил справочник из 1С: новых ${d.added}, изменено ${d.updated}${d.deactivated ? ', отключено ' + d.deactivated : ''}`;
    else if (e.action === 'purge') what = `удалил документы 1С (${(d.kinds || []).map((k) => (KIND1C.find((x) => x[0] === k) || [k, k])[1].toLowerCase()).join(', ')}) за ${A.fmtDate(d.from)} – ${A.fmtDate(d.to)}: ${Number(d.n || 0).toLocaleString('ru-RU')} шт. на ${A.fmtMoney(d.sum)}`;
    else if (e.action === 'insert') what = (e.entity === 'orders' ? 'записал ' : 'добавил ') + subj;
    else if (e.action === 'delete') what = 'удалил ' + subj;
    else if (ch.status && Object.keys(ch).length === 1) {
      const nv = ch.status[1];
      what = e.entity === 'orders' ? (nv === 'delivered' ? `отметил: пришёл ${subj}` : nv === 'cancelled' ? `отменил ${subj}` : `вернул в ожидание ${subj}`)
        : `${subj}: ${fmtVal('status', ch.status[0])} → ${fmtVal('status', nv)}`;
    } else if (ch.active && Object.keys(ch).length === 1) what = `${ch.active[1] ? 'включил' : 'отключил'} доступ: ${repName}`;
    else what = `изменил ${subj}: ` + Object.entries(ch).map(([k, [a, b]]) => `${FIELD[k] || k} ${fmtVal(k, a)} → ${fmtVal(k, b)}`).join(', ');
    return { who, what };
  }
  const HIST_ICON = { insert: ['＋', 'blue'], update: ['✎', 'gray'], delete: ['✕', 'red'], import: ['⇣', 'green'] };
  function histCells(rows) {
    return rows.map((e) => {
      const { who, what } = histText(e); const [ic, c] = HIST_ICON[e.action] || ['•', 'gray'];
      const time = new Date(e.at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
      return `<div class="cell static"><div class="hist-ic c-${c}">${ic}</div><div class="main"><div class="t wrap"><b>${E(who)}</b> ${E(what)}</div>
        <div class="s">${time}</div></div></div>`;
    }).join('');
  }
  function histGrouped(rows) {
    let html = '';
    for (const [day, items] of A.groupBy(rows, (e) => new Date(e.at).toLocaleDateString('sv-SE'))) {
      const t = A.today(); const label = day === t ? 'Сегодня' : day === A.addDays(t, -1) ? 'Вчера' : weekday(day);
      html += `<div class="section-h"><span>${E(label)}</span></div><div class="list">${histCells(items)}</div>`;
    }
    return html || A.emptyState('Изменений пока нет');
  }
  async function loadHistory(filter, box, limit = 100) {
    // 'fill' — старые отметки «пустое поле заполнено из 1С»: не изменения, не показываем
    let q = sb.from('audit_log').select('*').neq('action', 'fill').order('at', { ascending: false }).limit(limit);
    for (const [k, v] of Object.entries(filter)) q = Array.isArray(v) ? q.in(k, v) : q.eq(k, v);
    const { data, error } = await q;
    if (!box.isConnected) return;
    if (error) { box.innerHTML = A.emptyState('Не удалось загрузить историю'); return; }
    box.innerHTML = filter.entity_id ? (data.length ? `<div class="list">${histCells(data.slice().reverse())}</div>` : '') : histGrouped(data);
  }
  function historySheet() {
    const api = A.sheet({ title: 'История изменений', left: 'Закрыть', body: `
      <div class="segmented" id="hseg" style="margin-top:8px"><button data-k="all" class="on">Все</button><button data-k="orders">Заказы</button><button data-k="payouts">Выплаты</button><button data-k="reps">Справочник</button><button data-k="docs">1С</button></div>
      <div id="hbox">${A.skeleton(8, true)}</div>` });
    const box = api.body.querySelector('#hbox');
    const show = (k) => {
      api.body.querySelectorAll('#hseg button').forEach((b) => b.classList.toggle('on', b.dataset.k === k));
      box.innerHTML = A.skeleton(8, true);
      loadHistory(k === 'all' ? {} : { entity: k === 'reps' ? ['reps', 'stores', 'import'] : k }, box, 300);
    };
    api.body.querySelector('#hseg').addEventListener('click', (e) => { const k = e.target.closest('button')?.dataset.k; if (k) show(k); });
    show('all');
  }

  // Напоминание: событие в календаре телефона на 9:00 нужного дня
  function ics(title, date, desc) {
    const d = date.replace(/-/g, ''), stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
    const esc = (x) => String(x).replace(/[\\,;]/g, (c) => '\\' + c).replace(/\n/g, '\\n');
    const body = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Sverka//RU', 'BEGIN:VEVENT', `UID:${uuid()}@sverka`, `DTSTAMP:${stamp}`,
      `DTSTART:${d}T090000`, `DTEND:${d}T091500`, `SUMMARY:${esc(title)}`, `DESCRIPTION:${esc(desc)}`, `URL:${location.href.split('#')[0]}`,
      'BEGIN:VALARM', 'TRIGGER:-PT0M', 'ACTION:DISPLAY', `DESCRIPTION:${esc(title)}`, 'END:VALARM', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([body], { type: 'text/calendar' })); a.download = `napominanie-${date}.ics`;
    document.body.append(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    A.toast('Откройте файл — событие добавится в календарь с напоминанием в 9:00');
  }

  // ---------- общая ссылка: график записей на выплату для всех ТП ----------
  async function sharedLink(act) {
    if (act === 'reset' && !(await confirmAct('Старая общая ссылка перестанет работать. Выдать новую?'))) return;
    const { data: token, error } = await sb.rpc('shared_link_token', { p_reset: act === 'reset' });
    if (fail(error)) return;
    const base = new URL('list.html', location.href).href.split('#')[0];
    const url = base + '#' + token;
    // «Открыть» — с меткой from=app: на странице появится кнопка «Назад» в приложение.
    // Скопированная и отправленная в WhatsApp ссылка остаётся без метки: представителю возвращаться некуда.
    if (act === 'open') window.open(base + '?from=app#' + token, '_blank', 'noopener');
    else if (act === 'wa') window.open(`https://wa.me/?text=${encodeURIComponent('Записи на выплату: ' + url)}`, '_blank', 'noopener');
    else {
      try { await navigator.clipboard.writeText(url); A.toast(act === 'reset' ? 'Новая ссылка скопирована' : 'Ссылка скопирована'); }
      catch { window.prompt('Скопируйте ссылку', url); }
    }
  }

  // ---------- загрузка справочника представителей из 1С ----------
  const loadXLSX = () => A.loadXLSX();
  // Загрузка выгрузок 1С: справочник контрагентов + документы (несколько файлов за раз)
  const FILE_KIND = { kontr: 'Контрагенты', vzaimo: 'Взаиморасчёты с контрагентами' };
  function import1C() {
    const api = A.sheet({ title: 'Загрузка из 1С', left: 'Закрыть', body: `
      <div class="footer-note" style="margin:12px 4px">В 1С: список документов или справочника → «Ещё» → «Вывести список» → сохранить в Excel.
        Отчёт «Взаиморасчёты с контрагентами» — сохранить в Excel как есть. Можно выбрать несколько файлов сразу.</div>
      <input type="file" id="imp-file" accept=".xls,.xlsx" multiple class="hidden">
      <button class="btn blue" type="button" data-act="pick">Выбрать файлы</button>
      <div id="imp-preview"></div>` });
    const f = api.body, input = f.querySelector('#imp-file'), box = f.querySelector('#imp-preview');
    let parsed = [];
    const line = (k, v, c = '') => `<div class="cell static"><div class="main">${E(k)}</div><div class="value" ${c ? `style="color:var(--${c})"` : ''}>${E(v)}</div></div>`;
    const period = (sc) => (sc?.from ? `${A.fmtDate(sc.from)} – ${A.fmtDate(sc.to)}` : '');
    onActs(api, { pick: () => input.click(), run: () => run() });
    input.addEventListener('change', async () => {
      const files = [...input.files]; input.value = ''; if (!files.length) return;
      box.innerHTML = '<div class="spinner" style="margin:24px auto"></div>';
      parsed = [];
      try {
        await loadXLSX();
        for (const file of files) {
          const wb = window.XLSX.read(await file.arrayBuffer(), { type: 'array' });
          const ws = wb.Sheets[wb.SheetNames[0]];
          const raw = window.XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, raw: true });
          const p = window.Doc1C.parse(raw); p.name = file.name;
          if (p.info.kind === 'kontr') {
            p.reps = window.RepImport.parseRows(window.XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false }));
            p.diff = window.RepImport.diff(p.reps, st.reps);
          }
          parsed.push(p);
        }
      } catch (e) { box.innerHTML = ''; return A.toast(e.message || 'Не удалось прочитать файл', true); }
      const ok = parsed.filter((p) => p.info.kind);
      box.innerHTML = parsed.map((p) => {
        if (p.info.kind === 'kontr') return `<div class="section-h"><span>${E(p.name)}</span></div><div class="list">${line('Вид', 'Контрагенты')}
          ${line('В файле', p.reps.length)}${line('Новых', p.diff.added.length)}${line('Изменится', p.diff.updated.length)}</div>`;
        if (!p.info.kind) return `<div class="section-h"><span>${E(p.name)}</span></div><div class="list">${line('Не распознан', 'нужна выгрузка из 1С', 'red')}</div>`;
        const inc = p.rows.reduce((a, r) => a + A.toCents(r.inc), 0) / 100, dec = p.rows.reduce((a, r) => a + A.toCents(r.dec), 0) / 100;
        return `<div class="section-h"><span>${E(p.name)}</span></div><div class="list">${line('Вид', FILE_KIND[p.info.kind] || p.info.object)}
          ${line('Период', period(p.scope))}${line('Документов', p.rows.length.toLocaleString('ru-RU'))}
          ${inc ? line('Приход', A.fmtMoney(inc)) : ''}${dec ? line('Оплаты и возвраты', A.fmtMoney(dec)) : ''}
          ${p.skipped ? line('Пропущено (не поставщикам)', p.skipped) : ''}</div>`;
      }).join('') + (ok.length ? `<div class="footer-note">Уже загруженные документы не задвоятся: изменения обновятся и попадут в историю.
          Ручные отметки («Пришёл», «Оплачено») не отменяются.</div><button class="btn blue" type="button" data-act="run">Загрузить</button>
          <div id="imp-progress" class="footer-note" style="text-align:center"></div>` : '');
      f.querySelector('[data-act=pick]').textContent = 'Выбрать другие файлы';
      f.querySelector('[data-act=pick]').className = 'btn plain';
    });
    async function run() {
      const prog = f.querySelector('#imp-progress'), say = (t) => { prog.textContent = t; };
      api.busy(true);
      const res = { added: 0, updated: 0, same: 0, reps_added: 0 }; let fin = null, repsRes = null;
      try {
        for (const p of parsed.filter((x) => x.info.kind === 'kontr')) {
          say('Справочник контрагентов…');
          const { data, error } = await sb.rpc('import_reps', { p_rows: p.reps, p_deactivate_missing: false }); if (error) throw error;
          repsRes = data;
        }
        const docFiles = parsed.filter((x) => x.info.kind === 'list' || x.info.kind === 'vzaimo');
        if (docFiles.length) {
          const groups = window.Doc1C.merge(docFiles), total = groups.reduce((a, g) => a + g.rows.length, 0);
          const imp = uuid(); let done = 0;
          for (const g of groups) {
            for (let i = 0; i < g.rows.length; i += 2000) {
              say(`Документы: ${done.toLocaleString('ru-RU')} из ${total.toLocaleString('ru-RU')}…`);
              const { data, error } = await sb.rpc('import_docs', { p_import: imp, p_fields: g.fields, p_rows: g.rows.slice(i, i + 2000) });
              if (error) throw error;
              for (const k of Object.keys(res)) res[k] += data[k] || 0;
              done += Math.min(2000, g.rows.length - i);
            }
          }
          say('Проверка удалённых в 1С…');
          const { data, error } = await sb.rpc('finish_import', { p_import: imp, p_scopes: docFiles.map((x) => x.scope).filter((x) => x.from),
            p_files: docFiles.map((x) => ({ name: x.name, kind: x.info.object, rows: x.rows.length })) });
          if (error) throw error;
          fin = { ...data, orders: 0, payouts_linked: 0, payouts_paid: 0 };
          // сверка пачками по 100 поставщиков — каждый запрос короткий
          const reps = data.reps || [];
          for (let i = 0; i < reps.length; i += 100) {
            say(`Сверка с заказами и записями: ${Math.min(i + 100, reps.length)} из ${reps.length} поставщиков…`);
            const r = await sb.rpc('reconcile', { p_reps: reps.slice(i, i + 100) }); if (r.error) throw r.error;
            for (const k of ['orders', 'payouts_linked', 'payouts_paid']) fin[k] += r.data[k] || 0;
          }
        }
      } catch (e) { api.busy(false); say(''); return A.toast(humanError(e), true); }
      await loadAll(); lastLoad = Date.now(); render();
      const n = (v) => Number(v || 0).toLocaleString('ru-RU');
      box.innerHTML = `<div class="section-h"><span>Готово</span></div><div class="list">
          ${repsRes ? line('Контрагентов добавлено / обновлено', `${n(repsRes.added)} / ${n(repsRes.updated)}`) : ''}
          ${fin ? line('Новых документов', n(res.added)) + line('Изменилось', n(res.updated)) + line('Без изменений', n(res.same))
            + (fin.deleted ? line('Удалены в 1С (помечены)', n(fin.deleted), 'red') : '')
            + (res.reps_added ? line('Новых поставщиков', n(res.reps_added)) : '')
            + line('Заказов отмечено «Пришёл»', n(fin.orders)) + line('Записей связано с накладными', n(fin.payouts_linked))
            + line('Записей отмечено «Оплачено» по 1С', n(fin.payouts_paid)) : ''}</div>
        ${fin?.not_deleted?.length ? `<div class="footer-note warn">Похоже, файл неполный (${E(fin.not_deleted.join('; '))}) — отсутствующие документы не помечены удалёнными.</div>` : ''}
        ${st.unrec?.n ? `<button class="btn plain" type="button" data-act="unrec">Накладные без записи · ${st.unrec.n}</button>` : ''}`;
      onActs(api, { unrec: () => unrecSheet() });
      f.querySelector('[data-act=pick]').classList.add('hidden');
      api.busy(false);
    }
  }
  function importReps() {
    const api = A.sheet({ title: 'Обновить из 1С', left: 'Закрыть', body: `
      <div class="footer-note" style="margin:12px 4px">В 1С: Справочник «Контрагенты» → «Ещё» → «Вывести список» → сохранить в Excel.
        Строки вида «ООО Компания ТП Иванов Иван» разделятся на компанию и представителя.</div>
      <input type="file" id="imp-file" accept=".xls,.xlsx,.csv" class="hidden">
      <button class="btn blue" type="button" data-act="pick">Выбрать файл</button>
      <div id="imp-preview"></div>` });
    const f = api.body, input = f.querySelector('#imp-file');
    let rows = null;
    onActs(api, {
      pick: () => input.click(),
      run: async () => {
        const off = f.querySelector('#imp-off')?.checked || false;
        api.busy(true);
        const { data, error } = await sb.rpc('import_reps', { p_rows: rows, p_deactivate_missing: off });
        if (error) { api.busy(false); return fail(error); }
        await loadAll(); lastLoad = Date.now();
        api.close(); render();
        A.toast(`Добавлено ${data.added}, обновлено ${data.updated}` + (data.deactivated ? `, отключено ${data.deactivated}` : ''));
      },
    });
    input.addEventListener('change', async () => {
      const file = input.files[0]; if (!file) return;
      const box = f.querySelector('#imp-preview');
      box.innerHTML = '<div class="spinner" style="margin:24px auto"></div>';
      try {
        await loadXLSX();
        const wb = window.XLSX.read(await file.arrayBuffer(), { type: 'array' });
        const aoa = window.XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '', raw: false });
        rows = window.RepImport.parseRows(aoa);
        if (!rows.length) throw new Error('В файле нет ни одного контрагента');
        const d = window.RepImport.diff(rows, st.reps);
        const line = (k, v) => `<div class="cell static"><div class="main">${E(k)}</div><div class="value">${v}</div></div>`;
        box.innerHTML = `<div class="section-h"><span>${E(file.name)}</span></div><div class="list">
            ${line('В файле', rows.length)}${line('Новых', d.added.length)}${line('Изменится', d.updated.length)}${line('Без изменений', d.same)}</div>
          ${d.added.length ? `<div class="section-h"><span>Новые, первые ${Math.min(5, d.added.length)}</span></div><div class="list">${d.added.slice(0, 5).map((r) =>
            `<div class="cell static"><div class="main"><div class="t">${E(r.full_name)}</div><div class="s">${E([r.company, r.phone].filter(Boolean).join(' · ') || '—')}</div></div></div>`).join('')}</div>` : ''}
          ${d.missing.length ? `<div class="list" style="margin-top:12px"><label class="field"><span style="width:auto;flex:1">Отключить тех, кого нет в файле (${d.missing.length})</span><input type="checkbox" id="imp-off"></label></div>
            <div class="footer-note">Их ссылки перестанут работать. Записи о заказах и выплатах сохранятся.</div>` : ''}
          <button class="btn blue" type="button" data-act="run" ${d.added.length || d.updated.length || d.missing.length ? '' : 'disabled'}>Обновить справочник</button>`;
        f.querySelector('[data-act=pick]').textContent = 'Выбрать другой файл';
        f.querySelector('[data-act=pick]').className = 'btn plain';
      } catch (e) { rows = null; box.innerHTML = ''; A.toast(e.message, true); }
      input.value = '';
    });
  }

  // Логин представителя: из имени латиницей (можно поправить)
  const LAT = { а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p',
    р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya' };
  const loginFrom = (name) => String(name || '').toLowerCase().split(/\s+/).slice(0, 2).join('.')
    .replace(/[а-яё]/g, (c) => LAT[c] ?? '').replace(/[^a-z0-9.]/g, '').replace(/\.+/g, '.').replace(/^\.|\.$/g, '').slice(0, 24) || 'tp';
  const genPass = () => Array.from(crypto.getRandomValues(new Uint8Array(4)), (b) => (b % 10)).join('') + Math.random().toString(36).slice(2, 6);
  function repAccountForm(r, onDone, ru = null) {
    const site = new URL('./', location.href).href;
    const api = A.sheet({ title: ru ? 'Новый пароль' : 'Вход для представителя', left: 'Отмена', right: { label: ru ? 'Сохранить' : 'Создать', onClick: (a) => save(a) }, body: `
      <div class="section-h"><span>${E(r.full_name)}</span></div><div class="list">
        ${field('Логин', `<input name="login" value="${E(ru ? ru.login : loginFrom(r.full_name))}" ${ru ? 'readonly' : ''} autocapitalize="none" spellcheck="false">`)}
        ${field('Пароль', `<input name="password" type="text" autocomplete="new-password" value="${genPass()}">`)}
      </div>
      <button class="btn plain" type="button" data-act="gen">Другой пароль</button>
      <div class="footer-note">Вход: ${E(site)} — логин и пароль. Представитель увидит только свои заказы, записи на выплату, накладные, оплаты, возвраты и долг. Пароль после сохранения не показывается — отправьте его сразу.</div>` });
    const f = api.body; const v = (n) => f.querySelector(`[name=${n}]`).value.trim();
    onActs(api, { gen: () => { f.querySelector('[name=password]').value = genPass(); } });
    async function save(a) {
      const login = v('login').toLowerCase(), password = v('password');
      if (!/^[a-z0-9._-]{3,32}$/.test(login)) return A.toast('Логин: 3–32 символа, латиница, цифры, . _ -', true);
      if (password.length < 6) return A.toast('Пароль не короче 6 символов', true);
      a.busy(true);
      try {
        if (ru) await staffCall({ action: 'rep_update', rep_id: r.id, password });
        else { const d = await staffCall({ action: 'rep_create', rep_id: r.id, login, password }); st.repUsers.push(d.rep_user); cacheSave(); }
      } catch (e) { a.busy(false); return A.toast(e.message, true); }
      a.close();
      const text = `${r.full_name}, ваш кабинет: ${site}\nЛогин: ${login}\nПароль: ${password}`;
      const phone = (r.phone || '').split(',')[0].replace(/\D/g, '').replace(/^8(?=\d{10}$)/, '7');
      const done = A.sheet({ title: 'Готово', right: { label: 'Закрыть', onClick: (x) => { x.close(); onDone?.(); } }, body: `
        <div class="list"><div class="cell static"><div class="main" style="white-space:pre-wrap">${E(text)}</div></div></div>
        ${btn('copy', 'Скопировать', 'blue')}${phone ? btn('wa', 'Отправить в WhatsApp') : ''}
        <div class="footer-note">Пароль больше не показывается. Забудет — нажмите «Сменить пароль».</div>` });
      onActs(done, {
        copy: async () => { try { await navigator.clipboard.writeText(text); A.toast('Скопировано'); } catch { window.prompt('Скопируйте', text); } },
        wa: () => window.open(`https://wa.me/${phone}?text=${encodeURIComponent(text)}`, '_blank', 'noopener'),
      });
    }
  }

  // ---------- 1С: удалить загруженные документы за период ----------
  const KIND1C = [['in', 'Приходы'], ['pay', 'Расходники (оплаты)'], ['ret', 'Возвраты'], ['other', 'Прочее']];
  function purge1C() {
    const t = A.today(), m0 = t.slice(0, 8) + '01';
    const sel = new Set();
    let stats = {}, seq = 0;
    const api = A.sheet({ title: 'Удалить из 1С', left: 'Отмена', body: `
      <div class="section-h"><span>Период документов</span></div><div class="list">
        ${field('С', `<input name="from" type="date" value="${m0}" max="${t}">`)}
        ${field('По', `<input name="to" type="date" value="${t}">`)}
      </div>
      <div class="section-h"><span>Что удалить</span></div><div class="list" id="pk"></div>
      <div id="pmsg"></div>
      <button class="btn red" type="button" data-act="go" disabled>Удалить</button>
      <div class="footer-note">Документы стираются из базы полностью. Записи на выплату и заказы останутся — у них снимется только связь с удалёнными накладными.
        Повторная загрузка того же файла вернёт документы.</div>` });
    const f = api.body, v = (n) => f.querySelector(`[name=${n}]`).value;
    const total = () => KIND1C.filter(([k]) => sel.has(k)).reduce((a, [k]) => ({ n: a.n + (stats[k]?.n || 0), sum: a.sum + Number(stats[k]?.sum || 0) }), { n: 0, sum: 0 });
    const draw = () => {
      f.querySelector('#pk').innerHTML = KIND1C.map(([k, l]) => `<button type="button" class="cell inv-pick ${sel.has(k) ? 'on' : ''}" data-k="${k}" ${stats[k]?.n ? '' : 'disabled'}>
        <span class="pick-ic"></span><div class="main"><div class="t">${l}</div><div class="s">${stats[k]?.n ? `${Number(stats[k].n).toLocaleString('ru-RU')} шт. · ${stats[k].reps} поставщ.` : 'нет за период'}</div></div>
        <div class="r"><div class="amt">${stats[k]?.n ? A.fmtMoney(stats[k].sum) : ''}</div></div></button>`).join('');
      const tt = total(), go = f.querySelector('[data-act=go]');
      go.disabled = !tt.n; go.textContent = tt.n ? `Удалить ${tt.n.toLocaleString('ru-RU')} док. на ${A.fmtMoney(tt.sum)}` : 'Удалить';
    };
    const load = async () => {
      const my = ++seq, from = v('from'), to = v('to');
      if (!from || !to || to < from) { stats = {}; return draw(); }
      f.querySelector('#pk').innerHTML = '<div class="skel-row"><div class="sk-m"><i style="width:50%"></i><i style="width:30%"></i></div><i class="sk-r"></i></div>'.repeat(4);
      const { data, error } = await sb.rpc('docs_stats', { p_from: from, p_to: to });
      if (my !== seq) return;
      if (fail(error)) { stats = {}; return draw(); }
      stats = data || {}; for (const k of [...sel]) if (!stats[k]?.n) sel.delete(k);
      draw();
    };
    f.querySelectorAll('input[type=date]').forEach((i) => i.addEventListener('change', load));
    f.querySelector('#pk').addEventListener('click', (e) => {
      const b = e.target.closest('[data-k]'); if (!b || b.disabled) return;
      A.haptic(); sel.has(b.dataset.k) ? sel.delete(b.dataset.k) : sel.add(b.dataset.k); draw();
    });
    onActs(api, { go: async () => {
      const tt = total(), kinds = [...sel], from = v('from'), to = v('to');
      const names = KIND1C.filter(([k]) => sel.has(k)).map(([, l]) => l.toLowerCase()).join(', ');
      if (!tt.n || !(await confirmAct(`Удалить ${tt.n} док. (${names}) за ${A.fmtDate(from)} – ${A.fmtDate(to)}? Это необратимо.`))) return;
      api.busy(true);
      const msg = f.querySelector('#pmsg'), say = (x) => { msg.innerHTML = x ? `<div class="footer-note">${E(x)}</div>` : ''; };
      let done = 0, sum = 0; const reps = new Set();
      try {
        for (let guard = 0; guard < 100; guard++) {
          say(`Удаление: ${done.toLocaleString('ru-RU')} из ${tt.n.toLocaleString('ru-RU')}…`);
          const { data, error } = await sb.rpc('delete_docs', { p_from: from, p_to: to, p_kinds: kinds, p_done: done, p_done_sum: sum });
          if (error) throw error;
          done += data.deleted; sum += Number(data.sum || 0); (data.reps || []).forEach((x) => reps.add(x));
          if (!data.more) break;
        }
        const list = [...reps];
        for (let i = 0; i < list.length; i += 100) {
          say(`Пересчёт долгов: ${Math.min(i + 100, list.length)} из ${list.length} поставщиков…`);
          const r = await sb.rpc('reconcile', { p_reps: list.slice(i, i + 100) }); if (r.error) throw r.error;
        }
      } catch (e) {
        api.busy(false); say('');
        if (/delete_docs|function .* does not exist|PGRST202/i.test(e.message + (e.code || ''))) return A.toast('Удаление ещё не включено в базе — нужен шаг администратора базы', true);
        return A.toast(humanError(e) + (done ? ` (удалено ${done})` : ''), true);
      }
      await loadAll(); lastLoad = Date.now(); render();
      api.close(); A.toast(`Удалено документов: ${done.toLocaleString('ru-RU')}`);
    } });
    load();
  }

  async function staffCall(payload) {
    const { data, error } = await sb.functions.invoke('staff-admin', { body: payload });
    if (error) { let msg = error.message; try { msg = (await error.context.json()).error || msg; } catch {} throw new Error(msg); }
    return data;
  }
  function staffForm(s = null) {
    const self = s?.user_id === st.me.user_id;
    const api = A.sheet({ title: s ? 'Сотрудник' : 'Новый сотрудник', right: { label: 'Готово', onClick: (a) => save(a) }, body: `
      <div class="section-h"><span>Учётная запись</span></div><div class="list">
        ${field('Имя', `<input name="full_name" value="${E(s?.full_name || '')}" placeholder="Как подписывать записи">`)}
        ${field('Логин', `<input name="login" value="${E(s?.login || '')}" ${s ? 'readonly' : ''} autocapitalize="none" spellcheck="false" placeholder="латиница: ivan">`)}
        ${field(s ? 'Новый пароль' : 'Пароль', `<input name="password" type="text" autocomplete="new-password" placeholder="${s ? 'не менять' : 'не короче 6'}">`)}
        ${field('Роль', `<select name="role" ${self ? 'disabled' : ''}><option value="employee">Сотрудник</option><option value="admin" ${s?.role === 'admin' ? 'selected' : ''}>Администратор</option></select>`)}
      </div>
      ${!s ? `<button class="btn plain" type="button" data-act="gen">Сгенерировать пароль</button>` : ''}
      <button class="btn blue" type="button" data-act="save">${s ? 'Сохранить' : 'Создать'}</button>
      ${s && !self ? btn('toggle', s.active ? 'Отключить вход' : 'Включить вход', s.active ? 'red' : 'plain') + btn('remove', 'Удалить сотрудника', 'red') : ''}
      <div class="footer-note">Передайте сотруднику логин и пароль лично. Пароль после сохранения не показывается.</div>` });
    const f = api.body; const v = (n) => f.querySelector(`[name=${n}]`).value.trim();
    onActs(api, {
      save: () => save(api),
      gen: () => { f.querySelector('[name=password]').value = Array.from(crypto.getRandomValues(new Uint8Array(4)), (b) => (b % 10)).join('') + Math.random().toString(36).slice(2, 6); },
      remove: async () => {
        if (!(await confirmAct(`Удалить «${s.full_name}»? Его записи останутся, автор в них станет пустым.`))) return;
        api.busy(true);
        try { await staffCall({ action: 'delete', user_id: s.user_id }); st.staff = st.staff.filter((x) => x.user_id !== s.user_id); api.close(); A.toast('Сотрудник удалён'); render(); }
        catch (e) { api.busy(false); A.toast(e.message, true); }
      },
      toggle: async () => {
        api.busy(true);
        try { const d = await staffCall({ action: 'update', user_id: s.user_id, active: !s.active }); Object.assign(s, d.staff); api.close(); A.toast(s.active ? 'Вход включён' : 'Вход отключён'); render(); }
        catch (e) { api.busy(false); A.toast(e.message, true); }
      },
    });
    async function save(api) {
      api.busy(true);
      try {
        if (s) {
          const payload = { action: 'update', user_id: s.user_id, full_name: v('full_name') };
          if (!self) payload.role = v('role');
          if (v('password')) payload.password = v('password');
          const d = await staffCall(payload); if (d.staff) Object.assign(s, d.staff);
          if (self) st.me.full_name = s.full_name;
        } else {
          const d = await staffCall({ action: 'create', login: v('login'), full_name: v('full_name'), password: v('password'), role: v('role') });
          st.staff.push(d.staff); sortRu(st.staff, 'full_name');
        }
        api.close(); A.toast('Сохранено'); render();
      } catch (e) { api.busy(false); A.toast(e.message, true); }
    }
  }

  // ---------- автообновление: данные меняют несколько сотрудников с разных устройств ----------
  let lastLoad = 0, refreshing = false;
  async function refresh(force = false, byUser = false, quiet = false) {
    if (!st.me || refreshing || document.hidden) return;
    if (!force && Date.now() - lastLoad < 15000) return;
    if (document.querySelector('.sheet')) return;                       // открыта форма — не мешаем
    if (!byUser && document.activeElement?.matches('input, textarea, select')) return; // идёт ввод
    refreshing = true;
    const y = window.scrollY;
    try {
      if (await loadAll()) { lastLoad = Date.now(); if (st.me && !document.querySelector('.sheet')) { render(); window.scrollTo(0, y); } if (byUser) A.toast('Обновлено'); }
    } finally { refreshing = false; }
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
  window.addEventListener('focus', () => refresh());
  setInterval(() => refresh(true), 60000);

  // ---------- офлайн-оболочка ----------
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});

  // ---------- старт ----------
  sb.auth.onAuthStateChange((ev) => { if (ev === 'SIGNED_OUT' && st.me) { st.me = null; showLogin(); } });
  boot();
})();
