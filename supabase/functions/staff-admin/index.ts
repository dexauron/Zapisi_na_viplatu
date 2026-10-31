// Управление учётками сотрудников и представителей. Только для активного админа.
// Ключ сервиса живёт только здесь, в браузер не попадает.
import { createClient } from "npm:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const LOGIN_RE = /^[a-z0-9._-]{3,32}$/;
const DOMAIN = "staff.zapisi.app";
const REP_DOMAIN = "rep.zapisi.app"; // учётки представителей: видят только своё через my_rep_data()

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Метод не поддерживается" }, 405);

  const url = Deno.env.get("SUPABASE_URL")!;
  const service = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: { user } } = await service.auth.getUser(jwt);
  if (!user) return json({ error: "Нужен вход" }, 401);

  const { data: me } = await service.from("staff").select("role, active").eq("user_id", user.id).maybeSingle();
  if (!me || me.role !== "admin" || !me.active) return json({ error: "Только для администратора" }, 403);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: "Неверный запрос" }, 400); }

  if (body.action === "create") {
    const login = String(body.login ?? "").trim().toLowerCase();
    const full_name = String(body.full_name ?? "").trim();
    const password = String(body.password ?? "");
    const role = body.role === "admin" ? "admin" : "employee";
    if (!LOGIN_RE.test(login)) return json({ error: "Логин: 3–32 символа, латиница, цифры, . _ -" }, 400);
    if (!full_name) return json({ error: "Укажите имя" }, 400);
    if (password.length < 6) return json({ error: "Пароль не короче 6 символов" }, 400);

    const { data: exists } = await service.from("staff").select("user_id").eq("login", login).maybeSingle();
    if (exists) return json({ error: "Такой логин уже занят" }, 409);

    const { data: created, error } = await service.auth.admin.createUser({
      email: `${login}@${DOMAIN}`, password, email_confirm: true, user_metadata: { full_name },
    });
    if (error || !created.user) return json({ error: error?.message ?? "Не удалось создать" }, 400);

    const { data: row, error: e2 } = await service.from("staff")
      .insert({ user_id: created.user.id, login, full_name, role }).select().single();
    if (e2) { await service.auth.admin.deleteUser(created.user.id); return json({ error: e2.message }, 400); }
    return json({ staff: row });
  }

  if (body.action === "update") {
    const id = String(body.user_id ?? "");
    const patch: Record<string, unknown> = {};
    if (typeof body.full_name === "string" && body.full_name.trim()) patch.full_name = body.full_name.trim();
    if (body.role === "admin" || body.role === "employee") patch.role = body.role;
    if (typeof body.active === "boolean") patch.active = body.active;
    if (id === user.id && (patch.role === "employee" || patch.active === false))
      return json({ error: "Нельзя снять права или отключить самого себя" }, 400);

    const auth: Record<string, unknown> = {};
    if (body.password != null) {
      if (String(body.password).length < 6) return json({ error: "Пароль не короче 6 символов" }, 400);
      auth.password = String(body.password);
    }
    if (typeof body.active === "boolean") auth.ban_duration = body.active ? "none" : "876000h";
    if (Object.keys(auth).length) {
      const { error } = await service.auth.admin.updateUserById(id, auth);
      if (error) return json({ error: error.message }, 400);
    }
    let row = null;
    if (Object.keys(patch).length) {
      const { data, error } = await service.from("staff").update(patch).eq("user_id", id).select().single();
      if (error) return json({ error: error.message }, 400);
      row = data;
    }
    return json({ staff: row });
  }

  if (body.action === "delete") {
    const id = String(body.user_id ?? "");
    if (!id || id === user.id) return json({ error: "Нельзя удалить самого себя" }, 400);
    // записи сотрудника остаются: в заказах автор станет пустым, история изменений сохранится
    const { error } = await service.auth.admin.deleteUser(id);
    if (error) return json({ error: error.message }, 400);
    return json({ deleted: id });
  }

  // ---- Представители: логин и пароль для кабинета (по желанию админа, вместе с личной ссылкой) ----
  if (body.action === "rep_create") {
    const rep_id = String(body.rep_id ?? "");
    const login = String(body.login ?? "").trim().toLowerCase();
    const password = String(body.password ?? "");
    if (!LOGIN_RE.test(login)) return json({ error: "Логин: 3–32 символа, латиница, цифры, . _ -" }, 400);
    if (password.length < 6) return json({ error: "Пароль не короче 6 символов" }, 400);
    const { data: rep } = await service.from("reps").select("id, full_name").eq("id", rep_id).maybeSingle();
    if (!rep) return json({ error: "Представитель не найден" }, 404);
    const { data: has } = await service.from("rep_users").select("login").eq("rep_id", rep_id).maybeSingle();
    if (has) return json({ error: `У представителя уже есть вход: ${has.login}` }, 409);
    const { data: busy } = await service.from("rep_users").select("rep_id").eq("login", login).maybeSingle();
    if (busy) return json({ error: "Такой логин уже занят" }, 409);

    const { data: created, error } = await service.auth.admin.createUser({
      email: `${login}@${REP_DOMAIN}`, password, email_confirm: true, user_metadata: { full_name: rep.full_name, rep: true },
    });
    if (error || !created.user) {
      return json({ error: /already/i.test(error?.message ?? "") ? "Такой логин уже занят" : error?.message ?? "Не удалось создать" }, 400);
    }
    const { data: row, error: e2 } = await service.from("rep_users")
      .insert({ user_id: created.user.id, rep_id, login }).select().single();
    if (e2) { await service.auth.admin.deleteUser(created.user.id); return json({ error: e2.message }, 400); }
    return json({ rep_user: row });
  }

  if (body.action === "rep_update" || body.action === "rep_delete") {
    const rep_id = String(body.rep_id ?? "");
    const { data: ru } = await service.from("rep_users").select("user_id, rep_id, login, active").eq("rep_id", rep_id).maybeSingle();
    if (!ru) return json({ error: "У представителя нет входа" }, 404);
    if (body.action === "rep_delete") {
      // строка rep_users уходит вместе с учёткой (on delete cascade); заказы и выплаты не затрагиваются
      const { error } = await service.auth.admin.deleteUser(ru.user_id);
      if (error) return json({ error: error.message }, 400);
      return json({ deleted: rep_id });
    }
    const auth: Record<string, unknown> = {};
    if (body.password != null) {
      if (String(body.password).length < 6) return json({ error: "Пароль не короче 6 символов" }, 400);
      auth.password = String(body.password);
    }
    if (typeof body.active === "boolean") auth.ban_duration = body.active ? "none" : "876000h";
    if (Object.keys(auth).length) {
      const { error } = await service.auth.admin.updateUserById(ru.user_id, auth);
      if (error) return json({ error: error.message }, 400);
    }
    let row = ru;
    if (typeof body.active === "boolean") {
      const { data, error } = await service.from("rep_users").update({ active: body.active }).eq("rep_id", rep_id).select().single();
      if (error) return json({ error: error.message }, 400);
      row = data;
    }
    return json({ rep_user: row });
  }

  return json({ error: "Неизвестное действие" }, 400);
});
