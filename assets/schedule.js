// Общая ссылка для всех торговых представителей: кто и на какое число записан на выплату (только невыплаченные)
(async function () {
  const A = window.App;
  const page = document.getElementById('page');
  A.navScroll(document.getElementById('nav'));
  document.getElementById('nav-title').textContent = 'Записи на выплату';

  // Страницу открыли из приложения («Ещё» → «Открыть»). На телефоне приложение идёт без адресной
  // строки браузера, поэтому вернуться назад нечем — даём свою кнопку.
  // По ссылке из WhatsApp метки нет и кнопки не будет: представителю возвращаться некуда.
  if (new URLSearchParams(location.search).get('from') === 'app') {
    const back = document.createElement('button');
    back.type = 'button';
    back.className = 'nav-btn';
    back.textContent = '\u2039 Назад';
    back.addEventListener('click', () => { location.href = 'app.html'; });
    document.querySelector('#nav .nav-inner').firstElementChild.replaceWith(back);
  }

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
    ${A.searchBox('q', 'Имя, компания, № накладной')}<div id="list"></div>`;
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

  // Сегодня → завтра → будущие даты → прошедшие (в конце). Внутри даты: ИП с 2+ записями — веткой.
  const coKey = (c) => String(c || '').toLowerCase().replace(/ё/g, 'е').replace(/[\s.,«»"']+/g, '');
  const row = (r, child, past) => `<button class="cell ${child ? 'child' : ''}" data-rep="${r.rep_id}"><div class="main"><div class="t"><b>${A.esc(r.rep)}</b></div>
      <div class="s">${A.esc([child ? '' : r.company, r.invoice_no && '№ ' + r.invoice_no, past ? A.fmtShort(r.date) : null].filter(Boolean).join(' · ') || ' ')}</div></div>
      <div class="r"><div class="amt">${A.fmtMoney(r.amount)}</div>${A.pill(A.payView(r.status))}</div></button>`;
  function tree(items, past) {
    const nodes = new Map();
    for (const r of items) { const k = r.company ? 'c:' + coKey(r.company) : 'r:' + r.id; if (!nodes.has(k)) nodes.set(k, { co: r.company, items: [] }); nodes.get(k).items.push(r); }
    const flat = [];
    for (const n of nodes.values()) {
      if (n.co && n.items.length >= 2) flat.push({ name: n.co, n });
      else for (const r of n.items) flat.push({ name: r.rep, r });
    }
    flat.sort((a, b) => a.name.localeCompare(b.name, 'ru'));
    return flat.map((x) => (x.r ? row(x.r, false, past)
      : `<div class="tgrp"><button type="button" class="cell co-h"><div class="avatar co-ic">${A.esc(A.initials(x.n.co.replace(/^(ИП|ООО|ОАО|ЗАО|ТД)\s+/i, '')))}</div>
          <div class="main"><div class="t"><b>${A.esc(x.n.co)}</b></div><div class="s">${new Set(x.n.items.map((r) => r.rep_id)).size} торг. · ${x.n.items.length} ${plural(x.n.items.length)}</div></div>
          <div class="r"><div class="amt">${A.fmtMoney(A.sum(x.n.items))}</div></div><span class="chev">›</span></button>${x.n.items.map((r) => row(r, true, past)).join('')}</div>`)).join('');
  }
  function render() {
    const shown = rows.filter((r) => A.matches(q, r.rep, r.company, r.invoice_no));
    if (!shown.length) { $('list').innerHTML = A.emptyState(q ? 'Никого не нашли' : 'Записей нет', q ? 'Измените запрос' : 'Новые записи появятся здесь'); return; }
    let html = '', sep = false;
    for (const g of A.dayGroups(shown, (r) => r.date)) {
      if (g.past && !sep) { html += '<div class="past-sep"><span>Прошедшие даты</span></div>'; sep = true; }
      html += `<div class="section-h ${g.past ? 'red' : ''} ${g.today ? 'today' : ''}"><span>${A.esc(g.title)}</span><span>${g.items.length}</span></div><div class="list">${tree(g.items, g.past)}</div>`;
    }
    $('list').innerHTML = html;
    $('list').querySelectorAll('[data-rep]').forEach((c) => c.addEventListener('click', () => card(c.dataset.rep)));
    $('list').querySelectorAll('.co-h').forEach((h) => h.addEventListener('click', () => { h.closest('.tgrp').classList.toggle('closed'); A.haptic(); }));
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
        <div class="s">${A.esc([r.invoice_no && 'Накладная № ' + r.invoice_no, r.basis, r.store].filter(Boolean).join(' · ') || ' ')}</div></div>
        <div class="r"><div class="amt">${A.fmtMoney(r.amount)}</div>${A.pill(A.payView(r.status))}</div></div>`).join('')}</div>` });
  }

  render();
  let shownAt = Date.now();
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && Date.now() - shownAt > 60000 && !document.querySelector('.sheet')) location.reload();
  });

  A.pullToRefresh(() => location.reload());
})();
