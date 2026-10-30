// Шаблон. На GitHub Pages файл assets/config.js создаётся при сборке из переменных репозитория
// SUPABASE_URL и SUPABASE_PUBLISHABLE_KEY (Settings → Secrets and variables → Actions → Variables).
// Локально: скопируйте в assets/config.js и впишите адрес и публичный ключ тестового проекта.
// Публичный ключ (sb_publishable_…) не секрет: защита держится на RLS и функции get_rep_data.
window.APP_CONFIG = {
  SUPABASE_URL: 'https://<project-ref>.supabase.co',
  SUPABASE_KEY: 'sb_publishable_…',
};
