// Акт сверки взаиморасчётов в PDF. Модуль PDF (jsPDF) и шрифт PT Sans грузятся только при первом акте.
// Используется в карточке поставщика (app.js) и в кабинете представителя по ссылке (rep.js).
(function () {
  const A = window.App;
  const V = ((document.currentScript && document.currentScript.src) || '').match(/[?&]v=([^&]+)/)?.[1] || '';
  const asset = (p) => new URL(p + (V ? '?v=' + V : ''), location.href).href;

  let ready = null;
  function load() {
    if (ready) return ready;
    ready = (async () => {
      if (!window.jspdf) {
        await new Promise((res, rej) => {
          const s = document.createElement('script'); s.src = asset('vendor/jspdf.umd.min.js');
          s.onload = res; s.onerror = () => rej(new Error('Не удалось загрузить модуль PDF — проверьте интернет'));
          document.head.append(s);
        });
      }
      const font = async (f) => {
        const r = await fetch(asset('vendor/fonts/' + f));
        if (!r.ok) throw new Error('Не удалось загрузить шрифт для PDF');
        const b = new Uint8Array(await r.arrayBuffer()); let s = '';
        for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000));
        return btoa(s);
      };
      const [reg, bold] = await Promise.all([font('PTSans-Regular.ttf'), font('PTSans-Bold.ttf')]);
      return { reg, bold };
    })().catch((e) => { ready = null; throw e; });
    return ready;
  }

  const cents = (v) => Math.round(Number(v || 0) * 100);
  const money = (c) => (c / 100).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const dmy = (iso) => (iso ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}` : '');

  // Название документа в акте
  function docName(d) {
    if (d.kind === 'in') return 'Приходная накладная ' + (d.in_no ? '№ ' + d.in_no : 'б/н');
    if (d.kind === 'pay') return 'Оплата' + (d.basisNo ? ' по накладной ' + d.basisNo : '');
    if (d.kind === 'ret') return 'Возврат поставщику';
    return d.title || 'Документ';
  }

  // Расчёт: остаток на начало, строки периода с нарастающим долгом, обороты, остаток на конец (в копейках)
  function calc(docs, base, from, to) {
    const list = docs.filter((d) => !d.deleted).map((d) => ({ ...d, day: d.at.slice(0, 10) })).sort((a, b) => a.at.localeCompare(b.at));
    let bal = cents(base);
    for (const d of list) if (d.day < from) bal += cents(d.inc) - cents(d.dec);
    const opening = bal; let inc = 0, dec = 0;
    const rows = [];
    for (const d of list) {
      if (d.day < from || d.day > to) continue;
      inc += cents(d.inc); dec += cents(d.dec); bal += cents(d.inc) - cents(d.dec);
      rows.push({ day: d.day, name: docName(d), inc: cents(d.inc), dec: cents(d.dec), bal });
    }
    return { opening, rows, inc, dec, closing: bal };
  }

  async function makePdf({ party, store, from, to, c }) {
    const f = await load();
    const pdf = new window.jspdf.jsPDF({ unit: 'mm', format: 'a4' });
    pdf.addFileToVFS('PTSans-Regular.ttf', f.reg); pdf.addFont('PTSans-Regular.ttf', 'PT', 'normal');
    pdf.addFileToVFS('PTSans-Bold.ttf', f.bold); pdf.addFont('PTSans-Bold.ttf', 'PT', 'bold');
    const M = 14, X = [M, M + 22, M + 92, M + 122, M + 152, M + 182]; // дата | документ | приход | оплата | долг
    let y = 18;
    pdf.setFont('PT', 'bold'); pdf.setFontSize(15);
    pdf.text('Акт сверки взаиморасчётов', 105, y, { align: 'center' }); y += 7;
    pdf.setFont('PT', 'normal'); pdf.setFontSize(10.5);
    pdf.text(`за период с ${dmy(from)} по ${dmy(to)}`, 105, y, { align: 'center' }); y += 6;
    for (const line of pdf.splitTextToSize(`между ${store} и ${party}`, 182)) { pdf.text(line, 105, y, { align: 'center' }); y += 5; }
    y += 4;
    const head = () => {
      pdf.setFillColor(238, 238, 242); pdf.rect(M, y - 4.5, 182, 7, 'F');
      pdf.setFont('PT', 'bold'); pdf.setFontSize(9);
      pdf.text('Дата', X[0] + 1, y); pdf.text('Документ', X[1] + 1, y);
      pdf.text('Приход', X[3] - 1, y, { align: 'right' }); pdf.text('Оплата, возврат', X[4] - 1, y, { align: 'right' });
      pdf.text('Долг магазина', X[5] - 1, y, { align: 'right' });
      pdf.setFont('PT', 'normal'); y += 6;
    };
    const line = () => { pdf.setDrawColor(220, 220, 225); pdf.line(M, y - 3.8, M + 182, y - 3.8); };
    const row = (date, name, inc, dec, bal, bold) => {
      const lines = pdf.splitTextToSize(name, 68);
      const h = Math.max(1, lines.length) * 4.2 + 1.6;
      if (y + h > 280) { pdf.addPage(); y = 18; head(); }
      line(); pdf.setFont('PT', bold ? 'bold' : 'normal'); pdf.setFontSize(9);
      if (date) pdf.text(date, X[0] + 1, y);
      pdf.text(lines, X[1] + 1, y);
      if (inc != null) pdf.text(inc ? money(inc) : '', X[3] - 1, y, { align: 'right' });
      if (dec != null) pdf.text(dec ? money(dec) : '', X[4] - 1, y, { align: 'right' });
      if (bal != null) pdf.text(money(bal), X[5] - 1, y, { align: 'right' });
      y += h;
    };
    head();
    row('', 'Сальдо на начало периода', null, null, c.opening, true);
    for (const r of c.rows) row(dmy(r.day), r.name, r.inc, r.dec, r.bal);
    row('', 'Обороты за период', c.inc, c.dec, null, true);
    row('', 'Сальдо на конец периода', null, null, c.closing, true);
    line();
    y += 6; if (y > 255) { pdf.addPage(); y = 20; }
    pdf.setFont('PT', 'normal'); pdf.setFontSize(10.5);
    const res = c.closing > 0 ? `На ${dmy(to)} задолженность магазина перед поставщиком: ${money(c.closing)} ₽.`
      : c.closing < 0 ? `На ${dmy(to)} задолженность поставщика перед магазином: ${money(-c.closing)} ₽.` : `На ${dmy(to)} задолженности нет.`;
    for (const l of pdf.splitTextToSize(res, 182)) { pdf.text(l, M, y); y += 5.5; }
    y += 12;
    pdf.text('Магазин', M, y); pdf.text('Поставщик', 110, y); y += 10;
    pdf.line(M, y, M + 70, y); pdf.line(110, y, 110 + 70, y);
    pdf.setFontSize(8); pdf.text('подпись', M, y + 4); pdf.text('подпись', 110, y + 4);
    const n = pdf.getNumberOfPages(), made = dmy(A.today());
    for (let i = 1; i <= n; i++) {
      pdf.setPage(i); pdf.setFontSize(8); pdf.setTextColor(140);
      pdf.text(`Сформировано ${made} в приложении «Сверка» по данным 1С · стр. ${i} из ${n}`, 105, 290, { align: 'center' });
      pdf.setTextColor(0);
    }
    return pdf.output('blob');
  }

  // Отправить (WhatsApp, почта — через «Поделиться») или скачать
  async function deliver(blob, name, share) {
    const file = typeof File === 'function' ? new File([blob], name, { type: 'application/pdf' }) : null;
    if (share && file && navigator.canShare?.({ files: [file] })) {
      try { await navigator.share({ files: [file], title: name }); return true; } catch (e) { if (e.name === 'AbortError') return false; }
    }
    const url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = name; document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    return true;
  }

  // Лист выбора периода. docs: [{at, kind, title, in_no, inc, dec, basisNo?}], base — долг до первого документа в docs
  function open({ party, store = 'магазином', docs, base = 0, minDate = null }) {
    const t = A.today(), first = docs.reduce((m, d) => (!m || d.at < m ? d.at : m), null)?.slice(0, 10) || t;
    const floor = minDate && minDate > first ? minDate : first;
    const back = (m) => { const d = new Date(t + 'T12:00:00'); d.setMonth(d.getMonth() - m); const s = d.toLocaleDateString('sv-SE'); return s < floor ? floor : s; };
    const P = [['m1', 'Месяц', () => back(1)], ['m3', '3 месяца', () => back(3)], ['y1', 'Год', () => back(12)], ['all', minDate ? 'Всё доступное' : 'Всё время', () => floor]];
    let from = back(1), to = t, sel = 'm1';
    load().catch(() => {}); // заранее, чтобы «Отправить» сработало сразу
    const api = A.sheet({ title: 'Акт сверки', left: 'Закрыть', body: `
      <div class="hero"><div class="who">${A.esc(party)}</div></div>
      <div class="chips" id="act-p">${P.map(([k, l]) => `<button type="button" class="chip" data-p="${k}">${l}</button>`).join('')}</div>
      <div class="list" style="margin-top:10px">
        <label class="field"><span>С</span><input type="date" id="act-from" min="${floor}" max="${t}"></label>
        <label class="field"><span>По</span><input type="date" id="act-to" min="${floor}" max="${t}"></label></div>
      <div class="list" style="margin-top:14px" id="act-sum"></div>
      <button class="btn blue" type="button" data-act="share">Отправить PDF</button>
      <button class="btn plain" type="button" data-act="save">Скачать PDF</button>
      ${minDate ? `<div class="footer-note">В кабинете доступны документы с ${dmy(floor)}. Остаток на начало — по данным 1С.</div>` : ''}` });
    const f = api.body, $f = f.querySelector('#act-from'), $t = f.querySelector('#act-to');
    const draw = () => {
      $f.value = from; $t.value = to;
      f.querySelectorAll('[data-p]').forEach((b) => b.classList.toggle('on', b.dataset.p === sel));
      const c = calc(docs, base, from, to);
      const cell = (k, v) => `<div class="cell static"><div class="main">${k}</div><div class="value">${v}</div></div>`;
      f.querySelector('#act-sum').innerHTML = cell('Долг на начало', money(c.opening) + ' ₽') + cell('Приход', money(c.inc) + ' ₽')
        + cell('Оплаты и возвраты', money(c.dec) + ' ₽') + cell('<b>Долг на конец</b>', '<b>' + money(c.closing) + ' ₽</b>')
        + cell('Документов', String(c.rows.length));
      return c;
    };
    f.querySelector('#act-p').addEventListener('click', (e) => {
      const p = P.find(([k]) => k === e.target.closest('[data-p]')?.dataset.p); if (!p) return;
      sel = p[0]; from = p[2](); to = t; A.haptic(); draw();
    });
    $f.addEventListener('change', () => { from = $f.value || floor; if (from < floor) from = floor; sel = ''; draw(); });
    $t.addEventListener('change', () => { to = $t.value || t; sel = ''; draw(); });
    draw();
    const go = async (share) => {
      if (from > to) return A.toast('Дата «С» позже даты «По»', true);
      const btns = f.querySelectorAll('[data-act]'); btns.forEach((b) => (b.disabled = true));
      try {
        const c = calc(docs, base, from, to);
        const blob = await makePdf({ party, store, from, to, c });
        const name = `Акт сверки ${party.replace(/[\\/:*?"<>|]+/g, ' ').slice(0, 60)} ${dmy(from)}-${dmy(to)}.pdf`;
        await deliver(blob, name, share);
      } catch (e) { A.toast(e.message || 'Не удалось сделать PDF', true); }
      btns.forEach((b) => (b.disabled = false));
    };
    f.addEventListener('click', (e) => { const a = e.target.closest('[data-act]')?.dataset.act; if (a === 'share') go(true); if (a === 'save') go(false); });
  }

  window.Act = { open, calc, docName };
})();
