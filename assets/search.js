// Один поиск для всех экранов. Имена допускают опечатки; номера и деньги — нет.
(function (root) {
  'use strict';
  const fold = (s) => String(s ?? '').normalize('NFKC').toLowerCase().replace(/ё/g, 'е').replace(/[Ӏӏі]/g, 'i');
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const CYR = { а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ж: 'zh', з: 'z', и: 'i', й: 'i', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o',
    п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sh', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya' };
  const KB_EN = "`qwertyuiop[]asdfghjkl;'zxcvbnm,.", KB_RU = 'ёйцукенгшщзхъфывапролджэячсмитьбю';
  const swapLayout = (s) => [...fold(s)].map((c) => { const i = KB_EN.indexOf(c); return i >= 0 ? KB_RU[i] : c; }).join('');
  const canon = (s) => fold(s).replace(/[а-я]/g, (c) => CYR[c] ?? c).replace(/shch|sch/g, 'sh').replace(/kh/g, 'h')
    .replace(/dzh|dj/g, 'zh').replace(/iy|yi|ii/g, 'i').replace(/[^a-z0-9]+/g, ' ').trim();
  const compact = (s) => fold(s).replace(/[авекмнорстху]/g, c => ({ а: 'a', в: 'b', е: 'e', к: 'k', м: 'm', н: 'h', о: 'o', р: 'p', с: 'c', т: 't', х: 'x', у: 'y' }[c]))
    .replace(/[^a-zа-я0-9]/g, '');
  const digits = (s) => String(s ?? '').replace(/\D/g, '').replace(/^0+(?=\d)/, '');
  const legalPattern = /^(?:индивидуальн(?:ый|ого)\s+предпринимател(?:ь|я)|и\s*\.\s*п\s*\.|ип(?=\s|$)|ооо(?=\s|$)|о\s*\.\s*о\s*\.\s*о\s*\.)\s*/;
  const words = (s) => fold(s).match(/[\p{L}0-9]+/gu) || [];
  const legalOf = (s) => /^(?:индивидуальн\S*\s+предпринимател|и\s*\.?\s*п(?:\.|\s|$))/i.test(fold(s).trim()) ? 'ip'
    : /^о\s*\.?\s*о\s*\.?\s*о(?:\.|\s|$)/i.test(fold(s).trim()) ? 'ooo' : null;
  const plainLegal = (s) => fold(s).replace(legalPattern, ' ').trim();

  function amountCents(value) {
    let s = String(value ?? '').trim().replace(/(?:₽|руб(?:\.|ля|лей)?|р\.)$/iu, '').trim();
    if (!s || !/^[0-9\s\u00a0\u202f.,]+$/.test(s)) return null;
    if (/^\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?$/.test(s)) s = s.replace(/\./g, '');
    // Пробелы разрешены только как разделители тысяч, а не как произвольная склейка цифр.
    if (/\s/u.test(s) && !/^\d{1,3}(?:[\s\u00a0\u202f]+\d{3})+(?:[,.]\d{1,2})?$/.test(s)) return null;
    s = s.replace(/[\s\u00a0\u202f]/g, '').replace(',', '.');
    if (!/^\d+(?:\.\d{1,2})?$/.test(s)) return null;
    const [whole, fraction = ''] = s.split('.');
    const n = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
    return Number.isSafeInteger(n) ? n : null;
  }

  const queries = new Map(), documents = new Map();
  function parse(query) {
    const raw = String(query ?? '').trim();
    if (queries.has(raw)) return queries.get(raw);
    const q = { raw, text: '', words: [], layoutWords: [], initialWords: [], numbers: [], legal: legalOf(raw), empty: !raw, invalid: raw.length > 160 || /(?:^|\s)-\d/.test(raw) };
    if (!q.empty && !q.invalid) {
      let rest = fold(raw.replace(/№/g, ' '));
      const explicitAmount = /(?:^|\s)(?:сумм[ае](?=\s|[:=\d]|$)|руб(?:\.|ля|лей)?(?=\s|$)|р\.(?=\s|$))|₽/iu.test(rest);
      rest = rest.replace(/(?:на\s+)?сумм[ае]\s*[:=]?/giu, ' ').replace(/(?:накладная|накладной|номер|№)\s*[:=]?/giu, ' ');
      const phone = rest.replace(/\D/g, '');
      if (!explicitAmount && /^[+()\d\s-]+$/.test(rest) && /^[78]\d{10}$/.test(phone)) {
        q.numbers.push({ raw: phone, compact: phone, digits: digits(phone), amount_cents: amountCents(phone), amount_only: false, digit_only: true });
        rest = '';
      }
      // Сначала забираем номера с буквами/разделителями, затем суммы с разрядными пробелами.
      rest = rest.replace(/[\p{L}0-9]+(?:[-/_][\p{L}0-9]+)+|[\p{L}]+\d+[\p{L}0-9]*|\d{1,3}(?:[\s\u00a0\u202f]+\d{3})+(?:[,.]\d{1,2})?|\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d+(?:[,.]\d+)?/gu, (part) => {
        if (!/\d/.test(part)) return part;
        const cents = amountCents(part), only = cents != null && (explicitAmount || /[\s,.]/u.test(part));
        q.numbers.push({ raw: part, compact: compact(part), digits: digits(part), amount_cents: cents, amount_only: only,
          digit_only: /^[0-9\s.,]+$/.test(part) });
        return ' ';
      });
      rest = rest.replace(/(?:^|\s)(?:руб(?:\.|ля|лей)?|р\.)(?=\s|$)|₽/giu, ' ').trim();
      q.text = rest;
      q.words = words(plainLegal(rest)).map(value => ({ value, canonical: canon(value), swapped: words(swapLayout(value)).map(canon).join(' ') }));
      // «И. П. Иванов» — также инициалы перед фамилией, а не обязательная форма ИП.
      if (/^[а-я]\s*\.\s*[а-я]\s*\./.test(rest)) q.initialWords = words(rest).map(value => ({ value, canonical: canon(value), swapped: '' }));
      if (/[a-z]/.test(rest)) q.layoutWords = words(plainLegal(swapLayout(rest))).map(value => ({ value, canonical: canon(value), swapped: '' }));
      q.invalid = q.numbers.length > 8 || q.words.length > 12 || (!q.words.length && !q.numbers.length && !q.legal);
    }
    if (queries.size >= 32) queries.delete(queries.keys().next().value);
    queries.set(raw, q);
    return q;
  }

  function documentOf(fields) {
    if (Array.isArray(fields)) fields = { text: fields.filter(v => typeof v !== 'number'), amounts: fields.filter(v => typeof v === 'number') };
    fields = fields || {};
    const key = JSON.stringify(fields);
    if (documents.has(key)) return documents.get(key);
    const doc = { words: [], phrases: [], numbers: [], amounts: [], phones: [], dates: [], legal: new Set() };
    for (const [kind, weight] of [['names', 40], ['companies', 32], ['text', 0]]) {
      const values = Array.isArray(fields[kind]) ? fields[kind] : [fields[kind]];
      for (const value of values.filter(v => v != null && v !== '')) {
        const form = legalOf(value); if (form) doc.legal.add(form);
        const normalized = plainLegal(value), tokens = words(normalized);
        doc.phrases.push({ value: tokens.join(' '), canonical: canon(tokens.join(' ')), weight });
        for (const word of tokens) doc.words.push({ value: word, canonical: canon(word), weight });
      }
    }
    for (const n of fields.numbers || []) if (n != null && String(n).trim()) doc.numbers.push({ raw: fold(n), compact: compact(n), alternate: canon(n).replace(/ /g, ''), digits: digits(n) });
    for (const n of fields.amounts || []) { const value = amountCents(n); if (value != null) doc.amounts.push(value); }
    for (const n of fields.phones || []) if (n) doc.phones.push(String(n).replace(/\D/g, ''));
    for (const n of fields.dates || []) if (n) doc.dates.push(compact(n));
    if (documents.size >= 12000) documents.delete(documents.keys().next().value);
    documents.set(key, doc);
    return doc;
  }

  // Ограниченное расстояние Дамерау — Левенштейна. Числа сюда никогда не попадают.
  function distance(a, b, max) {
    if (Math.abs(a.length - b.length) > max) return max + 1;
    let before = null, previous = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
      const row = [i]; let best = i;
      for (let j = 1; j <= b.length; j++) {
        row[j] = Math.min(previous[j] + 1, row[j - 1] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
        if (before && i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) row[j] = Math.min(row[j], before[j - 2] + 1);
        best = Math.min(best, row[j]);
      }
      if (best > max) return max + 1;
      before = previous; previous = row;
    }
    return previous[b.length];
  }
  function wordScore(term, word, fuzzy) {
    const q = term.value, w = word.value;
    if (w === q) return 120 + word.weight;
    if (w.startsWith(q)) return 100 + word.weight;
    if (!term.canonical) return 0;
    if (word.canonical === term.canonical) return 112 + word.weight;
    if (word.canonical.startsWith(term.canonical)) return 92 + word.weight;
    if (q.length >= 3 && (w.includes(q) || word.canonical.includes(term.canonical))) return 66 + word.weight;
    if (/^[a-z]+$/.test(q) && q.length >= 3 && term.swapped && !term.swapped.includes(' ')) {
      if (word.canonical === term.swapped) return 101 + word.weight;
      if (word.canonical.startsWith(term.swapped)) return 85 + word.weight;
    }
    if (!fuzzy || q.length < 4 || /\d/.test(q)) return 0;
    const max = q.length >= 8 ? 2 : 1;
    const variants = [term.canonical, /^[a-z]+$/.test(q) ? term.swapped : null].filter(Boolean);
    for (const v of variants) {
      if (!v || v.includes(' ')) continue;
      for (const length of [v.length, v.length - 1, v.length + 1]) {
        if (distance(v, word.canonical.slice(0, length), max) <= max) return 50 + word.weight;
      }
    }
    return 0;
  }
  function numberScore(term, doc) {
    let score = term.amount_cents != null && doc.amounts.includes(term.amount_cents) ? 220 : 0;
    if (term.amount_only) return score;
    for (const n of doc.numbers) {
      if (n.compact === term.compact) score = Math.max(score, 220);
      else if (n.alternate.replace(/\d+/g, digits) === canon(term.raw).replace(/ /g, '').replace(/\d+/g, digits)) score = Math.max(score, 212);
      else if (term.digit_only && term.digits && n.digits === term.digits) score = Math.max(score, 210);
      else if (n.compact.startsWith(term.compact) || (term.digit_only && term.digits && n.digits.startsWith(term.digits))) score = Math.max(score, 170);
      else if (n.compact.includes(term.compact) || (term.digit_only && term.digits.length >= 2 && n.digits.includes(term.digits))) score = Math.max(score, 130);
    }
    if (term.digit_only && term.digits.length >= 3) for (const p of doc.phones) {
      if (p === term.digits || p.replace(/^8(?=\d{10}$)/, '7') === term.digits.replace(/^8(?=\d{10}$)/, '7')) score = Math.max(score, 190);
      else if (p.includes(term.digits)) score = Math.max(score, 130);
    }
    if (doc.dates.includes(term.compact)) score = Math.max(score, 150);
    // Старые вызовы matches могут передавать строки вместо типизированных полей.
    if (!score && doc.words.some(w => w.value === term.raw)) score = 100;
    return score;
  }
  function scorePrepared(q, doc, fuzzy) {
    if (q.empty) return 1;
    const legalMatch = !q.legal || doc.legal.has(q.legal);
    if (q.invalid || (!legalMatch && !q.initialWords.length)) return 0;
    let total = 0, count = 0;
    for (const term of q.numbers) { const s = numberScore(term, doc); if (!s) return 0; total += s; count++; }
    let textBest = -1;
    const variants = legalMatch ? [q.words, q.layoutWords, q.initialWords] : [q.initialWords];
    for (const terms of variants.filter(a => a.length || !q.words.length)) {
      const used = new Set(); let textTotal = 0, complete = true;
      for (const term of [...terms].sort((a, b) => b.value.length - a.value.length)) {
        let best = 0, index = -1;
        for (let i = 0; i < doc.words.length; i++) {
          if (used.has(i)) continue;
          const s = wordScore(term, doc.words[i], fuzzy);
          if (s > best) { best = s; index = i; }
        }
        if (index < 0) { complete = false; break; }
        used.add(index); textTotal += best;
      }
      if (complete) textBest = Math.max(textBest, terms.length ? textTotal / terms.length : 0);
    }
    if (textBest < 0) return 0;
    if (q.words.length) { total += textBest * q.words.length; count += q.words.length; }
    const phrase = q.words.map(w => w.value).join(' ');
    const phraseBonus = phrase && doc.phrases.some(p => p.value === phrase) ? 48 : 0;
    return (count ? total / count : 100) + phraseBonus;
  }
  const score = (query, fields, fuzzy = true) => scorePrepared(parse(query), documentOf(fields), fuzzy);
  const matches = (query, ...fields) => score(query, fields.length === 1 && fields[0] && !Array.isArray(fields[0]) && typeof fields[0] === 'object' ? fields[0] : fields) > 0;
  function rank(query, items, fieldsOf) {
    const q = parse(query); if (q.empty) return items;
    if (q.invalid) return [];
    const hits = [], pending = [];
    items.forEach((item, index) => {
      const doc = documentOf(fieldsOf(item)), value = scorePrepared(q, doc, false);
      if (value) hits.push({ item, index, value }); else pending.push({ item, index, doc });
    });
    // Как в каталоге: дорогой разбор опечаток нужен только при малом числе обычных результатов.
    if (hits.length < 12 && q.words.some(w => w.value.length >= 4)) for (const x of pending) {
      const value = scorePrepared(q, x.doc, true); if (value) hits.push({ ...x, value });
    }
    const best = hits.reduce((n, h) => Math.max(n, h.value), 0), floor = best * (q.numbers.length ? 0.55 : 0.62);
    return hits.filter(h => h.value >= floor).sort((a, b) => b.value - a.value || a.index - b.index).map(h => h.item);
  }
  function mark(text, query) {
    text = String(text ?? '');
    const spans = [], starts = [], ends = [], q = parse(query);
    let source = '';
    // NFKC меняет длину «№» и лигатур. Подсветка обязана сохранять исходные позиции.
    const parts = typeof Intl.Segmenter === 'function' ? new Intl.Segmenter('ru', { granularity: 'grapheme' }).segment(text)
      : Array.from(text).map((segment, i, all) => ({ segment, index: all.slice(0, i).join('').length }));
    for (const { segment, index } of parts) {
      const normalized = fold(segment); source += normalized;
      for (let i = 0; i < normalized.length; i++) { starts.push(index); ends.push(index + segment.length); }
    }
    for (const term of [...q.words.map(w => w.value), ...q.numbers.map(n => n.raw)]) {
      for (const value of new Set([term, swapLayout(term)])) {
        if (!value) continue;
        let at = source.indexOf(value);
        while (at >= 0) { spans.push([starts[at], ends[at + value.length - 1]]); at = source.indexOf(value, at + value.length); }
      }
    }
    spans.sort((a, b) => a[0] - b[0]);
    let out = '', cursor = 0;
    for (const [a, b] of spans) { if (b <= cursor) continue; out += esc(text.slice(cursor, Math.max(a, cursor))) + '<mark>' + esc(text.slice(Math.max(a, cursor), b)) + '</mark>'; cursor = b; }
    return out + esc(text.slice(cursor));
  }
  const Search = { parse, score, matches, rank, mark, canon, compact, amountCents };
  if (typeof module === 'object' && module.exports) module.exports = Search;
  else root.SverkaSearch = Search;
})(typeof window === 'object' ? window : globalThis);
