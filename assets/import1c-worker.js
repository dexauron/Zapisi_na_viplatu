// XLSX больших выгрузок читается вне основного потока браузера.
const asset = (path) => {
  const url = new URL(path, self.location.href);
  url.search = self.location.search;
  return url.href;
};
importScripts(asset('../vendor/xlsx.core.min.js'), asset('import1c.js'), asset('import.js'));

self.onmessage = async ({ data: file }) => {
  try {
    const X = self.XLSX;
    const book = X.read(await file.arrayBuffer(), { type: 'array', dense: true, cellDates: true, cellHTML: false, sheets: 0 });
    const sheet = book.Sheets[book.SheetNames[0]];
    if (!sheet) throw new Error('В книге отсутствует первый лист');
    const raw = X.utils.sheet_to_json(sheet, { header: 1, defval: null, raw: true, range: 0 });
    const parsed = self.Doc1C.parse(raw);
    if (parsed.info.kind === 'kontr') {
      parsed.reps = self.RepImport.parseRows(X.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false }));
      if (!parsed.reps.length) throw new Error('В файле нет ни одного контрагента');
    }
    self.postMessage({ parsed });
  } catch (error) {
    self.postMessage({ error: error.message || 'Не удалось прочитать файл' });
  }
};
