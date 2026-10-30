(async function () {
  const { sb, STATUS, fmtMoney, fmtDate, fmtMonth, esc, badge, sumBy } = window.App;
  const $ = (id) => document.getElementById(id);

  // Токен берётся из #фрагмента ссылки (не уходит на сервер и в логи); ?t= — запасной вариант
  const token = (location.hash.replace(/^#/, '') || new URLSearchParams(location.search).get('t') || '').trim();

  const fail = (text) => { $('sub').textContent = ''; $('list').innerHTML = `<div class="empty">${esc(text)}</div>`; };
  if (!token) return fail('Ссылка неполная. Попросите администратора прислать персональную ссылку.');

  const { data, error } = await sb.rpc('get_rep_payouts', { p_token: token });
  if (error) return fail('Не удалось загрузить данные. Проверьте интернет и обновите страницу.');
  if (!data) return fail('Ссылка недействительна или доступ отключён. Обратитесь к администратору.');

  const rows = data.payouts;
  let filter = null;
  $('title').textContent = data.rep.full_name;
  $('sub').textContent = `Записей: ${rows.length}`;

  function renderTotals() {
    const cards = [
      [null, 'Всего', sumBy(rows, () => true)],
      ...Object.keys(STATUS).map((k) => [k, STATUS[k].label, sumBy(rows, (r) => r.status === k)]),
    ];
    $('totals').innerHTML = cards.map(([k, label, v]) =>
      `<div class="total ${filter === k ? 'active' : ''}" data-k="${k ?? ''}">
         <div class="muted small">${esc(label)}</div><div class="v">${fmtMoney(v)}</div></div>`).join('');
    $('totals').classList.remove('hidden');
    $('totals').querySelectorAll('.total').forEach((el) =>
      el.addEventListener('click', () => { filter = el.dataset.k || null; render(); }));
  }

  function renderList() {
    const shown = rows.filter((r) => !filter || r.status === filter);
    if (!shown.length) { $('list').innerHTML = '<div class="empty">Записей нет</div>'; return; }
    const groups = new Map();
    for (const r of shown) {
      const key = r.date.slice(0, 7);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(r);
    }
    let html = '';
    for (const [key, items] of groups) {
      html += `<div class="month"><span>${esc(fmtMonth(key + '-01'))}</span><span>${fmtMoney(sumBy(items, () => true))}</span></div>`;
      for (const r of items) {
        const note = [r.basis, r.comment].filter(Boolean).map(esc).join(' · ');
        html += `<div class="item">
          <div><div><b>${esc(r.store || 'Без магазина')}</b></div>
            <div class="muted small">${fmtDate(r.date)}${r.paid_at ? ' · выплачено ' + fmtDate(r.paid_at.slice(0, 10)) : ''}</div>
            ${note ? `<div class="note">${note}</div>` : ''}</div>
          <div><div class="amt">${fmtMoney(r.amount)}</div><div style="text-align:right;margin-top:4px">${badge(r.status)}</div></div>
        </div>`;
      }
    }
    $('list').innerHTML = html;
  }

  function render() { renderTotals(); renderList(); }
  render();
})();
