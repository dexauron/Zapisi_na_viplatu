# Запуск и выкладка

## Изменение выдачи денег — пакет 20 ноября 2026
Перед выкладкой интерфейса применить три новые миграции по порядку: `20261118112516_payout_reserved_status.sql`, `20261118112643_payout_handover_and_audit.sql`, затем `20261120081500_repair_existing_invoice_links.sql`. Значение enum и использующая его логика должны выполняться в **разных транзакциях**. Не запускать заново старые миграции, если они уже применены в рабочем проекте. Третья миграция исправляет прежние неверные связи, сохраняя сами выплаты и фактическую выдачу.

20 ноября все три файла применены к рабочему проекту `umwystttvkrgentkddik` и записаны в историю миграций. Повторно выполнять их на этом проекте не нужно.

Старые оплаты не переоткрываются пакетно. После выкладки сверить оставшиеся конверты и прежние отметки без подтверждения выдачи. Рабочая приёмка и границы выполненного аудита — `AUDIT-2026-11-20.md`; проверки интерфейса — `../tests/README.md`.

## Интерфейс на GitHub Pages
1. Settings → Pages → Build and deployment → Source: **GitHub Actions**.
2. Settings → Secrets and variables → Actions → вкладка **Variables** → New repository variable:
   - `SUPABASE_URL` — `https://<ref>.supabase.co` (Supabase → Project Settings → API);
   - `SUPABASE_PUBLISHABLE_KEY` — публичный ключ `sb_publishable_…` (не секрет: виден в браузере, защита — RLS).
3. Любой push в `main` пересобирает сайт: `https://dexauron.github.io/Zapisi_na_viplatu/`.
   Без переменных сборка останавливается с понятной ошибкой, а на сайте остаётся прошлая версия.

## Локальная разработка
```bash
cp assets/config.example.js assets/config.js   # вписать адрес и публичный ключ
python3 -m http.server 8080                     # http://localhost:8080/app.html
```

## База
Изменения схемы — только новые файлы в `supabase/migrations/`.
```bash
npx supabase@2.119.0 start -x gotrue,realtime,imgproxy,kong,mailpit,postgrest,postgres-meta,studio,edge-runtime,logflare,vector,supavisor
supabase/tests/run.sh
npx supabase@2.119.0 stop
```
Применение к облаку: `npx supabase@2.119.0 link --project-ref <ref>` и `npx supabase@2.119.0 db push`, или через Claude (MCP).
В облаке миграции применены через MCP под теми же именами (`init`, `v2_staff_orders`), но с другими временными номерами —
перед `db push` сверяйте имена и SQL, старые миграции не повторять.

## Функция учёток сотрудников
`npx supabase@2.119.0 functions deploy staff-admin --no-verify-jwt` (или через Claude).
Проверка JWT шлюзом выключена намеренно: функция сама проверяет вход и роль админа, ключ сервиса есть только на сервере.

## Настройки Supabase (один раз)
- Authentication → Sign In / Providers → выключить **Allow new users to sign up** (учётки выдаёт только админ).
  Провайдер **Email** оставить: через него входят по логину и паролю (писем не отправляется).
- Authentication → Attack Protection → включить проверку утёкших паролей.

## Первый админ
Email из таблицы `admins` при первом входе получает роль админа (`ensure_profile`).
Учётку создать: Supabase → Authentication → Users → Add user → email, пароль, **Auto Confirm User**.

## База не засыпает
`.github/workflows/keepalive.yml` раз в день делает один гостевой запрос (бесплатный Supabase засыпает после 7 дней без запросов).
Ничего настраивать не нужно — используются те же переменные `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`.

## Ночная выгрузка данных
`.github/workflows/backup.yml` каждую ночь (02:17 МСК) выгружает рабочие таблицы в Excel и JSON и упаковывает в 7z с паролем.
1. Settings → Secrets and variables → Actions → **Secrets** → New repository secret:
   - `SUPABASE_SECRET_KEY` — Supabase → Project Settings → API Keys → Secret keys (`sb_secret_…`);
   - `BACKUP_PASSWORD` — свой пароль от архивов (без него архив не открыть).
2. Скачать копию: Actions → «Резервная копия» → нужный запуск → Artifacts → `sverka-backup` (хранится 30 дней).
   Открыть: 7-Zip / «Архиватор» → пароль `BACKUP_PASSWORD`.
Для полного восстановления проекта нужна отдельная резервная копия PostgreSQL с рабочей схемой, Auth и приватными таблицами. Ночная выгрузка читает таблицы отдельными запросами, поэтому при работе пользователей они могут относиться к разным моментам времени.
