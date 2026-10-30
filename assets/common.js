(function () {
  const { SUPABASE_URL, SUPABASE_KEY } = window.APP_CONFIG;
  const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

  const STATUS = {
    accrued: { label: 'Начислено', cls: 'st-accrued' },
    to_pay: { label: 'К выплате', cls: 'st-topay' },
    paid: { label: 'Выплачено', cls: 'st-paid' },
  };

  const money = new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', minimumFractionDigits: 2 });
  const fmtMoney = (v) => money.format(Number(v || 0));
  const fmtDate = (d) => (d ? new Date(d + (d.length === 10 ? 'T00:00:00' : '')).toLocaleDateString('ru-RU') : '');
  const fmtMonth = (d) => {
    const s = new Date(d + 'T00:00:00').toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' });
    return s.charAt(0).toUpperCase() + s.slice(1);
  };
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const badge = (st) => `<span class="badge ${STATUS[st]?.cls || ''}">${esc(STATUS[st]?.label || st)}</span>`;

  // Суммы в копейках — без ошибок округления float
  const sumBy = (rows, pred) => rows.filter(pred).reduce((a, r) => a + Math.round(Number(r.amount) * 100), 0) / 100;

  window.App = { sb, STATUS, fmtMoney, fmtDate, fmtMonth, esc, badge, sumBy };
})();
