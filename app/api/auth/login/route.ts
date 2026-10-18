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
import { findUserByUsername, touchLastLogin } from "@/lib/users";

// 用户名错和密码错返回同一句话，避免泄露账号是否存在
const FAILURE_MESSAGE = "用户名或密码不正确";
const DISABLED_MESSAGE = "该账号已被停用，请联系管理员";
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

  let user;
  try {
    user = await findUserByUsername(username);
  } catch {
    return fail("存储服务暂不可用", 503);
  }

  let matched = false;
  if (user) {
    matched = await verifyPassword(password, user.passwordHash);
  } else {
    // 查无此人也要跑一次同代价的哈希，否则响应时间会泄露账号是否存在
    await burnPasswordTime(password);
  }

  if (!user || !matched) {
    await new Promise((resolve) => setTimeout(resolve, FAILURE_DELAY_MS));
    return fail(FAILURE_MESSAGE, 401);
  }

  // 停用判定放在密码校验**之后**：否则不知道密码的人也能靠响应文案
  // 探出哪些账号存在、并且被停用了。
  if (user.status !== "active") {
    await new Promise((resolve) => setTimeout(resolve, FAILURE_DELAY_MS));
    return fail(DISABLED_MESSAGE, 403);
  }

  // 带上 epoch：管理员之后重置密码或停用账号时，这个值会 +1，这张 cookie 随即作废。
  const token = await createSessionToken({
    userId: user.id,
    fullName: user.displayName,
    epoch: user.sessionEpoch,
  });
  const store = await cookies();
  store.set(SESSION_COOKIE, token, sessionCookieOptions(isHttpsRequest(request)));

  // 登录时间只用于后台列表展示。写失败不该把一次已经成功的登录变成 500 ——
  // cookie 已经下发，此时报错会让用户看到「登录失败」但其实已经登上了。
  try {
    await touchLastLogin(user.id);
  } catch {
    // 忽略
  }

  return Response.json(
    { ok: true, name: user.displayName },
    { headers: { "Cache-Control": "no-store" } },
  );
}
