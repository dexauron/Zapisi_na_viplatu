(function () {
  const { SUPABASE_URL, SUPABASE_KEY } = window.APP_CONFIG;
  // Страницы по ссылке (кабинет ТП, общий график) всегда работают как гость: даже если в этом браузере
  // выполнен вход в приложение, сохранённая сессия сотрудника не должна подменять доступ по ссылке.
  const sb = window.APP_ANON
    ? window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } })
    : window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

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

  // ---------- поиск как в поисковике ----------
  // Слова и части слов в любом порядке; латиница = кириллица (Abdulla = Абдулла, Akhmed = Ахмед);
  // набрано не в той раскладке (F,lekkf = Абдулла); опечатка в одну букву; цифры телефона без скобок и дефисов.
  const CYR = { а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ж: 'j', з: 'z', и: 'i', й: 'i', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o',
    п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sh', ъ: '', ы: 'i', ь: '', э: 'e', ю: 'iu', я: 'ia', і: 'i' };
  const KB_EN = "`qwertyuiop[]asdfghjkl;'zxcvbnm,.", KB_RU = 'ёйцукенгшщзхъфывапролджэячсмитьбю';
  const swapLayout = (s) => [...s].map((c) => { let i = KB_EN.indexOf(c); if (i >= 0) return KB_RU[i]; i = KB_RU.indexOf(c); return i >= 0 ? KB_EN[i] : c; }).join('');
  // Приводит русское и латинское написание к одному виду: «Абдуллах», «Abdullakh», «Abdulla h» → abdulah
  function canon(s) {
    return norm(s).replace(/[а-яі]/g, (c) => CYR[c] ?? c)
      .replace(/shch|sch/g, 'sh').replace(/dzh|dj|zh/g, 'j').replace(/kh/g, 'h').replace(/ck|q/g, 'k').replace(/c(?!h)/g, 'k')
      .replace(/ts|tz/g, 'q').replace(/ph/g, 'f').replace(/w/g, 'v').replace(/x/g, 'ks').replace(/y/g, 'i')
      .replace(/(^|[^a-z])ie/g, '$1e').replace(/[^a-z0-9]+/g, ' ').replace(/([a-z])\1(?!\1)/g, '$1').trim();
  }
  // Расстояние Дамерау — Левенштейна (сколько букв поправить), с ранним выходом
  function dist(a, b, max) {
    if (Math.abs(a.length - b.length) > max) return max + 1;
    let p2 = null, p = Array.from({ length: b.length + 1 }, (_, j) => j);
    for (let i = 1; i <= a.length; i++) {
      const c = [i]; let best = i;
      for (let j = 1; j <= b.length; j++) {
        c[j] = Math.min(p[j] + 1, c[j - 1] + 1, p[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
        if (p2 && i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) c[j] = Math.min(c[j], p2[j - 2] + 1);
        best = Math.min(best, c[j]);
      }
      if (best > max) return max + 1;
      p2 = p; p = c;
    }
    return p[b.length];
  }
  const hayCache = new Map();
  function hayOf(fields) {
    const key = fields.join('\u0001');
    let h = hayCache.get(key);
    if (h) return h;
    const digits = fields.map((f) => String(f ?? '').replace(/\D/g, '')).filter((d) => d.length > 2);
    h = { s: ' ' + canon(fields.join(' ')) + ' ' + digits.join(' ') + ' ' };
    h.words = h.s.trim().split(' ');
    if (hayCache.size > 8000) hayCache.clear();
    hayCache.set(key, h);
    return h;
  }
  let lastQ = null, lastPrep = null;
  function prepQuery(q) {
    if (q === lastQ) return lastPrep;
    lastQ = q;
    lastPrep = norm(q).split(/\s+/).filter(Boolean)
      .map((t) => [...new Set([canon(t), canon(swapLayout(t))])].filter(Boolean))
      .filter((v) => v.length);
    return lastPrep;
  }
  function wordScore(w, h) {
    if (h.s.includes(' ' + w)) return 3;           // начало слова
    if (h.s.includes(w)) return 2;                 // часть слова
    if (w.length < 4 || /^\d+$/.test(w)) return 0;
    const max = w.length >= 8 ? 2 : 1;              // опечатка
    for (const x of h.words) {
      if (x.length < w.length - 1) continue;
      for (const L of [w.length, w.length - 1, w.length + 1]) if (dist(w, x.slice(0, L), max) <= max) return 1;
    }
    return 0;
  }
  function scoreHay(prep, h) {
    let s = 0;
    for (const variants of prep) {
      let best = 0;
      // сначала как набрано; другая раскладка — только если так не нашлось и набрано хотя бы 3 знака
      for (let k = 0; k < variants.length && !best; k++) {
        const v = variants[k];
        if (k && v.replace(/ /g, '').length < 3) break;
        let vs = 0;
        for (const w of v.split(' ')) { const x = wordScore(w, h); if (!x) { vs = 0; break; } vs += x; }
        best = k ? vs / 2 : vs;
      }
      if (!best) return 0;
      s += best;
    }
    return s;
  }
  // Буквы по порядку внутри названия: «абдл» → Абдулла (запасной вариант, если ничего не нашлось)
  function subseq(prep, h) {
    if (prep.length !== 1) return false;
    return prep[0].some((v) => {
      if (v.length < 3 || v.includes(' ') || /^\d+$/.test(v)) return false; // цифры (номера, суммы) — только точно
      for (const x of h.words) {
        if (x[0] !== v[0]) continue;
        let i = 1; for (let j = 1; j < x.length && i < v.length; j++) if (x[j] === v[i]) i++;
        if (i === v.length) return true;
      }
      return false;
    });
  }
  const matches = (q, ...fields) => { const p = prepQuery(String(q ?? '').trim()); return !p.length || scoreHay(p, hayOf(fields)) > 0; };
  // Отбор и сортировка по похожести: лучшие совпадения сверху
  function rank(q, items, fieldsOf) {
    const p = prepQuery(String(q ?? '').trim());
    if (!p.length) return items;
    const scored = [];
    items.forEach((it, i) => { const s = scoreHay(p, hayOf(fieldsOf(it))); if (s) scored.push([s, i, it]); });
    if (!scored.length) items.forEach((it, i) => { if (subseq(p, hayOf(fieldsOf(it)))) scored.push([0.5, i, it]); });
    return scored.sort((a, b) => b[0] - a[0] || a[1] - b[1]).map((x) => x[2]);
  }
  // Подсветка совпавших частей (когда запрос набран теми же буквами, что и текст)
  function mark(text, q) {
    text = String(text ?? '');
    const lo = norm(text), spans = [];
    for (const t of norm(q).split(/\s+/).filter(Boolean)) {
      for (const v of new Set([t, swapLayout(t)])) {
        let i = lo.indexOf(v);
        while (v && i >= 0) { spans.push([i, i + v.length]); i = lo.indexOf(v, i + v.length); }
      }
    }
    if (!spans.length) return esc(text);
    spans.sort((a, b) => a[0] - b[0]);
    let out = '', at = 0;
    for (const [a, b] of spans) {
      if (b <= at) continue;
      const s = Math.max(a, at);
      out += esc(text.slice(at, s)) + '<mark>' + esc(text.slice(s, b)) + '</mark>'; at = b;
    }
    return out + esc(text.slice(at));
  }

  // ---------- статусы ----------
  // Выплата: «Запись» (ещё не оплачено) или «Оплачено». Старое «Начислено/К выплате» = «Запись».
  const PAY = {
    to_pay: { label: 'Запись', c: 'orange' },
    paid: { label: 'Оплачено', c: 'green' },
  };
  const payView = (s) => PAY[s === 'paid' ? 'paid' : 'to_pay'];
  // Номер накладной для людей — входящий номер поставщика. У ручных накладных его нет: «б/н».
  // Внутренний номер 1С (ПФ…) в списках не показывается — только в подробностях документа.
  const docNo = (d) => (d?.in_no ? '№ ' + d.in_no : d?.kind === 'in' ? 'б/н' : '');
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
  // action = { label: 'Вернуть', run } — кнопка отмены, тост держится 5 секунд
  function toast(text, err = false, action = null) {
    if (!toastEl) { toastEl = document.createElement('div'); toastEl.className = 'toast'; document.body.append(toastEl); }
    toastEl.innerHTML = `<span>${esc(text)}</span>${action ? `<button type="button">${esc(action.label)}</button>` : ''}`;
    toastEl.classList.toggle('err', err); toastEl.classList.toggle('has-action', !!action);
    if (action) toastEl.querySelector('button').addEventListener('click', () => { toastEl.classList.remove('show'); clearTimeout(toastT); action.run(); }, { once: true });
    requestAnimationFrame(() => toastEl.classList.add('show'));
    clearTimeout(toastT); toastT = setTimeout(() => toastEl.classList.remove('show'), action ? 5000 : err ? 4000 : 2200);
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
    // Лист тянется пальцем вниз (за шапку или когда содержимое прокручено до верха) и закрывается
    let y0 = null, t0 = 0, dy = 0, drag = false;
    const bodyEl = el.querySelector('.sheet-body');
    el.addEventListener('touchstart', (e) => {
      if (window.innerWidth >= 760) return;
      const onBar = e.target.closest('.sheet-bar');
      if (!onBar && bodyEl.scrollTop > 0) return;
      if (e.target.closest('input, textarea, select')) return;
      y0 = e.touches[0].clientY; t0 = Date.now(); dy = 0; drag = false;
    }, { passive: true });
    el.addEventListener('touchmove', (e) => {
      if (y0 == null) return;
      dy = e.touches[0].clientY - y0;
      if (!drag && dy > 8 && (e.target.closest('.sheet-bar') || bodyEl.scrollTop <= 0)) { drag = true; el.style.transition = 'none'; }
      if (drag) { e.preventDefault(); el.style.transform = `translateY(${Math.max(0, dy)}px)`; back.style.opacity = String(Math.max(0, 1 - dy / 500)); }
    }, { passive: false });
    el.addEventListener('touchend', () => {
      if (y0 == null) return;
      const fast = dy / Math.max(1, Date.now() - t0) > 0.5;
      el.style.transition = ''; back.style.opacity = '';
      if (drag && (dy > 140 || (fast && dy > 40))) { el.style.transform = 'translateY(100%)'; haptic(); api.close(); }
      else el.style.transform = '';
      y0 = null; drag = false;
    });
    current = api;
    onMount && onMount(api);
    return api;
  }

  // ---------- оформление: light | dark | auto ----------
  function setTheme(t) {
    document.documentElement.dataset.theme = t;
    try { localStorage.setItem('theme', t); } catch { /* приватный режим */ }
    const dark = t === 'dark' || (t === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
    document.querySelector('meta[name=theme-color]')?.setAttribute('content', dark ? '#000000' : '#f2f2f7');
  }
  const getTheme = () => document.documentElement.dataset.theme || 'light';

  // ---------- отклик: короткая вибрация (Android); на iPhone браузер её не поддерживает ----------
  function haptic(ms = 8) { try { navigator.vibrate?.(ms); } catch { /* нет поддержки */ } }

  // ---------- свайп строки влево: действия как в «Почте» iOS ----------
  // getActions(cell) → [{ label, color, run }]; полный свайп выполняет первое действие
  function swipeRows(root, getActions) {
    let cell = null, layer = null, x0 = 0, y0 = 0, dx = 0, mode = null, width = 0, acts = [];
    const close = (c) => { if (!c) return; c.style.transition = 'transform .25s'; c.style.transform = ''; c._open = false;
      setTimeout(() => { c.parentElement?.querySelector('.swipe-layer')?.remove(); c.style.transition = ''; }, 260); };
    root.addEventListener('touchstart', (e) => {
      const c = e.target.closest('.cell[data-id], .cell[data-pay]');
      root.querySelectorAll('.cell').forEach((x) => { if (x._open && x !== c) close(x); });
      if (!c) return;
      acts = getActions(c) || []; if (!acts.length) return;
      cell = c; x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; dx = c._open ? -width : 0; mode = null;
    }, { passive: true });
    root.addEventListener('touchmove', (e) => {
      if (!cell) return;
      const mx = e.touches[0].clientX - x0, my = e.touches[0].clientY - y0;
      if (!mode) { if (Math.abs(mx) < 8 && Math.abs(my) < 8) return; mode = Math.abs(mx) > Math.abs(my) ? 'x' : 'y'; }
      if (mode !== 'x') return;
      e.preventDefault();
      if (!layer || !layer.isConnected) {
        cell.parentElement.style.position = 'relative';
        layer = document.createElement('div'); layer.className = 'swipe-layer';
        layer.style.top = cell.offsetTop + 'px'; layer.style.height = cell.offsetHeight + 'px';
        layer.innerHTML = acts.map((a, i) => `<button data-i="${i}" style="background:var(--${a.color})">${esc(a.label)}</button>`).join('');
        cell.parentElement.insertBefore(layer, cell);
        layer.addEventListener('click', (ev) => { const i = ev.target.closest('[data-i]')?.dataset.i; if (i != null) { haptic(); acts[i].run(); close(cell); } });
        width = 88 * acts.length;
      }
      dx = Math.min(0, (cell._open ? -width : 0) + mx);
      cell.style.transition = 'none'; cell.style.transform = `translateX(${dx}px)`;
      layer.classList.toggle('full', dx < -cell.offsetWidth * 0.6);
    }, { passive: false });
    root.addEventListener('touchend', () => {
      if (!cell) return;
      const c = cell; cell = null;
      if (mode !== 'x') return;
      c.style.transition = 'transform .25s';
      if (dx < -c.offsetWidth * 0.6) { haptic(12); c.style.transform = 'translateX(-100%)'; setTimeout(() => { acts[0].run(); close(c); }, 200); }
      else if (dx < -width / 2) { c.style.transform = `translateX(${-width}px)`; c._open = true; }
      else close(c);
      // после свайпа не открывать карточку
      const block = (ev) => { ev.stopImmediatePropagation(); ev.preventDefault(); };
      c.addEventListener('click', block, { capture: true, once: true });
      setTimeout(() => c.removeEventListener('click', block, { capture: true }), 400);
    });
  }

  // ---------- «потянуть вниз, чтобы обновить» ----------
  function pullToRefresh(onRefresh) {
    const ind = document.createElement('div'); ind.className = 'ptr'; ind.innerHTML = '<div class="ptr-spin"></div>'; document.body.append(ind);
    let y0 = null, dy = 0, busy = false;
    document.addEventListener('touchstart', (e) => {
      if (busy || window.scrollY > 0 || document.querySelector('.sheet') || e.target.closest('.tabbar, .cal')) { y0 = null; return; }
      y0 = e.touches[0].clientY; dy = 0;
    }, { passive: true });
    document.addEventListener('touchmove', (e) => {
      if (y0 == null) return;
      dy = e.touches[0].clientY - y0;
      if (dy <= 0 || window.scrollY > 0) { ind.style.transform = ''; return; }
      const d = Math.min(90, dy * 0.5);
      ind.style.opacity = String(Math.min(1, d / 60)); ind.style.transform = `translate(-50%, ${d}px) rotate(${d * 4}deg)`;
      ind.classList.toggle('ready', d >= 60);
    }, { passive: true });
    document.addEventListener('touchend', async () => {
      if (y0 == null) return; y0 = null;
      if (dy * 0.5 >= 60) {
        busy = true; haptic(); ind.classList.add('spin'); ind.style.transform = 'translate(-50%, 60px)';
        try { await onRefresh(); } finally { busy = false; }
      }
      ind.classList.remove('spin', 'ready'); ind.style.transform = ''; ind.style.opacity = '0';
    });
  }

  // ---------- горизонтальный свайп по элементу (календарь: месяцы) ----------
  function swipeX(el, onLeft, onRight) {
    let x0 = null, y0 = 0;
    el.addEventListener('touchstart', (e) => { x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; }, { passive: true });
    el.addEventListener('touchend', (e) => {
      if (x0 == null) return;
      const dx = e.changedTouches[0].clientX - x0, dy = e.changedTouches[0].clientY - y0; x0 = null;
      if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) { haptic(); (dx < 0 ? onLeft : onRight)(); }
    });
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

  window.App = { sb, fmtMoney, toCents, sum, today, addDays, fmtDate, fmtShort, fmtMonth, relDay, esc, initials, matches, rank, mark, canon,
    PAY, payView, docNo, ORD, orderView, orderWhen, pill, groupBy, toast, sheet, haptic, swipeRows, pullToRefresh, swipeX, setTheme, getTheme, navScroll, searchBox, bindSearch, emptyState, ICON };
})();
