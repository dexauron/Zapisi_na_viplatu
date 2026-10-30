(function () {
  const { sb, STATUS, fmtMoney, fmtDate, esc, badge, sumBy } = window.App;
  const $ = (id) => document.getElementById(id);
  const state = { reps: [], stores: [], payouts: [], editId: null };

  // ---------- сообщения ----------
  let msgTimer;
  function say(text, isErr = false) {
    const el = $('msg');
    el.textContent = text; el.classList.toggle('err', isErr); el.classList.remove('hidden');
    clearTimeout(msgTimer); msgTimer = setTimeout(() => el.classList.add('hidden'), isErr ? 8000 : 3000);
  }
  const check = ({ error }, okText) => {
    if (error) { say(humanError(error), true); return false; }
    if (okText) say(okText);
    return true;
  };
  function humanError(e) {
    const m = e.message || String(e);
    if (/foreign key/i.test(m)) return 'Нельзя удалить: есть связанные записи на выплату.';
    if (/duplicate key/i.test(m)) return 'Такая запись уже существует.';
    if (/Invalid login/i.test(m)) return 'Неверный email или пароль.';
    if (/Email not confirmed/i.test(m)) return 'Email не подтверждён — откройте письмо со ссылкой подтверждения.';
    return m;
  }

  // ---------- авторизация ----------
  async function onSession(session) {
    const authed = !!session;
    $('login').classList.toggle('hidden', authed);
    $('logout').classList.toggle('hidden', !authed);
    $('who').textContent = authed ? session.user.email : '';
    if (!authed) { $('app').classList.add('hidden'); return; }
    const { data } = await sb.from('admins').select('email').maybeSingle();
    if (!data) { $('app').classList.add('hidden'); say('У этой учётной записи нет прав администратора.', true); return; }
    $('app').classList.remove('hidden');
    await loadAll();
  }

  $('login').addEventListener('submit', async (e) => {
    e.preventDefault();
    const res = await sb.auth.signInWithPassword({ email: $('email').value.trim(), password: $('password').value });
    if (check(res)) onSession(res.data.session);
  });
  $('signup').addEventListener('click', async () => {
    const email = $('email').value.trim(), password = $('password').value;
    if (!email || password.length < 8) return say('Введите email и пароль (не короче 8 символов).', true);
    const res = await sb.auth.signUp({ email, password, options: { emailRedirectTo: location.href.split('#')[0] } });
    if (check(res)) say('Учётная запись создана. Подтвердите email по ссылке из письма, затем войдите.');
  });
  $('logout').addEventListener('click', async () => { await sb.auth.signOut(); onSession(null); });

  // ---------- вкладки ----------
  document.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => {
    document.querySelectorAll('.tabs button').forEach((x) => x.classList.toggle('active', x === b));
    ['payouts', 'reps', 'stores'].forEach((t) => $('tab-' + t).classList.toggle('hidden', t !== b.dataset.tab));
  }));

  // ---------- данные ----------
  async function loadAll() {
    const [r, s, p] = await Promise.all([
      sb.from('reps').select('*').order('full_name'),
      sb.from('stores').select('*').order('name'),
      sb.from('payouts').select('*').order('payout_date', { ascending: false }).order('created_at', { ascending: false }),
    ]);
    for (const res of [r, s, p]) if (!check(res)) return;
    state.reps = r.data; state.stores = s.data; state.payouts = p.data;
    fillSelects(); renderPayouts(); renderReps(); renderStores();
  }

  const repName = (id) => state.reps.find((r) => r.id === id)?.full_name || '—';
  const storeName = (id) => state.stores.find((s) => s.id === id)?.name || '—';
  const opts = (items, label, sel) => items.map((i) => `<option value="${i.id}" ${i.id === sel ? 'selected' : ''}>${esc(label(i))}</option>`).join('');
  const statusOpts = (sel) => Object.entries(STATUS).map(([k, v]) => `<option value="${k}" ${k === sel ? 'selected' : ''}>${v.label}</option>`).join('');

  function fillSelects() {
    const keepRep = $('f-rep').value;
    $('f-rep').innerHTML = '<option value="">Все</option>' + opts(state.reps, (r) => r.full_name + (r.active ? '' : ' (откл.)'), keepRep);
    if (!$('f-status').options.length || $('f-status').options.length === 1)
      $('f-status').innerHTML = '<option value="">Все</option>' + statusOpts('');
  }

  // ---------- выплаты ----------
  function filtered() {
    const rep = $('f-rep').value, st = $('f-status').value, m = $('f-month').value;
    return state.payouts.filter((p) => (!rep || p.rep_id === rep) && (!st || p.status === st) && (!m || p.payout_date.startsWith(m)));
  }
  function renderPayouts() {
    const rows = filtered();
    $('p-total').textContent = `${rows.length} зап. · ${fmtMoney(sumBy(rows, () => true))} · к выплате ${fmtMoney(sumBy(rows, (r) => r.status === 'to_pay'))}`;
    $('p-body').innerHTML = rows.length ? rows.map((p) => `<tr>
      <td>${fmtDate(p.payout_date)}</td><td>${esc(repName(p.rep_id))}</td><td>${esc(p.store_id ? storeName(p.store_id) : '—')}</td>
      <td class="small">${esc(p.basis || '')}${p.comment ? `<div class="muted">${esc(p.comment)}</div>` : ''}</td>
      <td class="num">${fmtMoney(p.amount)}</td>
      <td><select data-st="${p.id}" style="min-width:120px">${statusOpts(p.status)}</select></td>
      <td><button class="link" data-edit="${p.id}">Изменить</button></td></tr>`).join('')
      : '<tr><td colspan="7" class="empty">Записей нет</td></tr>';
  }
  ['f-rep', 'f-status', 'f-month'].forEach((id) => $(id).addEventListener('change', renderPayouts));

  $('p-body').addEventListener('change', async (e) => {
    const id = e.target.dataset.st; if (!id) return;
    const res = await sb.from('payouts').update({ status: e.target.value }).eq('id', id).select().single();
    if (check(res, 'Статус обновлён')) { Object.assign(state.payouts.find((p) => p.id === id), res.data); renderPayouts(); }
    else renderPayouts();
  });
  $('p-body').addEventListener('click', (e) => { const id = e.target.dataset.edit; if (id) openPayout(id); });
  $('add-payout').addEventListener('click', () => openPayout(null));

  function openPayout(id) {
    if (!state.reps.some((r) => r.active)) return say('Сначала добавьте представителя.', true);
    const p = id ? state.payouts.find((x) => x.id === id) : null;
    state.editId = id;
    $('pdlg-title').textContent = id ? 'Изменить запись' : 'Новая запись';
    $('p-rep').innerHTML = opts(state.reps.filter((r) => r.active || r.id === p?.rep_id), (r) => r.full_name, p?.rep_id || $('f-rep').value);
    $('p-store').innerHTML = '<option value="">—</option>' + opts(state.stores, (s) => s.name, p?.store_id);
    $('p-date').value = p?.payout_date || new Date().toLocaleDateString('sv-SE');
    $('p-amount').value = p?.amount ?? '';
    $('p-status').innerHTML = statusOpts(p?.status || 'accrued');
    $('p-basis').value = p?.basis || '';
    $('p-comment').value = p?.comment || '';
    $('p-delete').classList.toggle('hidden', !id);
    $('pdlg').showModal();
  }

  $('pform').addEventListener('submit', async (e) => {
    if (e.submitter?.value !== 'save') return;
    e.preventDefault();
    const amount = Math.round(parseFloat(String($('p-amount').value).replace(',', '.')) * 100) / 100;
    if (!(amount > 0)) return say('Сумма должна быть больше нуля.', true);
    const row = {
      rep_id: $('p-rep').value, store_id: $('p-store').value || null, payout_date: $('p-date').value,
      amount, status: $('p-status').value,
      basis: $('p-basis').value.trim() || null, comment: $('p-comment').value.trim() || null,
    };
    const q = state.editId ? sb.from('payouts').update(row).eq('id', state.editId) : sb.from('payouts').insert(row);
    const res = await q.select().single();
    if (!check(res, 'Сохранено')) return;
    if (state.editId) Object.assign(state.payouts.find((p) => p.id === state.editId), res.data);
    else state.payouts.unshift(res.data);
    state.payouts.sort((a, b) => b.payout_date.localeCompare(a.payout_date));
    $('pdlg').close(); renderPayouts();
  });
  $('p-delete').addEventListener('click', async () => {
    if (!confirm('Удалить запись без возможности восстановления?')) return;
    const res = await sb.from('payouts').delete().eq('id', state.editId);
    if (!check(res, 'Удалено')) return;
    state.payouts = state.payouts.filter((p) => p.id !== state.editId);
    $('pdlg').close(); renderPayouts();
  });

  // ---------- представители ----------
  const repLink = (t) => new URL('index.html', location.href).href.split('#')[0] + '#' + t;
  const newToken = () => Array.from(crypto.getRandomValues(new Uint8Array(18)), (b) => b.toString(16).padStart(2, '0')).join('');

  function renderReps() {
    $('r-body').innerHTML = state.reps.map((r) => `<tr>
      <td>${esc(r.full_name)}</td><td>${esc(r.phone || '')}</td>
      <td>${r.active ? '<span class="badge st-paid">Активен</span>' : '<span class="badge">Отключён</span>'}</td>
      <td><button class="link" data-copy="${r.id}">Копировать</button><button class="link" data-wa="${r.id}">WhatsApp</button></td>
      <td class="row"><button class="link" data-toggle="${r.id}">${r.active ? 'Отключить' : 'Включить'}</button>
        <button class="link" data-regen="${r.id}">Новая ссылка</button><button class="link danger" data-del="${r.id}">Удалить</button></td></tr>`).join('')
      || '<tr><td colspan="5" class="empty">Нет представителей</td></tr>';
  }
  $('rep-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const res = await sb.from('reps').insert({ full_name: $('r-name').value.trim(), phone: $('r-phone').value.trim() || null }).select().single();
    if (!check(res, 'Представитель добавлен')) return;
    state.reps.push(res.data); state.reps.sort((a, b) => a.full_name.localeCompare(b.full_name, 'ru'));
    e.target.reset(); fillSelects(); renderReps();
  });
  $('r-body').addEventListener('click', async (e) => {
    const d = e.target.dataset, id = d.copy || d.wa || d.toggle || d.regen || d.del; if (!id) return;
    const rep = state.reps.find((r) => r.id === id);
    if (d.copy) { await navigator.clipboard.writeText(repLink(rep.access_token)); return say('Ссылка скопирована'); }
    if (d.wa) {
      const text = `${rep.full_name}, ваши записи на выплату: ${repLink(rep.access_token)}`;
      const phone = (rep.phone || '').replace(/\D/g, '').replace(/^8(?=\d{10}$)/, '7');
      return window.open(`https://wa.me/${phone}?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
    }
    let patch;
    if (d.toggle) patch = { active: !rep.active };
    if (d.regen) { if (!confirm('Старая ссылка перестанет работать. Продолжить?')) return; patch = { access_token: newToken() }; }
    if (d.del) {
      if (!confirm(`Удалить «${rep.full_name}»?`)) return;
      if (!check(await sb.from('reps').delete().eq('id', id), 'Удалено')) return;
      state.reps = state.reps.filter((r) => r.id !== id); fillSelects(); renderReps(); return;
    }
    const res = await sb.from('reps').update(patch).eq('id', id).select().single();
    if (check(res, d.regen ? 'Новая ссылка создана — отправьте её представителю' : 'Сохранено')) {
      Object.assign(rep, res.data); fillSelects(); renderReps();
    }
  });

  // ---------- магазины ----------
  function renderStores() {
    $('s-body').innerHTML = state.stores.map((s) => `<tr><td>${esc(s.name)}</td><td>${esc(s.address || '')}</td>
      <td><button class="link danger" data-del="${s.id}">Удалить</button></td></tr>`).join('')
      || '<tr><td colspan="3" class="empty">Нет магазинов</td></tr>';
  }
  $('store-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const res = await sb.from('stores').insert({ name: $('s-name').value.trim(), address: $('s-address').value.trim() || null }).select().single();
    if (!check(res, 'Магазин добавлен')) return;
    state.stores.push(res.data); state.stores.sort((a, b) => a.name.localeCompare(b.name, 'ru'));
    e.target.reset(); renderStores();
  });
  $('s-body').addEventListener('click', async (e) => {
    const id = e.target.dataset.del; if (!id) return;
    const st = state.stores.find((s) => s.id === id);
    if (!confirm(`Удалить «${st.name}»?`)) return;
    if (!check(await sb.from('stores').delete().eq('id', id), 'Удалено')) return;
    state.stores = state.stores.filter((s) => s.id !== id); renderStores();
  });

  // ---------- старт ----------
  sb.auth.getSession().then(({ data }) => onSession(data.session));
})();
