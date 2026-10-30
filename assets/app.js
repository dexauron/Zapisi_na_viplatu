// Приложение сотрудников магазина и администратора
(function () {
  const A = window.App;
  const sb = A.sb;
  const $ = (id) => document.getElementById(id);
  const E = A.esc;
  const STAFF_DOMAIN = 'staff.zapisi.app';

  const st = {
    me: null, tab: 'orders',
    reps: [], stores: [], orders: [], payouts: [], access: [], staff: [],
    seg: { orders: 'wait', payouts: 'all', dir: 'reps' }, q: { orders: '', payouts: '', dir: '' },
  };
  const isAdmin = () => st.me?.role === 'admin';

  const SVG = (d) => `<svg viewBox="0 0 24 24"><path d="${d}"/></svg>`;
  const TABS = [
    { id: 'orders', label: 'Заказы', icon: SVG('M7 4h10l1 3h3v2h-1.3l-1.6 10.2A2 2 0 0 1 16.1 21H7.9a2 2 0 0 1-2-1.8L4.3 9H3V7h3l1-3Zm-.7 5 1.6 10h8.2l1.6-10H6.3ZM8.4 6l-.3 1h7.8l-.3-1H8.4Z') },
    { id: 'payouts', label: 'Выплаты', admin: true, icon: SVG('M3 6h18a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1Zm1 2v8h16V8H4Zm8 1.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5ZM6 10h2v4H6v-4Zm10 0h2v4h-2v-4Z') },
    { id: 'dir', label: 'Справочник', icon: SVG('M9 4a4 4 0 1 1 0 8 4 4 0 0 1 0-8Zm0 2a2 2 0 1 0 0 4 2 2 0 0 0 0-4Zm-7 14c0-3.3 3.1-5 7-5s7 1.7 7 5v1H2v-1Zm2.2-1h9.6c-.5-1.3-2.3-2-4.8-2s-4.3.7-4.8 2ZM16.5 5a3.5 3.5 0 0 1 0 7v-2a1.5 1.5 0 0 0 0-3V5Zm1.3 10c2.5.4 4.2 1.8 4.2 4v2h-3v-2c0-1.3-.6-2.4-1.2-3.1V15Z') },
    { id: 'more', label: 'Ещё', icon: SVG('M5 10a2 2 0 1 1 0 4 2 2 0 0 1 0-4Zm7 0a2 2 0 1 1 0 4 2 2 0 0 1 0-4Zm7 0a2 2 0 1 1 0 4 2 2 0 0 1 0-4Z') },
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
    const { error } = await sb.auth.signInWithPassword({ email, password: $('l-pass').value });
    b.disabled = false;
    if (fail(error)) return;
    boot();
  });

  async function boot() {
    $('boot').classList.remove('hidden');
    const { data: { session } } = await sb.auth.getSession();
    if (!session) return showLogin();
    const { data: me, error } = await sb.rpc('ensure_profile');
    if (error || !me || !me.active) {
      await sb.auth.signOut();
      A.toast(error ? humanError(error) : 'Нет доступа: учётная запись не активна', true);
      return showLogin();
    }
    st.me = me;
    if (!isAdmin() && st.tab === 'payouts') st.tab = 'orders';
    await loadAll(); lastLoad = Date.now();
    $('boot').classList.add('hidden');
    ['nav', 'page', 'tabbar'].forEach((id) => $(id).classList.remove('hidden'));
    $('login').classList.add('hidden');
    renderTabs(); render();
  }
  function showLogin() {
    $('boot').classList.add('hidden');
    ['nav', 'page', 'tabbar'].forEach((id) => $(id).classList.add('hidden'));
    $('login').classList.remove('hidden');
  }

  async function loadAll() {
    const q = [
      sb.from('reps').select('*'),
      sb.from('stores').select('*'),
      sb.from('orders').select('*').order('order_date', { ascending: false }).order('created_at', { ascending: false }),
      sb.from('staff').select('user_id, login, full_name, role, active'),
    ];
    if (isAdmin()) q.push(sb.from('payouts').select('*').order('payout_date', { ascending: false }).order('created_at', { ascending: false }),
      sb.from('rep_access').select('*'));
    const res = await Promise.all(q);
    for (const r of res) if (fail(r.error)) return;
    st.reps = sortRu(res[0].data, 'full_name'); st.stores = sortRu(res[1].data, 'name');
    st.orders = res[2].data; st.staff = sortRu(res[3].data, 'full_name');
    st.payouts = res[4]?.data || []; st.access = res[5]?.data || [];
  }
  const ordView = (o) => A.orderView({ status: o.status, expected: o.expected_date });

  // ---------- оболочка ----------
  function renderTabs() {
    $('tabs').innerHTML = TABS.filter((t) => !t.admin || isAdmin()).map((t) =>
      `<button data-tab="${t.id}" class="${st.tab === t.id ? 'on' : ''}">${t.icon}<span>${t.label}</span></button>`).join('');
  }
  $('tabs').addEventListener('click', (e) => {
    const t = e.target.closest('button')?.dataset.tab; if (!t) return;
    if (t === st.tab) { window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
    st.tab = t; renderTabs(); render(); window.scrollTo(0, 0);
  });
  A.navScroll($('nav'));
  $('nav-plus').addEventListener('click', () => {
    if (st.tab === 'orders') orderForm();
    else if (st.tab === 'payouts') payoutForm();
    else if (st.tab === 'dir') st.seg.dir === 'reps' ? repForm() : storeForm();
    else if (st.tab === 'more' && isAdmin()) staffForm();
  });

  function render() {
    const t = TABS.find((x) => x.id === st.tab);
    $('nav-title').textContent = t.label;
    $('nav-plus').style.visibility = st.tab === 'more' && !isAdmin() ? 'hidden' : 'visible';
    ({ orders: renderOrders, payouts: renderPayouts, dir: renderDir, more: renderMore })[st.tab]();
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

  // =====================================================================
  // ЗАКАЗЫ
  // =====================================================================
  function renderOrders() {
    const wait = st.orders.filter((o) => o.status === 'ordered');
    frame('Заказы', [['wait', `Ожидаются · ${wait.length}`], ['delivered', 'Пришли'], ['all', 'Все']], 'orders', 'Представитель, магазин, №, сумма');
    render.body = renderOrdersBody; renderOrdersBody();
  }
  function orderMatches(o) {
    const r = repById(o.rep_id), s = storeById(o.store_id);
    return A.matches(st.q.orders, r?.full_name, r?.company, s?.name, o.order_no, o.comment, o.amount, A.fmtMoney(o.amount), A.fmtDate(o.order_date), staffName(o.created_by));
  }
  function renderOrdersBody() {
    const seg = st.seg.orders;
    const segBtn = $('seg')?.querySelector('[data-k=wait]');
    if (segBtn) segBtn.textContent = `Ожидаются · ${st.orders.filter((o) => o.status === 'ordered').length}`;
    let rows = st.orders.filter(orderMatches);
    let html = '';
    if (seg === 'wait') {
      rows = rows.filter((o) => o.status === 'ordered')
        .sort((a, b) => (a.expected_date || '9999').localeCompare(b.expected_date || '9999'));
      const late = rows.filter((o) => ordView(o).key === 'late');
      html += `<div class="stats">
        <div class="stat" style="cursor:default"><div class="k"><span class="dot" style="background:var(--blue)"></span>Ожидается · ${rows.length}</div><div class="v">${A.fmtMoney(A.sum(rows))}</div></div>
        <div class="stat" style="cursor:default"><div class="k"><span class="dot" style="background:var(--red)"></span>Просрочено · ${late.length}</div><div class="v">${A.fmtMoney(A.sum(late))}</div></div></div>`;
      const t = A.today(), t1 = A.addDays(t, 1), t7 = A.addDays(t, 7);
      const bucket = (o) => !o.expected_date ? 'Без даты прихода' : o.expected_date < t ? 'Просрочено' : o.expected_date === t ? 'Сегодня'
        : o.expected_date === t1 ? 'Завтра' : o.expected_date <= t7 ? 'В ближайшие 7 дней' : 'Позже';
      const order = ['Просрочено', 'Сегодня', 'Завтра', 'В ближайшие 7 дней', 'Позже', 'Без даты прихода'];
      const groups = A.groupBy(rows, bucket);
      for (const g of order) if (groups.has(g)) html += section(g, groups.get(g), g === 'Просрочено');
    } else {
      if (seg === 'delivered') rows = rows.filter((o) => o.status === 'delivered');
      for (const [ym, items] of A.groupBy(rows, (o) => o.order_date.slice(0, 7))) html += section(A.fmtMonth(ym), items);
    }
    if (!rows.length) html += A.emptyState(st.q.orders ? 'Ничего не найдено' : seg === 'wait' ? 'Нет ожидаемых заказов' : 'Заказов нет',
      st.q.orders ? 'Измените запрос' : 'Нажмите «+», чтобы записать заказ');
    setBody(html);
    $('body').querySelectorAll('.cell[data-id]').forEach((c) => c.addEventListener('click', () => orderDetail(c.dataset.id)));
  }
  function section(title, items, red = false) {
    return `<div class="section-h ${red ? 'red' : ''}"><span>${E(title)}</span><span>${A.fmtMoney(A.sum(items))}</span></div>
      <div class="list">${items.map(orderCell).join('')}</div>`;
  }
  function orderCell(o) {
    const r = repById(o.rep_id), s = storeById(o.store_id), v = ordView(o);
    const when = o.status === 'delivered' ? `пришёл ${A.relDay(o.delivered_at?.slice(0, 10))}`
      : o.status === 'ordered' && o.expected_date ? `приход ${A.relDay(o.expected_date)}` : '';
    const sub = [r?.company, s?.name, o.order_no ? '№ ' + o.order_no : null, `заказ ${A.fmtShort(o.order_date)}`, when].filter(Boolean).join(' · ');
    return `<button class="cell" data-id="${o.id}"><div class="main"><div class="t"><b>${E(r?.full_name || '—')}</b></div>
      <div class="s">${E(sub)}</div></div><div class="r"><div class="amt">${A.fmtMoney(o.amount)}</div>${A.pill(v)}</div><span class="chev">›</span></button>`;
  }

  function orderDetail(id) {
    const o = st.orders.find((x) => x.id === id); if (!o) return;
    const r = repById(o.rep_id), s = storeById(o.store_id), v = ordView(o);
    const acts = [];
    if (o.status === 'ordered') acts.push(btn('arrived', 'Отметить: пришёл', 'green'));
    acts.push(btn('edit', 'Изменить'));
    if (o.status === 'ordered') acts.push(btn('cancel', 'Отменить заказ', 'red'));
    else acts.push(btn('reopen', 'Вернуть в «Ожидается»'));
    if (isAdmin()) acts.push(btn('delete', 'Удалить', 'red'));
    const api = A.sheet({ title: 'Заказ', left: 'Закрыть', body: `
      <div class="hero"><div class="amount">${A.fmtMoney(o.amount)}</div><div class="who">${E(repLabel(r))}</div>${A.pill(v)}</div>
      <div class="section-h"><span>Детали</span></div>
      ${info([['Магазин', s?.name], ['№ заказа', o.order_no], ['Дата заказа', A.fmtDate(o.order_date)],
        ['Ожидаемый приход', o.expected_date ? `${A.fmtDate(o.expected_date)} (${A.relDay(o.expected_date)})` : 'не указан'],
        ['Пришёл', A.fmtDate(o.delivered_at)], ['Комментарий', o.comment]])}
      <div class="section-h"><span>История</span></div>
      ${info([['Записал', `${staffName(o.created_by) || '—'}, ${A.fmtDate(o.created_at)}`],
        ['Изменил', o.updated_by ? `${staffName(o.updated_by) || '—'}, ${A.fmtDate(o.updated_at)}` : null]])}
      ${acts.join('')}` });
    const setStatus = async (status, msg) => {
      api.busy(true);
      const { data, error } = await sb.from('orders').update({ status }).eq('id', id).select().single();
      api.busy(false); if (fail(error)) return;
      Object.assign(o, data); api.close(); A.toast(msg); render.body();
    };
    onActs(api, {
      arrived: () => setStatus('delivered', 'Отмечено: пришёл'),
      cancel: async () => { if (await confirmAct('Отменить заказ?')) setStatus('cancelled', 'Заказ отменён'); },
      reopen: () => setStatus('ordered', 'Заказ снова ожидается'),
      edit: () => orderForm(o),
      delete: async () => {
        if (!(await confirmAct('Удалить заказ без возможности восстановления?'))) return;
        const { error } = await sb.from('orders').delete().eq('id', id); if (fail(error)) return;
        st.orders = st.orders.filter((x) => x.id !== id); api.close(); A.toast('Удалено'); render.body();
      },
    });
  }

  // Подбор ТП/магазина с возможностью создать новый прямо из формы
  const NEW = '__new__';
  function pickers(repId, storeId) {
    return `
      ${field('Представитель', `<select name="rep_id" required><option value="" disabled ${repId ? '' : 'selected'}>выбрать</option>${opts(st.reps.filter((r) => r.active || r.id === repId), repLabel, repId)}<option value="${NEW}">＋ Новый…</option></select>`)}
      <div class="hidden" data-new="rep">${field('ФИО', '<input name="new_rep_name" placeholder="Иванов Иван">')}${field('Компания', '<input name="new_rep_company" placeholder="необязательно">')}${field('Телефон', '<input name="new_rep_phone" type="tel" placeholder="необязательно">')}</div>
      ${field('Магазин', `<select name="store_id"><option value="">—</option>${opts(st.stores, (s) => s.name, storeId)}<option value="${NEW}">＋ Новый…</option></select>`)}
      <div class="hidden" data-new="store">${field('Название', '<input name="new_store_name" placeholder="Магазин">')}</div>`;
  }
  function bindPickers(api) {
    const f = api.body;
    for (const [sel, key] of [['rep_id', 'rep'], ['store_id', 'store']]) {
      f.querySelector(`[name=${sel}]`).addEventListener('change', (e) => {
        const box = f.querySelector(`[data-new=${key}]`); box.classList.toggle('hidden', e.target.value !== NEW);
        if (e.target.value === NEW) box.querySelector('input').focus();
      });
    }
  }
  async function resolvePickers(f) {
    const val = (n) => f.querySelector(`[name=${n}]`)?.value.trim();
    let rep_id = val('rep_id'), store_id = val('store_id') || null;
    if (!rep_id) throw new Error('Выберите представителя');
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
      body: `<div class="section-h"><span>У кого</span></div><div class="list">${pickers(o?.rep_id || preset.rep_id, lastStore && storeById(lastStore) ? lastStore : null)}</div>
        <div class="section-h"><span>Заказ</span></div><div class="list">
          ${field('Сумма, ₽', `<input name="amount" inputmode="decimal" placeholder="0,00" value="${o ? String(o.amount).replace('.', ',') : ''}" required>`)}
          ${field('№ заказа', `<input name="order_no" placeholder="необязательно" value="${E(o?.order_no || '')}">`)}
          ${field('Дата заказа', `<input name="order_date" type="date" value="${o?.order_date || t}" required>`)}
          ${field('Придёт', `<input name="expected_date" type="date" value="${o ? o.expected_date || '' : A.addDays(t, 1)}">`)}
        </div>
        <div class="chips" id="chips">${[['Завтра', 1], ['+2 дня', 2], ['+3 дня', 3], ['Неделя', 7], ['Без даты', null]].map(([l, n]) => `<button type="button" class="chip" data-d="${n}">${l}</button>`).join('')}</div>
        <div class="section-h"><span>Комментарий</span></div><div class="list">
          <label class="field"><textarea name="comment" placeholder="Что заказали, условия, контакт">${E(o?.comment || '')}</textarea></label></div>
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
    onActs(api, { save: () => save(api) });
    if (!o) setTimeout(() => f.querySelector('[name=rep_id]').focus(), 350);

    async function save(api) {
      const v = (n) => f.querySelector(`[name=${n}]`).value.trim();
      const amount = parseAmount(v('amount'));
      if (!(amount > 0)) return A.toast('Укажите сумму больше нуля', true);
      if (v('expected_date') && v('expected_date') < v('order_date')) return A.toast('Дата прихода раньше даты заказа', true);
      api.busy(true);
      try {
        const p = await resolvePickers(f);
        const row = { ...p, amount, order_no: v('order_no') || null, order_date: v('order_date'), expected_date: v('expected_date') || null, comment: v('comment') || null };
        const q = o ? sb.from('orders').update(row).eq('id', o.id) : sb.from('orders').insert(row);
        const { data, error } = await q.select().single(); if (error) throw error;
        if (o) Object.assign(o, data); else st.orders.unshift(data);
        st.orders.sort((a, b) => b.order_date.localeCompare(a.order_date) || b.created_at.localeCompare(a.created_at));
        if (row.store_id) localStorage.setItem('lastStore', row.store_id);
        api.close(); A.toast(o ? 'Сохранено' : 'Заказ записан');
        if (st.tab === 'orders') render.body(); else render();
      } catch (e) { api.busy(false); A.toast(humanError(e), true); }
    }
  }

  // =====================================================================
  // ВЫПЛАТЫ (админ)
  // =====================================================================
  function renderPayouts() {
    frame('Выплаты', [['all', 'Все'], ['accrued', 'Начислено'], ['to_pay', 'К выплате'], ['paid', 'Выплачено']], 'payouts', 'Представитель, основание, сумма');
    render.body = renderPayoutsBody; renderPayoutsBody();
  }
  function renderPayoutsBody() {
    const seg = st.seg.payouts;
    const rows = st.payouts.filter((p) => (seg === 'all' || p.status === seg) && A.matches(st.q.payouts,
      repById(p.rep_id)?.full_name, repById(p.rep_id)?.company, storeById(p.store_id)?.name, p.basis, p.comment, p.amount, A.fmtMoney(p.amount), A.fmtDate(p.payout_date)));
    const toPay = st.payouts.filter((p) => p.status === 'to_pay');
    let html = `<div class="stats">
      <div class="stat" style="cursor:default"><div class="k"><span class="dot" style="background:var(--gray)"></span>В списке · ${rows.length}</div><div class="v">${A.fmtMoney(A.sum(rows))}</div></div>
      <div class="stat" style="cursor:default"><div class="k"><span class="dot" style="background:var(--blue)"></span>К выплате · ${toPay.length}</div><div class="v">${A.fmtMoney(A.sum(toPay))}</div></div></div>`;
    for (const [ym, items] of A.groupBy(rows, (p) => p.payout_date.slice(0, 7))) {
      html += `<div class="section-h"><span>${A.fmtMonth(ym)}</span><span>${A.fmtMoney(A.sum(items))}</span></div><div class="list">` +
        items.map((p) => { const r = repById(p.rep_id), s = storeById(p.store_id);
          return `<button class="cell" data-id="${p.id}"><div class="main"><div class="t"><b>${E(r?.full_name || '—')}</b></div>
            <div class="s">${E([A.fmtShort(p.payout_date), p.basis, s?.name].filter(Boolean).join(' · '))}</div></div>
            <div class="r"><div class="amt">${A.fmtMoney(p.amount)}</div>${A.pill(A.PAY[p.status])}</div><span class="chev">›</span></button>`; }).join('') + '</div>';
    }
    if (!rows.length) html += A.emptyState(st.q.payouts ? 'Ничего не найдено' : 'Выплат нет', st.q.payouts ? '' : 'Нажмите «+», чтобы добавить запись');
    setBody(html);
    $('body').querySelectorAll('.cell[data-id]').forEach((c) => c.addEventListener('click', () => payoutDetail(c.dataset.id)));
  }
  function payoutDetail(id) {
    const p = st.payouts.find((x) => x.id === id); if (!p) return;
    const acts = Object.entries(A.PAY).filter(([k]) => k !== p.status).map(([k, v]) => btn('st_' + k, `Статус: ${v.label}`, k === 'paid' ? 'green' : 'plain'));
    const api = A.sheet({ title: 'Выплата', left: 'Закрыть', body: `
      <div class="hero"><div class="amount">${A.fmtMoney(p.amount)}</div><div class="who">${E(repLabel(repById(p.rep_id)))}</div>${A.pill(A.PAY[p.status])}</div>
      <div class="section-h"><span>Детали</span></div>
      ${info([['Дата', A.fmtDate(p.payout_date)], ['Магазин', storeById(p.store_id)?.name], ['Основание', p.basis], ['Выплачено', A.fmtDate(p.paid_at)], ['Комментарий', p.comment]])}
      ${acts.join('')}${btn('edit', 'Изменить')}${btn('delete', 'Удалить', 'red')}` });
    const map = {
      edit: () => payoutForm(p),
      delete: async () => {
        if (!(await confirmAct('Удалить запись о выплате?'))) return;
        const { error } = await sb.from('payouts').delete().eq('id', id); if (fail(error)) return;
        st.payouts = st.payouts.filter((x) => x.id !== id); api.close(); A.toast('Удалено'); render.body();
      },
    };
    for (const k of Object.keys(A.PAY)) map['st_' + k] = async () => {
      api.busy(true);
      const { data, error } = await sb.from('payouts').update({ status: k }).eq('id', id).select().single();
      api.busy(false); if (fail(error)) return;
      Object.assign(p, data); api.close(); A.toast('Статус: ' + A.PAY[k].label); render.body();
    };
    onActs(api, map);
  }
  function payoutForm(p = null, preset = {}) {
    const api = A.sheet({
      title: p ? 'Изменить выплату' : 'Новая выплата', right: { label: 'Готово', onClick: (a) => save(a) },
      body: `<div class="section-h"><span>Кому</span></div><div class="list">${pickers(p?.rep_id || preset.rep_id, p?.store_id)}</div>
        <div class="section-h"><span>Выплата</span></div><div class="list">
          ${field('Сумма, ₽', `<input name="amount" inputmode="decimal" placeholder="0,00" value="${p ? String(p.amount).replace('.', ',') : ''}">`)}
          ${field('Дата', `<input name="payout_date" type="date" value="${p?.payout_date || A.today()}">`)}
          ${field('Статус', `<select name="status">${Object.entries(A.PAY).map(([k, v]) => `<option value="${k}" ${k === (p?.status || 'accrued') ? 'selected' : ''}>${v.label}</option>`).join('')}</select>`)}
          ${field('Основание', `<input name="basis" placeholder="накладная, бонус, акция" value="${E(p?.basis || '')}">`)}
        </div>
        <div class="section-h"><span>Комментарий</span></div><div class="list"><label class="field"><textarea name="comment">${E(p?.comment || '')}</textarea></label></div>
        <button class="btn blue" type="button" data-act="save">${p ? 'Сохранить' : 'Добавить'}</button>`,
    });
    const f = api.body; bindPickers(api); onActs(api, { save: () => save(api) });
    async function save(api) {
      const v = (n) => f.querySelector(`[name=${n}]`).value.trim();
      const amount = parseAmount(v('amount'));
      if (!(amount > 0)) return A.toast('Укажите сумму больше нуля', true);
      api.busy(true);
      try {
        const pk = await resolvePickers(f);
        const row = { ...pk, amount, payout_date: v('payout_date'), status: v('status'), basis: v('basis') || null, comment: v('comment') || null };
        const q = p ? sb.from('payouts').update(row).eq('id', p.id) : sb.from('payouts').insert(row);
        const { data, error } = await q.select().single(); if (error) throw error;
        if (p) Object.assign(p, data); else st.payouts.unshift(data);
        st.payouts.sort((a, b) => b.payout_date.localeCompare(a.payout_date));
        api.close(); A.toast('Сохранено'); render();
      } catch (e) { api.busy(false); A.toast(humanError(e), true); }
    }
  }

  // =====================================================================
  // СПРАВОЧНИК
  // =====================================================================
  function renderDir() {
    frame('Справочник', [['reps', `Представители · ${st.reps.length}`], ['stores', `Магазины · ${st.stores.length}`]], 'dir', 'Поиск');
    render.body = renderDirBody; renderDirBody();
  }
  function renderDirBody() {
    const q = st.q.dir; let html = '';
    if (st.seg.dir === 'reps') {
      const rows = st.reps.filter((r) => A.matches(q, r.full_name, r.company, r.phone));
      const groups = A.groupBy(rows, (r) => (r.active ? 'Активные' : 'Отключённые'));
      for (const g of ['Активные', 'Отключённые']) if (groups.has(g)) {
        html += `<div class="section-h"><span>${g}</span></div><div class="list">` + groups.get(g).map((r) => {
          const wait = st.orders.filter((o) => o.rep_id === r.id && o.status === 'ordered');
          return `<button class="cell" data-rep="${r.id}"><div class="avatar">${E(A.initials(r.full_name))}</div>
            <div class="main"><div class="t"><b>${E(r.full_name)}</b></div><div class="s">${E([r.company, r.phone].filter(Boolean).join(' · ') || 'Торговый представитель')}</div></div>
            ${wait.length ? `<div class="r"><span class="pill c-blue">ждём ${wait.length}</span></div>` : ''}<span class="chev">›</span></button>`;
        }).join('') + '</div>';
      }
      if (!rows.length) html = A.emptyState(q ? 'Ничего не найдено' : 'Представителей нет', q ? '' : 'Нажмите «+», чтобы добавить');
    } else {
      const rows = st.stores.filter((s) => A.matches(q, s.name, s.address));
      if (rows.length) html = `<div class="section-h"><span>Магазины</span></div><div class="list">` + rows.map((s) =>
        `<button class="cell" data-store="${s.id}"><div class="main"><div class="t">${E(s.name)}</div>${s.address ? `<div class="s">${E(s.address)}</div>` : ''}</div><span class="chev">›</span></button>`).join('') + '</div>';
      else html = A.emptyState(q ? 'Ничего не найдено' : 'Магазинов нет', q ? '' : 'Нажмите «+», чтобы добавить');
    }
    setBody(html);
    $('body').querySelectorAll('[data-rep]').forEach((c) => c.addEventListener('click', () => repDetail(c.dataset.rep)));
    $('body').querySelectorAll('[data-store]').forEach((c) => c.addEventListener('click', () => storeForm(storeById(c.dataset.store))));
  }

  const repLink = (rep) => { const t = st.access.find((a) => a.rep_id === rep.id)?.token; return t ? new URL('index.html', location.href).href.split('#')[0] + '#' + t : null; };
  const newToken = () => Array.from(crypto.getRandomValues(new Uint8Array(18)), (b) => b.toString(16).padStart(2, '0')).join('');

  function repDetail(id) {
    const r = repById(id); if (!r) return;
    const ords = st.orders.filter((o) => o.rep_id === id);
    const wait = ords.filter((o) => o.status === 'ordered');
    const pays = st.payouts.filter((p) => p.rep_id === id);
    const toPay = pays.filter((p) => p.status === 'to_pay');
    let acts = btn('order', 'Новый заказ у представителя', 'blue');
    if (r.phone) acts += btn('call', `Позвонить: ${r.phone}`);
    if (isAdmin()) {
      acts += `<div class="section-h"><span>Ссылка для представителя</span></div>` + btn('copy', 'Скопировать ссылку') + btn('wa', 'Отправить в WhatsApp') + btn('open', 'Открыть кабинет')
        + btn('regen', 'Выдать новую ссылку') + `<div class="footer-note">Новая ссылка сразу отключает старую.</div>`
        + `<div class="section-h"><span>Управление</span></div>` + btn('payout', 'Новая выплата') + btn('edit', 'Изменить данные')
        + btn('toggle', r.active ? 'Отключить доступ' : 'Включить доступ', r.active ? 'red' : 'plain') + btn('delete', 'Удалить', 'red');
    }
    const api = A.sheet({ title: 'Представитель', left: 'Закрыть', body: `
      <div class="hero"><div class="avatar" style="width:72px;height:72px;font-size:28px;margin:0 auto 8px">${E(A.initials(r.full_name))}</div>
        <div style="font-size:22px;font-weight:700">${E(r.full_name)}</div><div class="who">${E(r.company || 'Торговый представитель')}${r.active ? '' : ' · отключён'}</div></div>
      <div class="stats" style="margin-top:14px">
        <div class="stat" style="cursor:default"><div class="k">Ожидается · ${wait.length}</div><div class="v">${A.fmtMoney(A.sum(wait))}</div></div>
        <div class="stat" style="cursor:default"><div class="k">${isAdmin() ? `К выплате · ${toPay.length}` : `Всего заказов · ${ords.length}`}</div><div class="v">${A.fmtMoney(isAdmin() ? A.sum(toPay) : A.sum(ords.filter((o) => o.status !== 'cancelled')))}</div></div></div>
      ${ords.length ? `<div class="section-h"><span>Последние заказы</span></div><div class="list">${ords.slice(0, 5).map(orderCell).join('')}</div>` : ''}
      ${acts}` });
    api.body.querySelectorAll('.cell[data-id]').forEach((c) => c.addEventListener('click', () => orderDetail(c.dataset.id)));
    const link = () => repLink(r);
    const update = async (patch, msg) => {
      const { data, error } = await sb.from('reps').update(patch).eq('id', id).select().single(); if (fail(error)) return;
      Object.assign(r, data); A.toast(msg); api.close(); render();
    };
    onActs(api, {
      order: () => orderForm(null, { rep_id: id }),
      payout: () => payoutForm(null, { rep_id: id }),
      call: () => (location.href = 'tel:' + r.phone.replace(/[^\d+]/g, '')),
      copy: async () => { try { await navigator.clipboard.writeText(link()); A.toast('Ссылка скопирована'); } catch { window.prompt('Скопируйте ссылку', link()); } },
      wa: () => {
        const phone = (r.phone || '').replace(/\D/g, '').replace(/^8(?=\d{10}$)/, '7');
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
      toggle: () => update({ active: !r.active }, r.active ? 'Доступ отключён' : 'Доступ включён'),
      delete: async () => {
        if (!(await confirmAct(`Удалить «${r.full_name}»?`))) return;
        const { error } = await sb.from('reps').delete().eq('id', id); if (fail(error)) return;
        st.reps = st.reps.filter((x) => x.id !== id); api.close(); A.toast('Удалено'); render();
      },
    });
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
    let html = `<div class="list" style="margin-top:12px"><div class="cell static"><div class="avatar">${E(A.initials(st.me.full_name))}</div>
      <div class="main"><div class="t"><b>${E(st.me.full_name)}</b></div><div class="s">${E(st.me.login)} · ${isAdmin() ? 'Администратор' : 'Сотрудник'}</div></div></div></div>`;
    if (isAdmin()) {
      html += `<div class="section-h"><span>Сотрудники</span></div><div class="list">` + st.staff.map((s) =>
        `<button class="cell" data-staff="${s.user_id}"><div class="avatar">${E(A.initials(s.full_name))}</div><div class="main"><div class="t">${E(s.full_name)}</div>
          <div class="s">${E(s.login)} · ${s.role === 'admin' ? 'Администратор' : 'Сотрудник'}${s.active ? '' : ' · отключён'}</div></div><span class="chev">›</span></button>`).join('')
        + `<button class="cell action" data-act-add>＋ Добавить сотрудника</button></div>
        <div class="footer-note">Сотрудник входит по логину и паролю. Он видит заказы и справочник; выплаты и ссылки представителей ему недоступны.</div>`;
    }
    html += `<div class="section-h"><span>На iPhone</span></div><div class="list"><div class="cell static"><div class="main"><div class="s" style="white-space:normal">
      Safari → «Поделиться» → «На экран Домой». Приложение откроется без адресной строки, как обычное.</div></div></div></div>
      <div class="list" style="margin-top:24px"><button class="cell danger" id="logout">Выйти</button></div>`;
    setBody(html);
    $('body').querySelectorAll('[data-staff]').forEach((c) => c.addEventListener('click', () => staffForm(st.staff.find((s) => s.user_id === c.dataset.staff))));
    $('body').querySelector('[data-act-add]')?.addEventListener('click', () => staffForm());
    $('logout').addEventListener('click', async () => { await sb.auth.signOut(); st.me = null; showLogin(); });
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
      ${s && !self ? btn('toggle', s.active ? 'Отключить вход' : 'Включить вход', s.active ? 'red' : 'plain') : ''}
      <div class="footer-note">Передайте сотруднику логин и пароль лично. Пароль после сохранения не показывается.</div>` });
    const f = api.body; const v = (n) => f.querySelector(`[name=${n}]`).value.trim();
    onActs(api, {
      save: () => save(api),
      gen: () => { f.querySelector('[name=password]').value = Array.from(crypto.getRandomValues(new Uint8Array(4)), (b) => (b % 10)).join('') + Math.random().toString(36).slice(2, 6); },
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
  async function refresh(force = false) {
    if (!st.me || refreshing || document.hidden) return;
    if (!force && Date.now() - lastLoad < 15000) return;
    if (document.querySelector('.sheet')) return;                       // открыта форма — не мешаем
    if (document.activeElement?.matches('input, textarea, select')) return; // идёт ввод
    refreshing = true;
    try { await loadAll(); lastLoad = Date.now(); render(); } finally { refreshing = false; }
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
  window.addEventListener('focus', () => refresh());
  setInterval(() => refresh(true), 60000);

  // ---------- старт ----------
  sb.auth.onAuthStateChange((ev) => { if (ev === 'SIGNED_OUT' && st.me) { st.me = null; showLogin(); } });
  boot();
})();
