# Записи на выплату

Веб-приложение: торговый представитель по персональной ссылке видит свои записи на выплату; администратор ведёт их в админ-панели.

- **Кабинет ТП:** `index.html#<токен>` — итоги (всего / начислено / к выплате / выплачено), список по месяцам, фильтр по статусу. Без логина и пароля.
- **Админ-панель:** `admin.html` — вход по email и паролю; представители (ссылка, отправка в WhatsApp, отключение, новая ссылка), магазины, записи на выплату.

## Стек
Статичный HTML/CSS/JS без сборки, [supabase-js](https://github.com/supabase/supabase-js) 2.118 (лежит в `vendor/`), Supabase (PostgreSQL + Auth), хостинг — GitHub Pages.

## Безопасность
- RLS на всех таблицах: читать и писать может только email из таблицы `admins`.
- Представитель не обращается к таблицам: только RPC `get_rep_payouts(token)`, возвращает данные одного активного ТП.
- Токен: 144 бита случайности. Передаётся в `#фрагменте` URL, поэтому не попадает в логи сервера и заголовок Referer.
- «Новая ссылка» отзывает старую, «Отключить» закрывает доступ сразу.

## Первый запуск
1. **Settings → Pages → Source: GitHub Actions** (один раз).
2. Открыть `https://dexauron.github.io/Zapisi_na_viplatu/admin.html`, ввести `dexauron@gmail.com` и пароль, нажать «Создать учётную запись», подтвердить email по ссылке из письма, войти.
3. Добавить другого админа: `insert into public.admins(email) values ('mail@example.com');` в SQL-редакторе Supabase.

## Схема БД
`supabase/migrations/20261030_init.sql` — `reps`, `stores`, `payouts` (сумма `numeric(12,2)`, статус `accrued | to_pay | paid`, `paid_at` ставится триггером), `admins`.

## Скилы для ИИ-агентов
`.agents/skills/` — официальные скилы Supabase (`supabase`, `supabase-postgres-best-practices`), установлены через `npx skills add supabase/agent-skills`.
