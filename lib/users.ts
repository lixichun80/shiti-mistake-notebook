import { env } from "cloudflare:workers";
import { trialEndFrom } from "@/lib/trial";

/**
 * 拾题 · 智能错题本 —— `users` 表的读写都收在这里
 *
 * 集中一处的实际理由：`session_epoch` 必须出现在**每一条**取用户的 SQL 里。
 * 漏掉它，回查出来的 epoch 就是 undefined，跟 cookie 里的 0 一比必然不等，
 * 结果是所有人当场全部登出，而且现有断言一条都不会变红。用一份 COLUMNS 常量
 * 就能让这个错误无处可犯。
 *
 * 错误约定：**查库失败一律抛异常**，不吞成 null。调用方必须把「没这行」和
 * 「查询出错」分开处理，前者是未登录，后者是 503。折叠成 null 会让数据库故障
 * 表现成「所有人都掉线」。
 */

export type UserRole = "user" | "admin";
export type UserStatus = "active" | "disabled";

export type UserRecord = {
  id: string;
  username: string;
  passwordHash: string;
  displayName: string;
  role: UserRole;
  status: UserStatus;
  sessionEpoch: number;
  createdAt: string;
  lastLoginAt: string | null;
  trialEndsAt: string | null;
};

type UserRow = {
  id: string;
  username: string;
  password_hash: string;
  display_name: string;
  role: string;
  status: string;
  session_epoch: number;
  created_at: string;
  last_login_at: string | null;
  trial_ends_at: string | null;
};

const COLUMNS =
  "id, username, password_hash, display_name, role, status, session_epoch, created_at, last_login_at, trial_ends_at";

function db(): D1Database {
  if (!env.DB) throw new Error("D1 绑定缺失（env.DB），无法读写账号");
  return env.DB;
}

function toRecord(row: UserRow): UserRecord {
  return {
    id: row.id,
    username: row.username,
    passwordHash: row.password_hash,
    displayName: row.display_name,
    // 库里是自由文本，收窄到字面量类型。认不出来的值一律按最保守的算：
    // role 当普通用户（不给管理员），status 当停用（不放行）。
    role: row.role === "admin" ? "admin" : "user",
    status: row.status === "active" ? "active" : "disabled",
    sessionEpoch: Number.isSafeInteger(row.session_epoch) ? row.session_epoch : 0,
    createdAt: row.created_at,
    lastLoginAt: row.last_login_at ?? null,
    trialEndsAt: row.trial_ends_at ?? null,
  };
}

/* ------------------------------------------------------------------ *
 * 查
 * ------------------------------------------------------------------ */

export async function findUserById(id: string): Promise<UserRecord | null> {
  const row = await db()
    .prepare(`SELECT ${COLUMNS} FROM users WHERE id = ?`)
    .bind(id)
    .first<UserRow>();
  return row ? toRecord(row) : null;
}

export async function findUserByUsername(username: string): Promise<UserRecord | null> {
  const row = await db()
    .prepare(`SELECT ${COLUMNS} FROM users WHERE username = ?`)
    .bind(username)
    .first<UserRow>();
  return row ? toRecord(row) : null;
}

export type AdminUserRow = {
  id: string;
  username: string;
  displayName: string;
  role: UserRole;
  status: UserStatus;
  createdAt: string;
  lastLoginAt: string | null;
  wechat: string | null;
  trialEndsAt: string | null;
  mistakeCount: number;
};

/** 后台列表。错题数用 LEFT JOIN 一次算出来，不要每个用户再查一次（N+1）。 */
export async function listUsersWithCounts(): Promise<AdminUserRow[]> {
  const { results } = await db()
    .prepare(
      "SELECT u.id, u.username, u.display_name, u.role, u.status, u.created_at, u.last_login_at, u.wechat, u.trial_ends_at, " +
        "COUNT(m.id) AS mistake_count " +
        "FROM users u LEFT JOIN mistakes m ON m.user_id = u.id " +
        "GROUP BY u.id ORDER BY u.created_at",
    )
    .all<Omit<UserRow, "password_hash" | "session_epoch"> & { wechat: string | null; mistake_count: number }>();

  return results.map((row) => ({
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    role: row.role === "admin" ? "admin" : "user",
    status: row.status === "active" ? "active" : "disabled",
    createdAt: row.created_at,
    lastLoginAt: row.last_login_at ?? null,
    wechat: row.wechat || null,
    trialEndsAt: row.trial_ends_at ?? null,
    mistakeCount: Number(row.mistake_count ?? 0),
  }));
}

export async function countAdmins(): Promise<number> {
  const row = await db()
    .prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'")
    .first<{ n: number }>();
  return Number(row?.n ?? 0);
}

/* ------------------------------------------------------------------ *
 * 写
 * ------------------------------------------------------------------ */

export type NewUser = {
  id: string;
  username: string;
  passwordHash: string;
  displayName: string;
  role?: UserRole;
  wechat?: string | null;
  startTrial?: boolean;
};

export async function insertUser(user: NewUser): Promise<void> {
  const now = Date.now();
  await db()
    .prepare(
      "INSERT INTO users (id, username, password_hash, display_name, role, status, session_epoch, created_at, wechat, trial_ends_at) " +
        "VALUES (?, ?, ?, ?, ?, 'active', 0, ?, ?, ?)",
    )
    .bind(
      user.id,
      user.username,
      user.passwordHash,
      user.displayName,
      user.role ?? "user",
      new Date(now).toISOString(),
      user.wechat || null,
      user.startTrial ? trialEndFrom(now) : null,
    )
    .run();
}

export async function setTrialEndsAt(id: string, trialEndsAt: string | null): Promise<void> {
  await db().prepare("UPDATE users SET trial_ends_at = ? WHERE id = ?").bind(trialEndsAt, id).run();
}

/** 用户名撞车靠唯一索引发现，不要「先查再插」——那样有竞态。 */
export function isUniqueViolation(error: unknown): boolean {
  return error instanceof Error && /UNIQUE constraint failed/i.test(error.message);
}

export async function setDisplayName(id: string, displayName: string): Promise<void> {
  await db().prepare("UPDATE users SET display_name = ? WHERE id = ?").bind(displayName, id).run();
}

/** 空字符串存成 NULL，后台列表统一显示「未填写」。 */
export async function setWechat(id: string, wechat: string): Promise<void> {
  await db().prepare("UPDATE users SET wechat = ? WHERE id = ?").bind(wechat || null, id).run();
}

export async function setRole(id: string, role: UserRole): Promise<void> {
  await db().prepare("UPDATE users SET role = ? WHERE id = ?").bind(role, id).run();
}

/**
 * 停用 / 启用。两种方向都递增 `session_epoch`，把这个用户已签发的 cookie 全部作废。
 * 启用时也递增是有意的：被停用期间旧 cookie 不该「复活」。
 */
export async function setStatus(id: string, status: UserStatus): Promise<void> {
  await db()
    .prepare("UPDATE users SET status = ?, session_epoch = session_epoch + 1 WHERE id = ?")
    .bind(status, id)
    .run();
}

/** 重置密码，并递增 `session_epoch` —— 否则旧 cookie 还能用到 30 天后过期。 */
export async function setPassword(id: string, passwordHash: string): Promise<void> {
  await db()
    .prepare("UPDATE users SET password_hash = ?, session_epoch = session_epoch + 1 WHERE id = ?")
    .bind(passwordHash, id)
    .run();
}

export async function touchLastLogin(id: string): Promise<void> {
  await db()
    .prepare("UPDATE users SET last_login_at = ? WHERE id = ?")
    .bind(new Date().toISOString(), id)
    .run();
}

/* ------------------------------------------------------------------ *
 * 删除（级联）
 * ------------------------------------------------------------------ */

/** `uploads.file_keys` 是 JSON 数组，这里摊平成 R2 对象键清单，好交给 BUCKET.delete。 */
export async function listUploadFileKeys(userId: string): Promise<string[]> {
  const { results } = await db()
    .prepare("SELECT file_keys FROM uploads WHERE user_id = ?")
    .bind(userId)
    .all<{ file_keys: string }>();

  const keys: string[] = [];
  for (const row of results) {
    try {
      const parsed: unknown = JSON.parse(row.file_keys || "[]");
      if (!Array.isArray(parsed)) continue;
      for (const key of parsed) if (typeof key === "string" && key) keys.push(key);
    } catch {
      // 单条脏数据不该卡住整个删除流程，跳过即可
    }
  }
  return keys;
}

/**
 * 删掉这个用户在库里的全部痕迹。
 *
 * `users.id` 是 `uploads.user_id` / `mistakes.user_id` 的取值来源，但**没有外键约束**，
 * 所以级联必须手工做。`mistakes` 先删（它引用 `uploads`），再删 `uploads`，最后删用户。
 * 三条放进一个 batch：D1 的 batch 是事务性的，不会留下删一半的账号。
 */
export async function deleteUserRows(userId: string): Promise<void> {
  const conn = db();
  await conn.batch([
    conn.prepare("DELETE FROM mistakes WHERE user_id = ?").bind(userId),
    conn.prepare("DELETE FROM uploads WHERE user_id = ?").bind(userId),
    conn.prepare("DELETE FROM users WHERE id = ?").bind(userId),
  ]);
}
