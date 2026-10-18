import { env } from "cloudflare:workers";
import { authenticateAdmin } from "@/lib/api-guard";
import { hashPassword } from "@/lib/auth";
import { insertUser, isUniqueViolation, listUsersWithCounts } from "@/lib/users";
import {
  checkDisplayName,
  checkPassword,
  checkUsername,
  checkWechat,
  normalizeUsername,
  normalizeWechat,
} from "@/lib/credentials";

function fail(error: string, status: number) {
  return Response.json({ error }, { status, headers: { "Cache-Control": "no-store" } });
}

export async function GET() {
  const auth = await authenticateAdmin();
  if ("response" in auth) return auth.response;

  try {
    return Response.json(
      { users: await listUsersWithCounts() },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return fail("读取账号列表失败", 503);
  }
}

/** 管理员直接建号。跟开放注册走同一套校验规则（见 lib/credentials.ts）。 */
export async function POST(request: Request) {
  const auth = await authenticateAdmin();
  if ("response" in auth) return auth.response;

  let username = "";
  let password = "";
  let displayName = "";
  let role = "user";
  let wechat = "";
  try {
    const body = (await request.json()) as {
      username?: unknown;
      password?: unknown;
      displayName?: unknown;
      role?: unknown;
      wechat?: unknown;
    };
    username = normalizeUsername(body.username);
    wechat = normalizeWechat(body.wechat);
    if (typeof body.password === "string") password = body.password;
    if (typeof body.displayName === "string") displayName = body.displayName.trim();
    if (body.role === "admin") role = "admin";
  } catch {
    return fail("请求格式不正确", 400);
  }

  const invalid =
    checkUsername(username) ??
    checkPassword(password) ??
    checkDisplayName(displayName) ??
    // 管理员建号时微信号选填：线下认识的人可能已经是好友了
    checkWechat(wechat, false);
  if (invalid) return fail(invalid, 400);

  if (!env.DB) return fail("存储服务暂不可用", 503);

  const id = crypto.randomUUID();
  try {
    await insertUser({
      id,
      username,
      passwordHash: await hashPassword(password),
      displayName: displayName || username,
      role: role === "admin" ? "admin" : "user",
      wechat,
    });
  } catch (error) {
    if (isUniqueViolation(error)) return fail("这个用户名已经被占用了", 409);
    return fail("创建账号失败，请稍后重试", 503);
  }

  return Response.json({ ok: true, id }, { headers: { "Cache-Control": "no-store" } });
}
