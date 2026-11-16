// Разбор выгрузок 1С: документы, взаиморасчёты и регистры причин. Справочник «Контрагенты» — в import.js.
// Чистые функции: работают и в браузере (window.Doc1C), и в Node (тесты).
(function (root) {
  const clean = (v) => String(v ?? '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
  const scaled = (v, places) => {
    const scale = 10 ** places;
    if (typeof v === 'number' && Math.abs(v) < 0.5 / scale) return 0;
    const s = clean(v).replace(/\s/g, '').replace(',', '.');
    const parts = s.match(/^([+-]?)(\d+)(?:\.(\d+))?$/);
    if (!parts) return null;
    const [, sign, whole, fraction = ''] = parts;
    const integer = Number(whole);
    if (integer > 999999999999) return null;
    const result = integer * scale + Number(fraction.slice(0, places).padEnd(places, '0')) + (fraction[places] >= '5' ? 1 : 0);
    return Number.isSafeInteger(result) && result < 1e12 * scale ? (sign === '-' ? -result : result) : null;
  };
  const num = (v) => { const cents = scaled(v, 2); return cents == null ? null : cents / 100; };
  const pad = (n) => String(n).padStart(2, '0');
  // «31.08.2026», «31.08.2026 9:35:07», дата Excel (число) или Date
  function date(v, withTime = false) {
    if (v == null || v === '') return null;
    if (v instanceof Date) v = `${pad(v.getDate())}.${pad(v.getMonth() + 1)}.${String(v.getFullYear()).padStart(4, '0')} ${pad(v.getHours())}:${pad(v.getMinutes())}:${pad(v.getSeconds())}`;
    if (typeof v === 'number') {
      if (!Number.isFinite(v) || v < 1 || Math.floor(v) === 60) return null;
      const d = new Date(Math.round((v - (v < 60 ? 25568 : 25569)) * 864e5));
      v = `${pad(d.getUTCDate())}.${pad(d.getUTCMonth() + 1)}.${d.getUTCFullYear()} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
    }
    const m = clean(v).match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
    if (!m) return null;
    const [, day, month, year, hour = 0, minute = 0, second = 0] = m;
    const check = new Date(0);
    check.setUTCFullYear(+year, +month - 1, +day);
    if (+year === 0 || check.getUTCMonth() !== +month - 1 || check.getUTCDate() !== +day ||
        +hour > 23 || +minute > 59 || +second > 59) return null;
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
  const REGISTERS = {
    returns_by_reason: { title: 'Причины возвратов поставщикам', reason: 'Причина возврата', supplier: 'Регистратор.Контрагент' },
    writeoff_reasons: { title: 'Причины списания', reason: 'Причина списания', supplier: 'Партия, Контрагент' },
  };
  const REGISTER_NUMBERS = {
    quantity: ['Количество', 3],
    cost: ['Себестоимость в регламентной валюте', 2],
    receipt: ['Приходная сумма в регламентной валюте', 2],
    managementReceipt: ['Приходная сумма в управленческой валюте', 2],
    retail: ['Розничная сумма в регламентной валюте', 2],
    movements: ['Количество записей', 0],
  };

  function meta(aoa) {
    const m = { object: '', type: '', from: null, to: null, filtered: false };
    for (const row of aoa.slice(0, 12)) for (const c of row || []) {
      const s = clean(c);
      let x;
      if ((x = s.match(/^Имя объекта:\s*(.+)$/))) m.object = x[1];
      else if ((x = s.match(/^Тип объекта:\s*(.+)$/))) m.type = x[1];
      else if ((x = s.match(/^Период:\s*(\d{1,2}\.\d{1,2}\.\d{4})\s*-\s*(\d{1,2}\.\d{1,2}\.\d{4})/))) { m.from = date(x[1]); m.to = date(x[2]); }
      else if (/^Отбор\s*:/i.test(s)) m.filtered = true;
    }
    return m;
  }

  function detect(aoa) {
    const m = meta(aoa);
    if (m.type === 'Справочник' && /контрагент/i.test(m.object)) return { kind: 'kontr', ...m };
    const register = m.type === 'Регистр накопления' && Object.entries(REGISTERS).find(([, x]) => x.title === m.object);
    if (register) {
      const head = aoa.slice(0, 15).findIndex((r) => (r || []).map(clean).includes(register[1].reason));
      return { kind: register[0], head, ...m };
    }
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

  // Сумма по договору — та, что уходит во взаиморасчёты; «прих.» у части накладных другая (тара и т. п.)
  const AMOUNT_HEADS = ['Сумма документа в валюте договора', 'Сумма документа', 'Сумма документа прих.', 'Сумма'];
  // Список документов (Приходная накладная, Расходный кассовый ордер, Возврат поставщику …)
  function parseList(aoa, info) {
    const head = (aoa[info.head] || []).map(clean);
    const col = (name) => head.indexOf(name);
    const c = {
      kontr: col('Контрагент'), amount: AMOUNT_HEADS.map(col).find((i) => i >= 0) ?? -1, retail: col('Сумма документа розница'),
      in_no: col('Входящий номер документа'), pay_due: col('Дата оплаты'), basis: col('Документ основание'),
      article: col('Статья ДДС'), cash: col('Касса'), comment: col('Комментарий'), operation: col('Вид операции'),
    };
    if (c.kontr < 0 || c.amount < 0) throw new Error(`«${info.object}»: не найдены столбцы «Контрагент» и «Сумма»`);
    const title = info.object, inc = INC.has(title);
    const fields = ['inc', 'dec', ...['retail', 'in_no', 'pay_due', 'basis', 'article', 'cash', 'comment'].filter((k) => c[k] >= 0)];
    const rows = [], missingAmounts = []; let skipped = 0, otherOperations = 0;
    for (let i = info.head + 1; i < aoa.length; i++) {
      const r = aoa[i];
      const d = docTitle(r?.[0]);
      if (!d) {
        if (clean(r?.[0]).startsWith(title + ' ') && /\sот\s/.test(clean(r[0]))) throw new Error(`Строка ${i + 1}: неверная дата или номер документа`);
        continue;
      }
      const operation = clean(r[c.operation]);
      if (title === 'Расходный кассовый ордер' && c.operation >= 0 && operation.toLowerCase() !== 'выплата контрагенту') {
        otherOperations++;
        if (!operation) skipped++;
        continue;
      }
      const kontr = clean(r[c.kontr]); const amount = num(r[c.amount]);
      if (d.title !== title || !kontr || amount < 0) { skipped++; continue; } // расход на нужды магазина, ККМ и т. п.
      if (amount == null) {
        if (clean(r[c.amount])) throw new Error(`Строка ${i + 1}: неверная сумма документа`);
        missingAmounts.push(i + 1);
      }
      const row = { title: d.title, num: d.num, at: d.at, kontr, inc: inc ? amount : 0, dec: inc ? 0 : amount, src: 'l' };
      if (c.retail >= 0) row.retail = num(r[c.retail]);
      if (c.in_no >= 0) { const x = clean(r[c.in_no]); row.in_no = !x || /ручн/i.test(x) ? null : x; }
      if (c.pay_due >= 0) row.pay_due = date(r[c.pay_due]);
      if (c.basis >= 0) { const b = docTitle(r[c.basis]); row.basis = b ? keyOf(b) : null; }
      if (c.article >= 0) row.article = clean(r[c.article]) || null;
      if (c.cash >= 0) row.cash = clean(r[c.cash]) || null;
      if (c.comment >= 0) { const x = clean(r[c.comment]); row.comment = !x || /^Введен на основании/i.test(x) ? null : x; }
      rows.push(row);
    }
    return { rows, fields, skipped, missingAmounts, otherOperations, scope: scopeOf(rows, info, [title], false, skipped || missingAmounts.length) };
  }

  // Отчёт «Взаиморасчёты с контрагентами»: Контрагент → Договор → Период → Документ движения
  function parseVzaimo(aoa, info) {
    const head = (aoa[info.head] || []).map(clean);
    const ci = head.findIndex((h) => /Увеличение долга/i.test(h)), cd = head.findIndex((h) => /Уменьшение долга/i.test(h));
    const rows = []; let kontr = null, skipped = 0, total = null;
    for (let i = info.head + 1; i < aoa.length; i++) {
      const r = aoa[i];
      const a = clean(r?.[0]);
      if (a === 'Итого') {
        if (total) throw new Error(`Строка ${i + 1}: повторная строка «Итого»`);
        total = [ci, cd].map((col) => clean(r[col]) ? scaled(r[col], 2) : 0);
        if (total.includes(null)) throw new Error(`Строка ${i + 1}: неверная сумма в строке «Итого»`);
        continue;
      }
      if (!a || /^Договор$|^Период|^Документ движения$/.test(a)) continue;
      if (/^\d{1,2}\.\d{1,2}\.\d{4}(\s+\d{1,2}:\d{2}(:\d{2})?)?$/.test(a)) continue; // строка периода
      const d = docTitle(a);
      if (d) {
        const inc = clean(r[ci]) ? num(r[ci]) : 0, dec = clean(r[cd]) ? num(r[cd]) : 0;
        if (inc == null || dec == null) throw new Error(`Строка ${i + 1}: неверная сумма движения`);
        if (!kontr || inc < 0 || dec < 0) { skipped++; continue; }
        rows.push({ title: d.title, num: d.num, at: d.at, kontr, inc, dec, src: 'v' });
      } else if (/\sот\s+\d{1,2}\.\d{1,2}\./.test(a)) throw new Error(`Строка ${i + 1}: неверная дата или номер документа`);
      else if (/договор/i.test(a)) continue;
      else kontr = a;
    }
    const titles = [...new Set(rows.map((r) => r.title))];
    const sums = rows.reduce(([inc, dec], r) => [inc + Math.round(r.inc * 100), dec + Math.round(r.dec * 100)], [0, 0]);
    const checkedTotal = total !== null && total.every((v, i) => v === sums[i]);
    if (total && !checkedTotal) throw new Error('Суммы документов не совпадают с итогом ведомости 1С');
    return { rows, fields: ['inc', 'dec'], skipped, checkedTotal, scope: scopeOf(rows, info, titles, true, skipped || info.filtered) };
  }

  function parseRegister(aoa, info) {
    if (!info.from || !info.to || info.from > info.to) throw new Error('Нужен период отчёта 1С');
    if (info.filtered) throw new Error('Снимите отборы в регистре и выгрузите весь отчёт за период');
    const config = REGISTERS[info.kind], head = (aoa[info.head] || []).map(clean);
    const dimensions = Object.entries({ item: 'Номенклатура', warehouse: 'Склад', reason: config.reason,
      supplier: config.supplier, ...(info.kind === 'returns_by_reason' ? { contract: 'Договор' } : {}) })
      .map(([key, label]) => [key, head.indexOf(label)]);
    const measures = Object.entries(REGISTER_NUMBERS).map(([key, [label, places]]) => [key, head.indexOf(label), places, label]);
    if ([...dimensions, ...measures].some(([, col]) => col < 0)) throw new Error('В регистре отсутствуют обязательные столбцы');
    const rows = [], reasons = new Map(), total = Object.fromEntries(measures.map(([key]) => [key, 0]));
    let reportedTotal = null;
    for (let i = info.head + 1; i < aoa.length; i++) {
      const cells = aoa[i] || [];
      if (!cells.some(clean)) continue;
      const isTotal = clean(cells[0]) === 'Итого' && dimensions.every(([, col]) => col === 0 || !clean(cells[col]));
      if (reportedTotal) throw new Error(`Строка ${i + 1}: данные после строки «Итого»`);
      const row = {};
      for (const [key, col, places, label] of measures) {
        const value = clean(cells[col]);
        const number = value ? scaled(value, places) : null;
        if ((value && number == null) || (key === 'quantity' && number == null) ||
            (key === 'movements' && (number == null || number < (isTotal ? 0 : 1) || !/^\+?\d+(?:[.,]0+)?$/.test(value.replace(/\s/g, ''))))) {
          throw new Error(`Строка ${i + 1}: неверное значение «${label}»`);
        }
        row[key] = number;
      }
      if (isTotal) { reportedTotal = row; continue; }
      for (const [key, col] of dimensions) row[key] = clean(cells[col]) || null;
      for (const [key] of measures) total[key] += row[key] ?? 0;
      const reason = reasons.get(row.reason) || { reason: row.reason, cost: 0, movements: 0 };
      reason.cost += row.cost ?? 0;
      reason.movements += row.movements;
      reasons.set(row.reason, reason);
      rows.push(row);
    }
    if (rows.length > 100000) throw new Error('В регистре больше 100 000 строк. Выгрузите меньший период.');
    if (!reportedTotal) throw new Error('В регистре нет строки «Итого»');
    if (measures.some(([key]) => !Number.isSafeInteger(total[key]) || total[key] !== (reportedTotal[key] ?? 0))) {
      throw new Error('Суммы строк регистра не совпадают с итогом 1С');
    }
    return { kind: info.kind, period_start: info.from, period_end: info.to, row_count: rows.length,
      summary: { total, reasons: [...reasons.values()].sort((a, b) => b.cost - a.cost) }, rows };
  }

  // Период для поиска удалённых: только дни, которые есть в файле (выгрузка списка бывает обрезана
  // раньше конца периода из заголовка — тогда «пропавшие» за остальные дни не считаются удалёнными)
  function scopeOf(rows, info, titles, byReps, skipped) {
    if (skipped) return { titles, from: null, to: null, by_reps: byReps };
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
    if (Object.prototype.hasOwnProperty.call(REGISTERS, info.kind)) return { info, report: parseRegister(aoa, info) };
    return { info };
  }

  function mergeReports(parsed) {
    const reports = new Map();
    for (const { report } of parsed) {
      if (!report) continue;
      const key = [report.kind, report.period_start, report.period_end].join('|');
      const existing = reports.get(key);
      if (existing && JSON.stringify(existing) !== JSON.stringify(report)) {
        throw new Error('Выбраны разные версии одного отчёта за этот период. Оставьте один файл.');
      }
      reports.set(key, report);
    }
    return [...reports.values()];
  }

  // Несколько файлов за раз: суммы — из взаиморасчётов (проведённые движения), подробности — из списков документов.
  // На выходе пачки с одинаковым набором полей: поля, которых нет в файле, на сервере не трогаются.
  function prepareDocs(parsed) {
    const byKey = new Map();
    const stats = new Map();
    const statements = parsed.filter((p) => p.info.kind === 'vzaimo' && p.checkedTotal && !p.skipped && !p.info.filtered);
    for (const p of parsed) for (const r of p.rows) {
      const k = keyOf(r);
      if (!byKey.has(k)) byKey.set(k, {});
      const source = byKey.get(k);
      const same = source[r.src];
      if (same) {
        if (same.row.kontr !== r.kontr || same.row.at !== r.at ||
            p.fields.some((f) => same.fields.has(f) && same.row[f] !== r[f])) {
          throw new Error(`${p.name || 'Выгрузка 1С'}: разные сведения по документу ${r.num} от ${r.at.slice(0, 10)}`);
        }
        Object.assign(same.row, r);
        p.fields.forEach((f) => same.fields.add(f));
      } else source[r.src] = { row: { ...r }, fields: new Set(p.fields), file: p };
    }
    const groups = new Map();
    for (const p of parsed) if (p.info.kind === 'list') stats.set(p, { blank: 0, recovered: 0, unconfirmed: 0 });
    for (const { v, l } of byKey.values()) {
      if (v && l && (v.row.kontr !== l.row.kontr || v.row.at.slice(0, 10) !== l.row.at.slice(0, 10))) {
        throw new Error(`В выгрузках различаются поставщик или дата документа ${v.row.num}`);
      }
      if (l && (l.row.inc == null || l.row.dec == null)) {
        stats.get(l.file)[v ? 'recovered' : 'blank']++;
        if (!v) continue;
      }
      if (l && !v && statements.some((p) => p.info.from && p.info.from === l.file.info.from &&
          p.info.to && p.info.to === l.file.info.to && p.scope.titles.includes(l.row.title) &&
          l.row.at.slice(0, 10) >= p.info.from && l.row.at.slice(0, 10) <= p.info.to)) {
        stats.get(l.file).unconfirmed++;
        continue;
      }
      const row = l && v ? { ...l.row, inc: v.row.inc, dec: v.row.dec, src: 'v' } : (v || l).row;
      const fields = new Set([...(v?.fields || []), ...(l?.fields || [])]);
      const sig = [...fields].sort().join(',');
      if (!groups.has(sig)) groups.set(sig, { fields: [...fields].sort(), rows: [] });
      groups.get(sig).rows.push(row);
    }
    return { groups: [...groups.values()], stats };
  }

  const api = { parse, detect, prepareDocs, merge: (parsed) => prepareDocs(parsed).groups, mergeReports,
    registers: REGISTERS, docTitle, kindOf, keyOf, date, num };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Doc1C = api;
})(typeof window !== 'undefined' ? window : globalThis);
