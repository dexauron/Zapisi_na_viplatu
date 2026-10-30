// Разбор выгрузки 1С «Контрагенты» (.xls / .xlsx / .csv) в строки справочника представителей.
// Чистые функции: работают и в браузере (window.RepImport), и в Node (тесты).
(function (root) {
  const clean = (v) => String(v ?? '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim();

  // +7XXXXXXXXXX для российских номеров; остальное — как есть
  function normPhone(v) {
    if (typeof v === 'number') v = String(Math.round(v));
    const raw = clean(v);
    let d = raw.replace(/\D/g, '');
    if (!d) return '';
    if (d.length === 11 && d[0] === '8') d = '7' + d.slice(1);
    if (d.length === 10 && d[0] === '9') d = '7' + d;
    return d.length === 11 && d[0] === '7' ? '+' + d : raw;
  }

  // «ООО ТДК ТП Хайбулаев Абдулхаким» → компания «ООО ТДК», представитель «Хайбулаев Абдулхаким»
  function splitName(name) {
    const m = name.match(/^(.*?)\s+ТП\s+(.+)$/i);
    return m && m[1] ? { company: m[1].trim(), full_name: m[2].trim() } : { company: '', full_name: name };
  }

  const NAME_HEAD = /^(контрагент|наименование|представитель|поставщик|фио)$/i;
  const PHONE_HEAD = /телефон|контактн/i;

  // aoa — массив строк таблицы (массив массивов ячеек)
  function parseRows(aoa) {
    let head = -1, nameCol = -1, phoneCol = -1;
    for (let i = 0; i < Math.min(aoa.length, 50) && head < 0; i++) {
      const row = aoa[i] || [];
      const c = row.findIndex((v) => NAME_HEAD.test(clean(v)));
      if (c >= 0) { head = i; nameCol = c; phoneCol = row.findIndex((v, j) => j !== c && PHONE_HEAD.test(clean(v))); }
    }
    if (head < 0) throw new Error('В файле не найден столбец «Контрагент». Нужна выгрузка справочника «Контрагенты» из 1С.');

    const byKey = new Map();
    for (const row of aoa.slice(head + 1)) {
      const name = clean(row?.[nameCol]);
      if (!name || NAME_HEAD.test(name)) continue;
      const key = name.toLowerCase();
      const phone = phoneCol >= 0 ? normPhone(row[phoneCol]) : '';
      if (!byKey.has(key)) byKey.set(key, { key, name, phones: [] });
      const item = byKey.get(key);
      if (phone && !item.phones.includes(phone)) item.phones.push(phone);
    }
    return [...byKey.values()].map(({ key, name, phones }) => ({ key, ...splitName(name), phone: phones.join(', ') }));
  }

  // Что изменится: сравнение со справочником в приложении (та же логика, что в import_reps на сервере)
  function diff(rows, reps) {
    const byExt = new Map(reps.filter((r) => r.ext_key).map((r) => [r.ext_key, r]));
    const loose = reps.filter((r) => !r.ext_key);
    const keys = new Set(rows.map((r) => r.key));
    const res = { added: [], updated: [], same: 0, missing: reps.filter((r) => r.ext_key && r.active && !keys.has(r.ext_key)) };
    for (const row of rows) {
      const rep = byExt.get(row.key) || loose.find((r) => clean(r.full_name).toLowerCase() === row.key
        || clean((r.company ? r.company + ' ТП ' : '') + r.full_name).toLowerCase() === row.key);
      if (!rep) res.added.push(row);
      else if (rep.full_name !== row.full_name || (rep.company || '') !== row.company || (rep.phone || '') !== row.phone || rep.ext_key !== row.key) res.updated.push(row);
      else res.same++;
    }
    return res;
  }

  const api = { parseRows, diff, normPhone, splitName };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.RepImport = api;
})(typeof window !== 'undefined' ? window : globalThis);
