-- Снимки регистров 1С за период. Финансовые движения остаются в таблице docs.
create table public.one_c_register_reports (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('returns_by_reason', 'writeoff_reasons')),
  period_start date not null,
  period_end date not null check (period_end >= period_start),
  imported_at timestamptz not null default now(),
  row_count integer not null check (row_count between 0 and 100000),
  summary jsonb not null check (
    coalesce(jsonb_typeof(summary -> 'total' -> 'cost') = 'number'
      and jsonb_typeof(summary -> 'reasons') = 'array', false)
  ),
  -- Денежные значения внутри JSON хранятся в копейках, количество — в тысячных долях.
  rows jsonb not null check (
    case when jsonb_typeof(rows) = 'array' then jsonb_array_length(rows) = row_count else false end
  ),
  unique (kind, period_start, period_end)
);

alter table public.one_c_register_reports enable row level security;
revoke all on public.one_c_register_reports from public, anon, authenticated, service_role;
grant select, insert, update on public.one_c_register_reports to authenticated;
grant select on public.one_c_register_reports to service_role;

create policy register_reports_select on public.one_c_register_reports
  for select to authenticated using ((select private.is_admin()));
create policy register_reports_insert on public.one_c_register_reports
  for insert to authenticated with check ((select private.is_admin()));
create policy register_reports_update on public.one_c_register_reports
  for update to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));
