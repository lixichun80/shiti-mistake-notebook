import { env } from "cloudflare:workers";
import { cookies } from "next/headers";
import {
  SESSION_COOKIE,
  burnPasswordTime,
  createSessionToken,
  isHttpsRequest,
  isSameOriginRequest,
  sessionCookieOptions,
  verifyPassword,
} from "@/lib/auth";

type UserRow = { id: string; display_name: string; password_hash: string };

// 用户名错和密码错返回同一句话，避免泄露账号是否存在
const FAILURE_MESSAGE = "用户名或密码不正确";
// 失败后固定延迟，削弱暴力破解（nginx 那层还有 limit_req）
const FAILURE_DELAY_MS = 300;

function fail(error: string, status: number) {
  return Response.json({ error }, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return fail("请求来源不被允许", 403);

  let username = "";
  let password = "";
  try {
    const body = (await request.json()) as { username?: unknown; password?: unknown };
    if (typeof body.username === "string") username = body.username.trim().toLowerCase();
    if (typeof body.password === "string") password = body.password;
  } catch {
    return fail("请求格式不正确", 400);
  }

  if (!username || !password) return fail("请输入用户名和密码", 400);

  if (!env.DB) return fail("存储服务暂不可用", 503);
  if (!env.SESSION_SECRET) return fail("服务端未配置会话密钥，请联系管理员", 503);

  let row: UserRow | null = null;
  try {
    row = await env.DB.prepare(
      "SELECT id, display_name, password_hash FROM users WHERE username = ?",
    )
      .bind(username)
      .first<UserRow>();
  } catch {
    return fail("存储服务暂不可用", 503);
  }

  let matched = false;
  if (row) {
    matched = await verifyPassword(password, row.password_hash);
  } else {
    // 查无此人也要跑一次同代价的哈希，否则响应时间会泄露账号是否存在
    await burnPasswordTime(password);
  }

  if (!row || !matched) {
    await new Promise((resolve) => setTimeout(resolve, FAILURE_DELAY_MS));
    return fail(FAILURE_MESSAGE, 401);
  }

  const token = await createSessionToken({ userId: row.id, fullName: row.display_name });
  const store = await cookies();
  store.set(SESSION_COOKIE, token, sessionCookieOptions(isHttpsRequest(request)));

  return Response.json(
    { ok: true, name: row.display_name },
    { headers: { "Cache-Control": "no-store" } },
  );
}
