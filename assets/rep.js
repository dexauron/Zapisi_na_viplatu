// Кабинет торгового представителя: только свои заказы, выплаты и документы 1С —
// по персональной ссылке (#токен) или по логину и паролю, которые выдал администратор
(async function () {
  const A = window.App;
  const page = document.getElementById('page');
  A.navScroll(document.getElementById('nav'));

  // Токен — в #фрагменте ссылки (не уходит на сервер и в логи); ?t= — запасной вариант
  const token = (location.hash.replace(/^#/, '') || new URLSearchParams(location.search).get('t') || '').trim();
  const fail = (t, s, extra = '') => (page.innerHTML = A.emptyState(t, s) + extra);
  const REP_DOMAIN = 'rep.zapisi.app', STAFF_DOMAIN = 'staff.zapisi.app';
  // По ссылке — анонимно, как раньше; по логину — своя сессия (общая с приложением сотрудников на этом устройстве)
  const rb = token ? A.sb : A.repClient();
  let data, error;
  if (token) {
    ({ data, error } = await A.sb.rpc('get_rep_data', { p_token: token }));
    if (error) return fail('Нет связи', 'Проверьте интернет и обновите страницу.');
    if (!data) return fail('Ссылка недействительна', 'Доступ отключён или ссылка заменена. Обратитесь к администратору.');
  } else {
    let session = null;
    try { ({ data: { session } } = await rb.auth.getSession()); } catch { session = null; }
    if (!session) return loginForm();
    ({ data, error } = await rb.rpc('my_rep_data'));
    if (error) {
      if (/JWT|token|401|PGRST30/i.test(error.message + (error.code || ''))) { await rb.auth.signOut().catch(() => {}); return loginForm(); }
      return fail('Нет связи', 'Проверьте интернет и обновите страницу.');
    }
    if (!data) {
      if (session.user?.email?.endsWith('@' + STAFF_DOMAIN) || !session.user?.email?.endsWith('@' + REP_DOMAIN)) {
        return fail('Это кабинет представителя', 'Вы вошли как сотрудник магазина.', '<a class="btn blue" href="app.html" style="display:block;text-align:center;text-decoration:none;margin:0 16px">Открыть приложение</a>');
      }
      await rb.auth.signOut().catch(() => {});
      return loginForm('Вход отключён. Обратитесь в магазин.');
    }
    const nb = document.querySelectorAll('#nav .nav-btn')[1];
    if (nb) {
      nb.outerHTML = '<button class="nav-btn right" id="rep-out" type="button">Выйти</button>';
      document.getElementById('rep-out').addEventListener('click', async () => {
        if (!window.confirm('Выйти из кабинета?')) return;
        await rb.auth.signOut().catch(() => {}); location.reload();
      });
    }
  }

  function loginForm(msg = '') {
    document.getElementById('nav-title').textContent = 'Вход';
    page.innerHTML = `
      <form class="login" id="rl" autocomplete="on" style="padding-top:24px">
        <img class="logo" src="assets/icon.svg" alt="">
        <h1>Сверка</h1>
        <p>Кабинет торгового представителя</p>
        <div class="list">
          <label class="field"><span>Логин</span><input name="login" autocomplete="username" autocapitalize="none" spellcheck="false" required></label>
          <label class="field"><span>Пароль</span><input name="password" type="password" autocomplete="current-password" required></label>
        </div>
        <button class="btn blue" type="submit">Войти</button>
        <p class="footer-note" style="text-align:center;margin-top:14px">${A.esc(msg || 'Логин и пароль выдаёт магазин. Можно открыть и личную ссылку из сообщения.')}</p>
      </form>`;
    document.getElementById('rl').addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = e.target, b = f.querySelector('button'), u = f.login.value.trim().toLowerCase();
      b.disabled = true;
      const { error: err } = await rb.auth.signInWithPassword({ email: u.includes('@') ? u : `${u}@${REP_DOMAIN}`, password: f.password.value });
      b.disabled = false;
      if (err) return A.toast(/Invalid login/i.test(err.message) ? 'Неверный логин или пароль' : /banned/i.test(err.message) ? 'Вход отключён. Обратитесь в магазин.'
        : /fetch|network/i.test(err.message) ? 'Нет связи с сервером' : err.message, true);
      location.reload();
    });
  }

  const orders = data.orders.map((o) => ({ ...o, view: A.orderView(o) }));
  const payouts = data.payouts;
  // Документы 1С за полгода: приходы, оплаты, возвраты
  const shortNum = (n) => String(n || '').replace(/^\D+/, '').replace(/^0+(?=\d)/, '') || String(n || '');
  const DOC = { in: 'Накладная', pay: 'Оплата', ret: 'Возврат' };
  const docs = (data.docs || []).map((d) => ({ ...d, date: d.at.slice(0, 10),
    view: d.kind === 'in' ? (Number(d.open) > 0 ? { label: 'Не оплачено', c: 'orange' } : { label: 'Оплачено', c: 'green' })
      : d.kind === 'pay' ? { label: 'Оплата', c: 'green' } : d.kind === 'ret' ? { label: 'Возврат', c: 'orange' } : { label: 'Прочее', c: 'gray' } }));
  // Акт сверки: документы есть за полгода, долг до них = общий долг по 1С минус их сумма
  const actBase = data.debt != null ? Number(data.debt) - docs.reduce((a, d) => a + Number(d.inc || 0) - Number(d.dec || 0), 0) : 0;
  const openAct = () => window.Act.open({ party: [data.rep.company, data.rep.full_name].filter(Boolean).join(' · '),
    docs: docs.filter((d) => d.inc != null), base: actBase, minDate: docs.reduce((m, d) => (!m || d.date < m ? d.date : m), null) });
  const actual = (o) => {
    if (o.actual == null) return '';
    const d = A.toCents(o.actual) - A.toCents(o.amount);
    return `пришло ${A.fmtMoney(o.actual)}${d ? ` (${d > 0 ? '+' : '−'}${A.fmtMoney(Math.abs(d) / 100)})` : ''}`;
  };
  // Период по умолчанию — текущий месяц. Ожидаемые заказы и неоплаченные записи видны всегда; поиск — по всем датам
  const st = { tab: 'orders', filter: null, q: '', per: A.period('month') };
  const inPer = (d) => !!st.q || A.inPeriod(st.per, d);
  const vOrders = () => orders.filter((o) => o.status === 'ordered' || inPer(o.delivered_at?.slice(0, 10) || o.date));
  const vPayouts = () => payouts.filter((p) => p.status !== 'paid' || inPer(p.date));
  const vDocs = () => docs.filter((d) => inPer(d.date));
  document.getElementById('nav-title').textContent = data.rep.full_name;
  document.title = data.rep.full_name;

  page.innerHTML = `
    <div class="large-title">${A.esc(data.rep.full_name)}</div>
    <div class="subtitle">${A.esc([data.shop ? `Магазин «${data.shop}»` : '', data.rep.company].filter(Boolean).join(' · ') || 'Торговый представитель')}</div>
    <div class="segmented" id="seg"><button data-t="orders" class="on">Заказы · ${orders.length}</button><button data-t="payouts">Выплаты · ${payouts.length}</button>${docs.length ? `<button data-t="docs">Накладные · ${docs.length}</button>` : ''}</div>
    ${A.searchBox('q', 'Магазин, №, сумма, комментарий')}
    <div id="per"></div>
    <div class="stats" id="stats"></div>
    <div id="list"></div>`;

  const $ = (id) => document.getElementById(id);
  $('seg').addEventListener('click', (e) => {
    const t = e.target.closest('button')?.dataset.t; if (!t || t === st.tab) return;
    st.tab = t; st.filter = null;
    $('seg').querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.t === t));
    render();
  });
  A.bindSearch($('q'), () => { st.q = $('q').value; render(); });
  function renderPer() {
    $('per').innerHTML = st.q.trim() ? '' : A.periodBar(st.per);
    A.bindPeriod($('per'), () => st.per, (np) => { st.per = np; st.filter = null; render(); });
  }

  function statsDef() {
    if (st.tab === 'orders') {
      const os = vOrders(), by = (k) => os.filter((o) => (k === 'wait' ? o.status === 'ordered' : o.view.key === k));
      return [
        ['wait', 'Ожидается', 'blue', by('wait')],
        ['late', 'Просрочено', 'red', by('late')],
        ['delivered', 'Пришло', 'green', by('delivered')],
        [null, 'Все заказы', 'gray', os.filter((o) => o.status !== 'cancelled')],
      ];
    }
    if (st.tab === 'docs') {
      const ds = vDocs();
      return [
        ['in', 'Приход', 'blue', ds.filter((d) => d.kind === 'in')],
        ['pay', 'Оплачено', 'green', ds.filter((d) => d.kind === 'pay')],
        ['ret', 'Возвраты', 'orange', ds.filter((d) => d.kind === 'ret')],
        ...(data.debt != null ? [[null, 'Долг магазина', 'gray', [], Math.max(0, Number(data.debt))]] : []),
      ];
    }
    const ps = vPayouts();
    return [
      ['to_pay', 'Не оплачено', 'orange', ps.filter((p) => p.status !== 'paid')],
      ['paid', 'Оплачено', 'green', ps.filter((p) => p.status === 'paid')],
    ];
  }
  function renderStats() {
    $('stats').innerHTML = statsDef().map(([k, label, c, rows, value]) => `
      <button class="stat ${st.filter === k && k ? 'on' : ''}" data-k="${k ?? ''}">
        <div class="k"><span class="dot" style="background:var(--${c})"></span>${label}${value == null ? ' · ' + rows.length : ''}</div>
        <div class="v">${A.fmtMoney(value ?? A.sum(rows))}</div></button>`).join('');
    $('stats').querySelectorAll('.stat').forEach((b) => b.addEventListener('click', () => {
      const k = b.dataset.k || null; st.filter = st.filter === k ? null : k; render();
    }));
  }

  function rowsNow() {
    if (st.tab === 'orders') {
      return vOrders().filter((o) => (!st.filter || (st.filter === 'wait' ? o.status === 'ordered' : o.view.key === st.filter))
        && A.matches(st.q, o.store, o.order_no, o.comment, o.amount, A.fmtMoney(o.amount), A.fmtDate(o.date), o.view.label));
    }
    if (st.tab === 'docs') {
      return vDocs().filter((d) => (!st.filter || d.kind === st.filter) && A.matches(st.q, d.num, shortNum(d.num), d.in_no, DOC[d.kind] || d.title, d.amount, A.fmtMoney(d.amount), A.fmtDate(d.date)));
    }
    return vPayouts().filter((p) => (!st.filter || (st.filter === 'paid') === (p.status === 'paid'))
      && A.matches(st.q, p.invoice_no, p.store, p.basis, p.comment, p.amount, A.fmtMoney(p.amount), A.fmtDate(p.date), A.payView(p.status).label));
  }

  function renderList() {
    const rows = rowsNow();
    const actBtn = st.tab === 'docs' && window.Act && docs.some((d) => d.inc != null) ? '<button class="btn plain" type="button" id="act" style="margin:0 0 4px">Акт сверки · PDF</button>' : '';
    if (!rows.length) { $('list').innerHTML = actBtn + A.emptyState(st.q ? 'Ничего не найдено' : 'За период записей нет', st.q ? 'Поиск идёт по всем датам' : 'Выберите другой период'); $('act')?.addEventListener('click', openAct); return; }
    let html = actBtn;
    // сегодня/текущий месяц — первыми, затем будущие, прошедшие — в конце (новые сверху)
    const t = A.today(), rk = (d) => (d === t ? 0 : d > t ? 1 : 2);
    const byDay = (a, b) => rk(a.date.slice(0, 10)) - rk(b.date.slice(0, 10)) || (rk(a.date.slice(0, 10)) === 1 ? a.date.localeCompare(b.date) : b.date.localeCompare(a.date));
    const months = [...A.groupBy([...rows].sort(byDay), (r) => r.date.slice(0, 7))].sort((a, b) => A.monthOrder(a[0], b[0]));
    for (const [ym, items] of months) {
      html += `<div class="section-h"><span>${A.fmtMonth(ym)}</span><span>${A.fmtMoney(A.sum(items))}</span></div><div class="list">`;
      for (const r of items) {
        if (st.tab === 'orders') {
          html += cell(r.id, r.store || 'Заказ от ' + A.fmtShort(r.date), [A.orderWhen(r), actual(r)].filter(Boolean).join(' · '), r.amount, r.view);
        } else if (st.tab === 'docs') {
          html += cell(r.id, `${DOC[r.kind] || r.title} ${A.docNo(r)}`.trim(),
            [A.fmtShort(r.date), r.kind === 'in' && Number(r.open) > 0 ? `не оплачено ${A.fmtMoney(r.open)}` : ''].filter(Boolean).join(' · '), r.amount, r.view, 'doc', A.docIcon(r.kind));
        } else {
          html += cell(r.id, r.invoice_no ? 'Накладная № ' + r.invoice_no : r.basis || 'Выплата',
            [A.fmtShort(r.date), r.invoice_no && r.basis, r.status === 'paid' ? (r.received_at ? 'получено ✓' : 'подтвердите получение') : ''].filter(Boolean).join(' · '),
            r.amount, A.payView(r.status), r.status === 'paid' ? 'pay paid' : 'pay');
        }
      }
      html += '</div>';
    }
    $('list').innerHTML = html;
    $('list').querySelectorAll('.cell').forEach((c) => c.addEventListener('click', () => detail(c.dataset.id)));
    $('act')?.addEventListener('click', openAct);
  }
  const cell = (id, t, s, amount, view, cls = '', icon = '') => `<button class="cell ${cls}" data-id="${id}">${icon}
    <div class="main"><div class="t"><b>${A.esc(t)}</b></div><div class="s">${A.esc(s)}</div></div>
    <div class="r"><div class="amt">${A.fmtMoney(amount)}</div>${A.pill(view)}</div></button>`;

  const info = (rows) => `<div class="list">${rows.filter(([, v]) => v).map(([k, v]) =>
    `<div class="cell static"><div class="main">${A.esc(k)}</div><div class="value" style="text-align:right;white-space:normal">${A.esc(v)}</div></div>`).join('')}</div>`;

  function detail(id) {
    if (st.tab === 'docs') {
      const d = docs.find((x) => x.id === id);
      A.sheet({ title: DOC[d.kind] || d.title, left: 'Закрыть', body: `
        <div class="hero"><div class="amount">${A.fmtMoney(d.amount)}</div><div class="who">${A.pill(d.view)}</div></div>
        <div class="section-h"><span>Детали</span></div>
        ${info([['Документ', `${DOC[d.kind] || d.title} ${A.docNo(d)}`.trim()], ['Дата', A.fmtDate(d.date)],
          ['Не оплачено', d.kind === 'in' && Number(d.open) > 0 ? A.fmtMoney(d.open) : null]])}` });
      return;
    }
    if (st.tab === 'orders') {
      const o = orders.find((x) => x.id === id);
      A.sheet({ title: 'Заказ', left: 'Закрыть', body: `
        <div class="hero"><div class="amount">${A.fmtMoney(o.amount)}</div><div class="who">${A.pill(o.view)}</div></div>
        <div class="section-h"><span>Детали</span></div>
        ${info([['Магазин', o.store], ['№ заказа', o.order_no], ['Дата заказа', A.fmtDate(o.date)],
          ['Ожидаемый приход', A.fmtDate(o.expected)], ['Пришёл', A.fmtDate(o.delivered_at)], ['По накладной', actual(o).replace(/^пришло /, '')], ['Комментарий', o.comment]])}` });
    } else {
      const p = payouts.find((x) => x.id === id);
      const canConfirm = p.status === 'paid' && !p.received_at;
      const api = A.sheet({ title: 'Выплата', left: 'Закрыть', body: `
        <div class="hero"><div class="amount ${p.status === 'paid' ? 'paid' : ''}">${A.fmtMoney(p.amount)}</div><div class="who">${A.pill(A.payView(p.status))}</div></div>
        <div class="section-h"><span>Детали</span></div>
        ${info([['№ накладной', p.invoice_no], ['Дата', A.fmtDate(p.date)], ['Магазин', p.store], ['Основание', p.basis], ['Оплачено', A.fmtDate(p.paid_at)],
          ['Вы получили', p.received_at ? A.fmtDate(p.received_at) : null], ['Комментарий', p.comment]])}
        ${canConfirm ? `<button class="btn green" type="button" id="got">Получил ${A.esc(A.fmtMoney(p.amount))}</button>
          <div class="footer-note">Нажмите, когда деньги у вас: магазин увидит подтверждение.</div>` : ''}` });
      api.body.querySelector('#got')?.addEventListener('click', async (e) => {
        e.target.disabled = true;
        const { data: at, error: err } = token ? await A.sb.rpc('confirm_receipt', { p_token: token, p_id: p.id })
          : await rb.rpc('my_confirm_receipt', { p_id: p.id });
        if (err || !at) { e.target.disabled = false; return A.toast(err ? 'Нет связи — попробуйте ещё раз' : 'Не удалось подтвердить', true); }
        p.received_at = at; A.haptic(); api.close(); A.toast('Получение подтверждено'); render();
      });
    }
  }

  function render() { renderPer(); renderStats(); renderList(); }
  render();

  // Вернулись на вкладку через минуту и больше — показать свежие данные
  let shownAt = Date.now();
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && Date.now() - shownAt > 60000 && !document.querySelector('.sheet')) location.reload();
  });

  A.pullToRefresh(() => location.reload());
})();
