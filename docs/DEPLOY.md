# Запуск и выкладка

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

## Резервная копия
`.github/workflows/backup.yml` каждую ночь (02:17 МСК) выгружает все таблицы в Excel и JSON и упаковывает в 7z с паролем.
1. Settings → Secrets and variables → Actions → **Secrets** → New repository secret:
   - `SUPABASE_SECRET_KEY` — Supabase → Project Settings → API Keys → Secret keys (`sb_secret_…`);
   - `BACKUP_PASSWORD` — свой пароль от архивов (без него архив не открыть).
2. Скачать копию: Actions → «Резервная копия» → нужный запуск → Artifacts → `sverka-backup` (хранится 30 дней).
   Открыть: 7-Zip / «Архиватор» → пароль `BACKUP_PASSWORD`.
Восстановление: таблицы из JSON вставляются через SQL-редактор Supabase в порядке stores → reps → rep_access → staff → orders → payouts.
