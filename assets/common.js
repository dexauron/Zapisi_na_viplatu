(function () {
  const { SUPABASE_URL, SUPABASE_KEY } = window.APP_CONFIG;
  const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

  // ---------- форматирование ----------
  const money = new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', minimumFractionDigits: 2 });
  const fmtMoney = (v) => money.format(Number(v || 0));
  const toCents = (v) => Math.round(Number(v || 0) * 100);
  const sum = (rows) => rows.reduce((a, r) => a + toCents(r.amount), 0) / 100; // в копейках — без ошибок float
  const today = () => new Date().toLocaleDateString('sv-SE');
  const addDays = (iso, n) => { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n); return d.toLocaleDateString('sv-SE'); };
  const fmtDate = (d) => (d ? new Date(d.length === 10 ? d + 'T12:00:00' : d).toLocaleDateString('ru-RU') : '');
  const fmtShort = (d) => (d ? new Date(d + 'T12:00:00').toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }).replace('.', '') : '');
  const fmtMonth = (ym) => { const s = new Date(ym + '-01T12:00:00').toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' }); return s[0].toUpperCase() + s.slice(1).replace(' г.', ''); };
  const relDay = (d) => {
    if (!d) return '';
    const diff = Math.round((new Date(d + 'T12:00:00') - new Date(today() + 'T12:00:00')) / 864e5);
    if (diff === 0) return 'сегодня'; if (diff === 1) return 'завтра'; if (diff === -1) return 'вчера';
    return fmtShort(d);
  };
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const initials = (n) => String(n || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
  const norm = (s) => String(s ?? '').toLowerCase().replace(/ё/g, 'е');
  const matches = (q, ...fields) => { q = norm(q).trim(); if (!q) return true; const hay = norm(fields.join(' ')); return q.split(/\s+/).every((w) => hay.includes(w)); };

  // ---------- статусы ----------
  const PAY = {
    accrued: { label: 'Начислено', c: 'gray' },
    to_pay: { label: 'К выплате', c: 'blue' },
    paid: { label: 'Выплачено', c: 'green' },
  };
  const ORD = {
    ordered: { label: 'Ожидается', c: 'blue' },
    delivered: { label: 'Пришёл', c: 'green' },
    cancelled: { label: 'Отменён', c: 'gray' },
  };
  // Отображаемый статус заказа с учётом даты прихода
  function orderView(o) {
    if (o.status === 'ordered' && o.expected) {
      if (o.expected < today()) return { label: 'Просрочен', c: 'red', key: 'late' };
      if (o.expected === today()) return { label: 'Сегодня', c: 'gray', key: 'today' };
    }
    return { ...ORD[o.status], key: o.status };
  }
  // Одна короткая фраза о сроке заказа для строки списка
  function orderWhen(o) {
    if (o.status === 'cancelled') return 'отменён';
    if (o.status === 'delivered') return 'пришёл ' + relDay(o.delivered_at?.slice(0, 10));
    if (!o.expected) return 'без даты прихода';
    const late = Math.round((new Date(today() + 'T12:00:00') - new Date(o.expected + 'T12:00:00')) / 864e5);
    return late > 0 ? `просрочен на ${late} дн.` : 'приход ' + relDay(o.expected);
  }
  const pill = (v) => `<span class="pill c-${v.c}">${esc(v.label)}</span>`;

  // ---------- группировка ----------
  function groupBy(rows, keyFn) {
    const m = new Map();
    for (const r of rows) { const k = keyFn(r); if (!m.has(k)) m.set(k, []); m.get(k).push(r); }
    return m;
  }

  // ---------- тост ----------
  let toastEl, toastT;
  function toast(text, err = false) {
    if (!toastEl) { toastEl = document.createElement('div'); toastEl.className = 'toast'; document.body.append(toastEl); }
    toastEl.textContent = text; toastEl.classList.toggle('err', err);
    requestAnimationFrame(() => toastEl.classList.add('show'));
    clearTimeout(toastT); toastT = setTimeout(() => toastEl.classList.remove('show'), err ? 4000 : 2200);
  }

  // ---------- лист снизу ----------
  let current = null;
  function sheet({ title = '', left = 'Отмена', right = null, body = '', onMount }) {
    if (current) current.close(true);
    const back = document.createElement('div'); back.className = 'sheet-back';
    const el = document.createElement('div'); el.className = 'sheet'; el.setAttribute('role', 'dialog');
    el.innerHTML = `<div class="sheet-bar"><div class="grab"></div>
        <button class="nav-btn" data-x="left">${esc(left || '')}</button><h3>${esc(title)}</h3>
        <button class="nav-btn right done" data-x="right">${esc(right?.label || '')}</button></div>
      <div class="sheet-body">${body}</div>`;
    document.body.append(back, el);
    document.body.style.overflow = 'hidden';
    requestAnimationFrame(() => { back.classList.add('open'); el.classList.add('open'); });
    const api = {
      el, body: el.querySelector('.sheet-body'),
      close(instant) {
        if (current === api) current = null;
        document.body.style.overflow = '';
        back.classList.remove('open'); el.classList.remove('open');
        setTimeout(() => { back.remove(); el.remove(); }, instant ? 0 : 320);
      },
      busy(on) { el.querySelectorAll('button').forEach((b) => (b.disabled = on)); },
    };
    back.addEventListener('click', () => api.close());
    el.querySelector('[data-x=left]').addEventListener('click', () => api.close());
    const rb = el.querySelector('[data-x=right]');
    if (right) rb.addEventListener('click', () => right.onClick(api)); else rb.style.visibility = 'hidden';
    // свайп вниз закрывает
    let y0 = null;
    el.querySelector('.sheet-bar').addEventListener('touchstart', (e) => (y0 = e.touches[0].clientY), { passive: true });
    el.querySelector('.sheet-bar').addEventListener('touchend', (e) => { if (y0 != null && e.changedTouches[0].clientY - y0 > 60) api.close(); y0 = null; });
    current = api;
    onMount && onMount(api);
    return api;
  }

  // ---------- шапка: заголовок появляется при прокрутке ----------
  function navScroll(nav) {
    const on = () => nav.classList.toggle('scrolled', window.scrollY > 40);
    window.addEventListener('scroll', on, { passive: true }); on();
  }

  const ICON = {
    search: '<svg viewBox="0 0 24 24"><path d="M10 2a8 8 0 0 1 6.32 12.9l5.39 5.4-1.41 1.41-5.4-5.39A8 8 0 1 1 10 2Zm0 2a6 6 0 1 0 0 12 6 6 0 0 0 0-12Z"/></svg>',
  };
  function searchBox(id, placeholder = 'Поиск') {
    return `<div class="search">${ICON.search}<input id="${id}" type="search" placeholder="${esc(placeholder)}" autocomplete="off" enterkeyhint="search">
      <button class="clear hidden" type="button" aria-label="Очистить">✕</button></div>`;
  }
  function bindSearch(input, onChange) {
    const clear = input.parentElement.querySelector('.clear');
    let t;
    input.addEventListener('input', () => { clear.classList.toggle('hidden', !input.value); clearTimeout(t); t = setTimeout(onChange, 120); });
    clear.addEventListener('click', () => { input.value = ''; clear.classList.add('hidden'); onChange(); input.focus(); });
  }

  function emptyState(title, text = '') { return `<div class="empty"><div class="big">${esc(title)}</div>${esc(text)}</div>`; }

  window.App = { sb, fmtMoney, toCents, sum, today, addDays, fmtDate, fmtShort, fmtMonth, relDay, esc, initials, matches,
    PAY, ORD, orderView, orderWhen, pill, groupBy, toast, sheet, navScroll, searchBox, bindSearch, emptyState, ICON };
})();
