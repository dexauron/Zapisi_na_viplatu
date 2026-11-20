-- Исправляем связи, созданные до защиты от смены контрагента накладной.
-- Триггер сохраняет фактическую выдачу и помечает связь для ручной проверки;
-- номер накладной и сама запись остаются, автоматический подбор блокируется.
update public.payouts p set doc_id = null
where p.doc_id is not null and not exists (
  select 1 from public.docs d
  where d.id = p.doc_id and d.rep_id = p.rep_id and d.kind = 'in' and not d.deleted
);

update public.orders o set doc_id = null, actual_amount = null
where o.doc_id is not null and not exists (
  select 1 from public.docs d
  where d.id = o.doc_id and d.rep_id = o.rep_id and d.kind = 'in' and not d.deleted
);
