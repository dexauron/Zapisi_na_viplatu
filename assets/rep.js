// Кабинет торгового представителя: только просмотр своих заказов и выплат по персональной ссылке
(async function () {
  const A = window.App;
  const page = document.getElementById('page');
  A.navScroll(document.getElementById('nav'));

  // Токен — в #фрагменте ссылки (не уходит на сервер и в логи); ?t= — запасной вариант
  const token = (location.hash.replace(/^#/, '') || new URLSearchParams(location.search).get('t') || '').trim();
  const fail = (t, s) => (page.innerHTML = A.emptyState(t, s));
  if (!token) return fail('Ссылка неполная', 'Попросите администратора прислать персональную ссылку.');

  const { data, error } = await A.sb.rpc('get_rep_data', { p_token: token });
  if (error) return fail('Нет связи', 'Проверьте интернет и обновите страницу.');
  if (!data) return fail('Ссылка недействительна', 'Доступ отключён или ссылка заменена. Обратитесь к администратору.');

  const orders = data.orders.map((o) => ({ ...o, view: A.orderView(o) }));
  const payouts = data.payouts;
  const st = { tab: 'orders', filter: null, q: '' };
  document.getElementById('nav-title').textContent = data.rep.full_name;
  document.title = data.rep.full_name;

  page.innerHTML = `
    <div class="large-title">${A.esc(data.rep.full_name)}</div>
    <div class="subtitle">${A.esc(data.rep.company || 'Торговый представитель')}</div>
    <div class="segmented" id="seg"><button data-t="orders" class="on">Заказы · ${orders.length}</button><button data-t="payouts">Выплаты · ${payouts.length}</button></div>
    ${A.searchBox('q', 'Магазин, №, сумма, комментарий')}
    <div class="stats" id="stats"></div>
    <div id="list"></div>`;

  const $ = (id) => document.getElementById(id);
  $('seg').addEventListener('click', (e) => {
    const t = e.target.closest('button')?.dataset.t; if (!t || t === st.tab) return;
    st.tab = t; st.filter = null;
    $('seg').querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.t === t));
    render();
  });
  A.bindSearch($('q'), () => { st.q = $('q').value; renderList(); });

  function statsDef() {
    if (st.tab === 'orders') {
      const by = (k) => orders.filter((o) => (k === 'wait' ? o.status === 'ordered' : o.view.key === k));
      return [
        ['wait', 'Ожидается', 'blue', by('wait')],
        ['late', 'Просрочено', 'red', by('late')],
        ['delivered', 'Пришло', 'green', by('delivered')],
        [null, 'Все заказы', 'gray', orders.filter((o) => o.status !== 'cancelled')],
      ];
    }
    return [
      ['to_pay', 'Не оплачено', 'orange', payouts.filter((p) => p.status !== 'paid')],
      ['paid', 'Оплачено', 'green', payouts.filter((p) => p.status === 'paid')],
    ];
  }
  function renderStats() {
    $('stats').innerHTML = statsDef().map(([k, label, c, rows]) => `
      <button class="stat ${st.filter === k && k ? 'on' : ''}" data-k="${k ?? ''}">
        <div class="k"><span class="dot" style="background:var(--${c})"></span>${label} · ${rows.length}</div>
        <div class="v">${A.fmtMoney(A.sum(rows))}</div></button>`).join('');
    $('stats').querySelectorAll('.stat').forEach((b) => b.addEventListener('click', () => {
      const k = b.dataset.k || null; st.filter = st.filter === k ? null : k; render();
    }));
  }

  function rowsNow() {
    if (st.tab === 'orders') {
      return orders.filter((o) => (!st.filter || (st.filter === 'wait' ? o.status === 'ordered' : o.view.key === st.filter))
        && A.matches(st.q, o.store, o.order_no, o.comment, o.amount, A.fmtMoney(o.amount), A.fmtDate(o.date), o.view.label));
    }
    return payouts.filter((p) => (!st.filter || (st.filter === 'paid') === (p.status === 'paid'))
      && A.matches(st.q, p.invoice_no, p.store, p.basis, p.comment, p.amount, A.fmtMoney(p.amount), A.fmtDate(p.date), A.payView(p.status).label));
  }

  function renderList() {
    const rows = rowsNow();
    if (!rows.length) { $('list').innerHTML = A.emptyState(st.q ? 'Ничего не найдено' : 'Записей нет', st.q ? 'Измените запрос' : ''); return; }
    let html = '';
    for (const [ym, items] of A.groupBy(rows, (r) => r.date.slice(0, 7))) {
      html += `<div class="section-h"><span>${A.fmtMonth(ym)}</span><span>${A.fmtMoney(A.sum(items))}</span></div><div class="list">`;
      for (const r of items) {
        if (st.tab === 'orders') {
          html += cell(r.id, r.store || 'Заказ от ' + A.fmtShort(r.date), A.orderWhen(r), r.amount, r.view);
        } else {
          html += cell(r.id, r.invoice_no ? 'Накладная № ' + r.invoice_no : r.basis || 'Выплата',
            [A.fmtShort(r.date), r.invoice_no && r.basis].filter(Boolean).join(' · '), r.amount, A.payView(r.status), r.status === 'paid' ? 'pay paid' : 'pay');
        }
      }
      html += '</div>';
    }
    $('list').innerHTML = html;
    $('list').querySelectorAll('.cell').forEach((c) => c.addEventListener('click', () => detail(c.dataset.id)));
  }
  const cell = (id, t, s, amount, view, cls = '') => `<button class="cell ${cls}" data-id="${id}">
    <div class="main"><div class="t"><b>${A.esc(t)}</b></div><div class="s">${A.esc(s)}</div></div>
    <div class="r"><div class="amt">${A.fmtMoney(amount)}</div>${A.pill(view)}</div></button>`;

  const info = (rows) => `<div class="list">${rows.filter(([, v]) => v).map(([k, v]) =>
    `<div class="cell static"><div class="main">${A.esc(k)}</div><div class="value" style="text-align:right;white-space:normal">${A.esc(v)}</div></div>`).join('')}</div>`;

  function detail(id) {
    if (st.tab === 'orders') {
      const o = orders.find((x) => x.id === id);
      A.sheet({ title: 'Заказ', left: 'Закрыть', body: `
        <div class="hero"><div class="amount">${A.fmtMoney(o.amount)}</div><div class="who">${A.pill(o.view)}</div></div>
        <div class="section-h"><span>Детали</span></div>
        ${info([['Магазин', o.store], ['№ заказа', o.order_no], ['Дата заказа', A.fmtDate(o.date)],
          ['Ожидаемый приход', A.fmtDate(o.expected)], ['Пришёл', A.fmtDate(o.delivered_at)], ['Комментарий', o.comment]])}` });
    } else {
      const p = payouts.find((x) => x.id === id);
      A.sheet({ title: 'Выплата', left: 'Закрыть', body: `
        <div class="hero"><div class="amount ${p.status === 'paid' ? 'paid' : ''}">${A.fmtMoney(p.amount)}</div><div class="who">${A.pill(A.payView(p.status))}</div></div>
        <div class="section-h"><span>Детали</span></div>
        ${info([['№ накладной', p.invoice_no], ['Дата', A.fmtDate(p.date)], ['Магазин', p.store], ['Основание', p.basis], ['Оплачено', A.fmtDate(p.paid_at)], ['Комментарий', p.comment]])}` });
    }
  }

  function render() { renderStats(); renderList(); }
  render();

  // Вернулись на вкладку через минуту и больше — показать свежие данные
  let shownAt = Date.now();
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && Date.now() - shownAt > 60000 && !document.querySelector('.sheet')) location.reload();
  });

  A.pullToRefresh(() => location.reload());
})();
