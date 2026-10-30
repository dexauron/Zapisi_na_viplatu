// Общая ссылка для всех торговых представителей: кто и на какое число записан на выплату (только невыплаченные)
(async function () {
  const A = window.App;
  const page = document.getElementById('page');
  A.navScroll(document.getElementById('nav'));
  document.getElementById('nav-title').textContent = 'Записи на выплату';

  const token = (location.hash.replace(/^#/, '') || new URLSearchParams(location.search).get('t') || '').trim();
  const fail = (t, s) => (page.innerHTML = A.emptyState(t, s));
  if (!token) return fail('Ссылка неполная', 'Попросите администратора прислать ссылку.');

  const { data, error } = await A.sb.rpc('get_payout_schedule', { p_token: token });
  if (error) return fail('Нет связи', 'Проверьте интернет и обновите страницу.');
  if (!data) return fail('Ссылка недействительна', 'Ссылка заменена. Обратитесь к администратору.');

  const rows = data;
  let q = '';
  page.innerHTML = `<div class="large-title">Записи на выплату</div>
    <div class="subtitle">${rows.length ? `${rows.length} ${plural(rows.length)} · ${A.fmtMoney(A.sum(rows))}` : ''}</div>
    ${A.searchBox('q', 'Имя или компания')}<div id="list"></div>`;
  const $ = (id) => document.getElementById(id);
  A.bindSearch($('q'), () => { q = $('q').value; render(); });

  function plural(n) { const m = n % 10, h = n % 100; return m === 1 && h !== 11 ? 'запись' : m >= 2 && m <= 4 && (h < 12 || h > 14) ? 'записи' : 'записей'; }
  function dayTitle(d) {
    const t = A.today();
    if (d < t) return 'Прошедшие даты';
    if (d === t) return 'Сегодня';
    if (d === A.addDays(t, 1)) return 'Завтра';
    const s = new Date(d + 'T12:00:00').toLocaleDateString('ru-RU', { weekday: 'short', day: 'numeric', month: 'long' });
    return s[0].toUpperCase() + s.slice(1);
  }

  function render() {
    const shown = rows.filter((r) => A.matches(q, r.rep, r.company));
    if (!shown.length) { $('list').innerHTML = A.emptyState(q ? 'Никого не нашли' : 'Записей нет', q ? 'Измените запрос' : 'Новые записи появятся здесь'); return; }
    let html = '';
    for (const [title, items] of A.groupBy(shown, (r) => dayTitle(r.date))) {
      html += `<div class="section-h ${title === 'Прошедшие даты' ? 'red' : ''}"><span>${A.esc(title)}</span><span>${items.length}</span></div><div class="list">`
        + items.map((r) => `<button class="cell" data-rep="${r.rep_id}"><div class="main"><div class="t"><b>${A.esc(r.rep)}</b></div>
            <div class="s">${A.esc([r.company, title === 'Прошедшие даты' ? A.fmtShort(r.date) : null].filter(Boolean).join(' · ') || ' ')}</div></div>
            <div class="r"><div class="amt">${A.fmtMoney(r.amount)}</div>${A.pill(A.PAY[r.status])}</div></button>`).join('') + '</div>';
    }
    $('list').innerHTML = html;
    $('list').querySelectorAll('[data-rep]').forEach((c) => c.addEventListener('click', () => card(c.dataset.rep)));
  }

  function cardDate(d) {
    const t = dayTitle(d);
    return t === 'Прошедшие даты' ? A.fmtDate(d) : t === 'Сегодня' || t === 'Завтра' ? `${t}, ${A.fmtShort(d)}` : t;
  }

  // Карточка представителя: все его записи на выплату
  function card(repId) {
    const items = rows.filter((r) => r.rep_id === repId);
    const r0 = items[0];
    A.sheet({ title: 'Записи', left: 'Закрыть', body: `
      <div class="hero"><div class="avatar" style="width:64px;height:64px;font-size:24px;margin:0 auto 8px">${A.esc(A.initials(r0.rep))}</div>
        <div style="font-size:20px;font-weight:700">${A.esc(r0.rep)}</div><div class="who">${A.esc(r0.company || '')}</div>
        <div class="amount" style="font-size:28px;margin-top:8px">${A.fmtMoney(A.sum(items))}</div></div>
      <div class="section-h"><span>Записи на выплату · ${items.length}</span></div>
      <div class="list">${items.map((r) => `<div class="cell static"><div class="main"><div class="t">${A.esc(cardDate(r.date))}</div>
        <div class="s">${A.esc([r.basis, r.store].filter(Boolean).join(' · ') || ' ')}</div></div>
        <div class="r"><div class="amt">${A.fmtMoney(r.amount)}</div>${A.pill(A.PAY[r.status])}</div></div>`).join('')}</div>` });
  }

  render();
  let shownAt = Date.now();
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && Date.now() - shownAt > 60000 && !document.querySelector('.sheet')) location.reload();
  });
})();
