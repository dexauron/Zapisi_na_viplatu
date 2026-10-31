// Разбор выгрузок 1С (УНФ) в документы для загрузки: приходные накладные, расходные кассовые ордера,
// возвраты поставщику и отчёт «Взаиморасчёты с контрагентами». Справочник «Контрагенты» — в import.js.
// Чистые функции: работают и в браузере (window.Doc1C), и в Node (тесты).
(function (root) {
  const clean = (v) => String(v ?? '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
  const num = (v) => {
    if (v == null || v === '') return null;
    if (typeof v === 'number') return Math.round(v * 100) / 100;
    const s = clean(v).replace(/\s/g, '').replace(',', '.');
    const n = Number(s); return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
  };
  const pad = (n) => String(n).padStart(2, '0');
  // «31.08.2026», «31.08.2026 9:35:07», дата Excel (число) или Date
  function date(v, withTime = false) {
    if (v == null || v === '') return null;
    if (v instanceof Date) v = `${pad(v.getDate())}.${pad(v.getMonth() + 1)}.${v.getFullYear()} ${pad(v.getHours())}:${pad(v.getMinutes())}:${pad(v.getSeconds())}`;
    if (typeof v === 'number') { const d = new Date(Math.round((v - 25569) * 864e5)); v = `${pad(d.getUTCDate())}.${pad(d.getUTCMonth() + 1)}.${d.getUTCFullYear()}`; }
    const m = clean(v).match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
    if (!m) return null;
    const d = `${m[3]}-${pad(m[2])}-${pad(m[1])}`;
    return withTime ? `${d}T${pad(m[4] || 0)}:${m[5] || '00'}:${m[6] || '00'}` : d;
  }
  // «Приходная накладная ПФ0000040007665 от 01.09.2026 9:35:07» → вид, номер, дата-время
  function docTitle(v) {
    const m = clean(v).match(/^(.+?)\s+(\S+)\s+от\s+(\d{1,2}\.\d{1,2}\.\d{4}(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?)$/);
    if (!m) return null;
    const at = date(m[3], true);
    return at ? { title: m[1], num: m[2], at } : null;
  }
  const keyOf = (d) => `${d.title}|${d.num}|${d.at.slice(0, 4)}`;
  const INC = new Set(['Приходная накладная', 'Приходный кассовый ордер']);
  const KIND = { 'Приходная накладная': 'in', 'Расходный кассовый ордер': 'pay', 'Расход со счета': 'pay',
    'Платежное поручение исходящее': 'pay', 'Возврат поставщику': 'ret' };
  const kindOf = (title) => KIND[title] || 'other';

  function meta(aoa) {
    const m = { object: '', type: '', from: null, to: null };
    for (const row of aoa.slice(0, 12)) for (const c of row || []) {
      const s = clean(c);
      let x;
      if ((x = s.match(/^Имя объекта:\s*(.+)$/))) m.object = x[1];
      else if ((x = s.match(/^Тип объекта:\s*(.+)$/))) m.type = x[1];
      else if ((x = s.match(/^Период:\s*(\d{1,2}\.\d{1,2}\.\d{4})\s*-\s*(\d{1,2}\.\d{1,2}\.\d{4})/))) { m.from = date(x[1]); m.to = date(x[2]); }
    }
    return m;
  }

  // Что за файл: kontr | list | vzaimo | null
  function detect(aoa) {
    const m = meta(aoa);
    if (m.type === 'Справочник' && /контрагент/i.test(m.object)) return { kind: 'kontr', ...m };
    for (let i = 0; i < Math.min(aoa.length, 15); i++) {
      const row = (aoa[i] || []).map(clean);
      if (row[0] === 'Контрагент' && row.some((c) => /Увеличение долга/i.test(c)) && row.some((c) => /Уменьшение долга/i.test(c))) {
        return { kind: 'vzaimo', head: i, ...m, object: 'Взаиморасчёты с контрагентами' };
      }
      if (m.type === 'Документ' && m.object && row[0] === m.object && row.includes('Контрагент')) return { kind: 'list', head: i, ...m };
    }
    if (/контрагент/i.test(m.object) || aoa.slice(0, 15).some((r) => /^Контрагент$/i.test(clean(r?.[0])))) return { kind: 'kontr', ...m };
    return { kind: null, ...m };
  }

  const AMOUNT_HEADS = ['Сумма документа прих.', 'Сумма документа в валюте договора', 'Сумма документа', 'Сумма'];
  // Список документов (Приходная накладная, Расходный кассовый ордер, Возврат поставщику …)
  function parseList(aoa, info) {
    const head = (aoa[info.head] || []).map(clean);
    const col = (name) => head.indexOf(name);
    const c = {
      kontr: col('Контрагент'), amount: AMOUNT_HEADS.map(col).find((i) => i >= 0) ?? -1, retail: col('Сумма документа розница'),
      in_no: col('Входящий номер документа'), pay_due: col('Дата оплаты'), basis: col('Документ основание'),
      article: col('Статья ДДС'), cash: col('Касса'), comment: col('Комментарий'),
    };
    if (c.kontr < 0 || c.amount < 0) throw new Error(`«${info.object}»: не найдены столбцы «Контрагент» и «Сумма»`);
    const title = info.object, inc = INC.has(title);
    const fields = ['inc', 'dec', ...['retail', 'in_no', 'pay_due', 'basis', 'article', 'cash', 'comment'].filter((k) => c[k] >= 0)];
    const rows = []; let skipped = 0;
    for (const r of aoa.slice(info.head + 1)) {
      const d = docTitle(r?.[0]);
      if (!d) continue;
      const kontr = clean(r[c.kontr]); const amount = num(r[c.amount]);
      if (d.title !== title || !kontr || amount == null || amount < 0) { skipped++; continue; } // расход на нужды магазина, ККМ и т. п.
      const row = { title: d.title, num: d.num, at: d.at, kontr, inc: inc ? amount : 0, dec: inc ? 0 : amount };
      if (c.retail >= 0) row.retail = num(r[c.retail]);
      if (c.in_no >= 0) { const x = clean(r[c.in_no]); row.in_no = !x || /ручн/i.test(x) ? null : x; }
      if (c.pay_due >= 0) row.pay_due = date(r[c.pay_due]);
      if (c.basis >= 0) { const b = docTitle(r[c.basis]); row.basis = b ? keyOf(b) : null; }
      if (c.article >= 0) row.article = clean(r[c.article]) || null;
      if (c.cash >= 0) row.cash = clean(r[c.cash]) || null;
      if (c.comment >= 0) { const x = clean(r[c.comment]); row.comment = !x || /^Введен на основании/i.test(x) ? null : x; }
      rows.push(row);
    }
    return { rows, fields, skipped, scope: scopeOf(rows, info, [title], false) };
  }

  // Отчёт «Взаиморасчёты с контрагентами»: Контрагент → Договор → Период → Документ движения
  function parseVzaimo(aoa, info) {
    const head = (aoa[info.head] || []).map(clean);
    const ci = head.findIndex((h) => /Увеличение долга/i.test(h)), cd = head.findIndex((h) => /Уменьшение долга/i.test(h));
    const rows = []; let kontr = null, skipped = 0;
    for (const r of aoa.slice(info.head + 1)) {
      const a = clean(r?.[0]);
      if (!a || a === 'Итого' || /^Договор$|^Период|^Документ движения$/.test(a)) continue;
      if (/^\d{1,2}\.\d{1,2}\.\d{4}(\s+\d{1,2}:\d{2}(:\d{2})?)?$/.test(a)) continue; // строка периода
      const d = docTitle(a);
      if (d) {
        const inc = num(r[ci]) || 0, dec = num(r[cd]) || 0;
        if (!kontr || inc < 0 || dec < 0) { skipped++; continue; }
        rows.push({ title: d.title, num: d.num, at: d.at, kontr, inc, dec });
      } else if (/договор/i.test(a)) continue;
      else kontr = a;
    }
    const titles = [...new Set(rows.map((r) => r.title))];
    return { rows, fields: ['inc', 'dec'], skipped, scope: scopeOf(rows, info, titles, true) };
  }

  // Период для поиска удалённых: только дни, которые есть в файле (выгрузка списка бывает обрезана
  // раньше конца периода из заголовка — тогда «пропавшие» за остальные дни не считаются удалёнными)
  function scopeOf(rows, info, titles, byReps) {
    const ds = rows.map((r) => r.at.slice(0, 10)).sort();
    let from = ds[0] || null, to = ds[ds.length - 1] || null;
    const shift = (d, n) => { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
    // файл кончается раньше заявленного периода — последний день в нём, скорее всего, неполный
    if (info.to && to && info.to > to) to = shift(to, -1);
    if (info.from && from && info.from < from) from = shift(from, 1);
    if (info.from && from && info.from > from) from = info.from;
    if (info.to && to && info.to < to) to = info.to;
    return { titles, from: from && to && from <= to ? from : null, to: from && to && from <= to ? to : null, by_reps: byReps };
  }

  function parse(aoa) {
    const info = detect(aoa);
    if (info.kind === 'list') return { info, ...parseList(aoa, info) };
    if (info.kind === 'vzaimo') return { info, ...parseVzaimo(aoa, info) };
    return { info };
  }

  // Несколько файлов за раз: суммы — из взаиморасчётов (проведённые движения), подробности — из списков документов.
  // На выходе пачки с одинаковым набором полей: поля, которых нет в файле, на сервере не трогаются.
  function merge(parsed) {
    const byKey = new Map();
    for (const p of parsed.filter((x) => x.info?.kind === 'vzaimo')) for (const r of p.rows) byKey.set(keyOf(r), { row: { ...r }, fields: new Set(p.fields), money: true });
    for (const p of parsed.filter((x) => x.info?.kind === 'list')) for (const r of p.rows) {
      const k = keyOf(r), cur = byKey.get(k);
      if (cur) { const { inc, dec } = cur.row; Object.assign(cur.row, r, { inc, dec }); p.fields.forEach((f) => cur.fields.add(f)); }
      else byKey.set(k, { row: { ...r }, fields: new Set(p.fields) });
    }
    const groups = new Map();
    for (const { row, fields } of byKey.values()) {
      const sig = [...fields].sort().join(',');
      if (!groups.has(sig)) groups.set(sig, { fields: [...fields].sort(), rows: [] });
      groups.get(sig).rows.push(row);
    }
    return [...groups.values()];
  }

  const api = { parse, detect, merge, docTitle, kindOf, keyOf, date, num };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Doc1C = api;
})(typeof window !== 'undefined' ? window : globalThis);
