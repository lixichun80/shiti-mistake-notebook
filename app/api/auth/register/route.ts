import { env } from "cloudflare:workers";
import { cookies } from "next/headers";
import {
  SESSION_COOKIE,
  createSessionToken,
  hashPassword,
  isHttpsRequest,
  isSameOriginRequest,
  sessionCookieOptions,
} from "@/lib/auth";
import { insertUser, isUniqueViolation } from "@/lib/users";
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

/**
 * 开放注册。用户明确选择了「不做邀请码、不做注册开关」——客户是面对面交易，
 * 注册即等于已成为客户。唯一的约束是 nginx 侧对 /api/auth/register 的限流
 * （和登录共用一个 limit_req 区），否则这里会成为整站唯一无限流的写入口。
 */
export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return fail("请求来源不被允许", 403);

  let username = "";
  let password = "";
  let displayName = "";
  let wechat = "";
  try {
    const body = (await request.json()) as {
      username?: unknown;
      password?: unknown;
      displayName?: unknown;
      wechat?: unknown;
    };
    username = normalizeUsername(body.username);
    wechat = normalizeWechat(body.wechat);
    if (typeof body.password === "string") password = body.password;
    if (typeof body.displayName === "string") displayName = body.displayName.trim();
  } catch {
    return fail("请求格式不正确", 400);
  }

  const invalid =
    checkUsername(username) ??
    checkPassword(password) ??
    checkDisplayName(displayName) ??
    // 微信号注册时必填：注册即成为客户，管理员要靠它主动加好友联系
    checkWechat(wechat, true);
  if (invalid) return fail(invalid, 400);

  if (!env.DB) return fail("存储服务暂不可用", 503);
  if (!env.SESSION_SECRET) return fail("服务端未配置会话密钥，请联系管理员", 503);

  // 主键用随机值而不是用户名：它会成为 uploads.user_id / mistakes.user_id，
  // 还会拼进 R2 的对象键（`${userId}/${uploadId}/${i}`）。用随机值可以让
  // 用户名不出现在存储路径里。
  const id = crypto.randomUUID();
  const name = displayName || username;

  // 会话**先签、再落库**。反过来的话，密钥缺失或短于 32 位时（上面那条只判了
  // 「有没有」，签名时还会判「够不够长」）账号已经建好了，客户端却拿到 500；
  // 用户重试一次变成 409「用户名已被占用」，而他自己根本没有这个账号的密码概念，
  // 完全不知道该干什么。签不出来就当作整体没成功，一个字节都不落库。
  // 新账号的 session_epoch 是建表默认值 0，跟这里签进 cookie 的 0 对齐。
  let token: string;
  try {
    token = await createSessionToken({ userId: id, fullName: name, epoch: 0 });
  } catch {
    return fail("服务端未配置会话密钥，请联系管理员", 503);
  }

  const passwordHash = await hashPassword(password);
  try {
    await insertUser({ id, username, passwordHash, displayName: name, wechat });
  } catch (error) {
    // 唯一性交给 users_username_unique 索引来判。**不要**写成「先查有没有，再插」——
    // 那中间有竞态，两个请求同时注册同一个名字会双双通过检查。
    if (isUniqueViolation(error)) return fail("这个用户名已经被占用了，换一个吧", 409);
    return fail("注册失败，请稍后重试", 503);
  }

  const store = await cookies();
  store.set(SESSION_COOKIE, token, sessionCookieOptions(isHttpsRequest(request)));

  // 注册完直接下发会话，省掉一次登录
  return Response.json({ ok: true, name }, { headers: { "Cache-Control": "no-store" } });
}
