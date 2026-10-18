import { env } from "cloudflare:workers";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { readSession } from "@/lib/auth";
import { findUserById, type UserRole } from "@/lib/users";

export type ChatGPTUser = {
  userId: string;
  displayName: string;
  email: string;
  fullName: string | null;
  /** 来自库里那一行，不是 cookie —— cookie 只证明「是你」，不证明「你现在还是管理员」。 */
  role: UserRole;
};

const USER_ID_HEADER = "oai-authenticated-user-id";
const USER_EMAIL_HEADER = "oai-authenticated-user-email";
const USER_FULL_NAME_HEADER = "oai-authenticated-user-full-name";
const USER_FULL_NAME_ENCODING_HEADER =
  "oai-authenticated-user-full-name-encoding";
const PERCENT_ENCODED_UTF8 = "percent-encoded-utf-8";
const SIGN_IN_PATH = "/login";
const CALLBACK_PATH = "/callback";
const REGISTER_PATH = "/register";

/**
 * 自托管之后，登录态来自会话 cookie（见 `lib/auth.ts`）。
 *
 * ⚠️ 平台请求头这条路径**只给本地开发用**。请求头是客户端可控的：
 * 一旦在生产环境信任它，任何人手工加一个 `oai-authenticated-user-id`
 * 就能绕过登录页直接进后台。nginx 那边虽然会把这些头置空，但不能只靠
 * 它兜底 —— 配置里改错一处（比如某个 location 块多写了一条
 * proxy_set_header，会连带让清头全部失效）就全线失守。所以闸门放在这里。
 */
function trustPlatformHeaders(): boolean {
  return env.TRUST_OAI_HEADERS === "1";
}

/**
 * 「这个请求背后的用户，现在还有效吗」—— 会话的唯一判定入口。
 *
 * cookie 只证明「这张票是我们签的」，证明不了「这个账号现在该放行」：管理员可能
 * 刚停用了他、刚删了他，或者刚重置过密码。所以每次都得拿 uid 回查一次库。
 *
 * **页面和接口都必须走这里。** 只按 cookie 判断（`readSession()`）会造出重定向环：
 * `/login` 看 cookie 有效就跳 `/`，`/` 回查库发现账号已停用又跳回 `/login`，
 * 被停用的用户会卡在 `ERR_TOO_MANY_REDIRECTS`，而部署断言一条都不会变红。
 *
 * 查库失败会**抛异常**，不返回 null。调用方必须把「没这行」和「查询出错」分开：
 * 折叠成 null 会让数据库故障表现成「所有人都掉线」，然后被自洽地送进那个重定向环。
 */
export async function getSessionUser(): Promise<ChatGPTUser | null> {
  const session = await readSession();
  if (!session) return null;

  const record = await findUserById(session.userId);
  if (!record) return null; // 账号已被删除
  if (record.status !== "active") return null; // 账号已被停用
  if (record.sessionEpoch !== session.epoch) return null; // 密码被重置过，这张 cookie 作废

  return {
    userId: record.id,
    displayName: record.displayName,
    email: "",
    fullName: record.displayName,
    role: record.role,
  };
}

export async function getChatGPTUser(): Promise<ChatGPTUser | null> {
  const user = await getSessionUser();
  if (user) return user;

  // 顺序很重要：先看有没有会话 cookie，再看 mock 分支。
  // mock 分支**故意不查库** —— 它造出来的身份（比如 local_seedy）在 users 表里
  // 根本没有对应行，一查就会被判成未登录，本地开发直接废掉。
  if (!trustPlatformHeaders()) return null;

  const requestHeaders = await headers();
  const userId = requestHeaders.get(USER_ID_HEADER);
  const email = requestHeaders.get(USER_EMAIL_HEADER);
  if (!userId || !email) return null;

  const encodedFullName = requestHeaders.get(USER_FULL_NAME_HEADER);
  const fullName =
    encodedFullName &&
    requestHeaders.get(USER_FULL_NAME_ENCODING_HEADER) === PERCENT_ENCODED_UTF8
      ? safeDecodeURIComponent(encodedFullName)
      : null;

  return {
    userId,
    displayName: fullName ?? email,
    email,
    fullName,
    role: "user",
  };
}

export async function requireChatGPTUser(
  returnTo: string,
): Promise<ChatGPTUser> {
  const user = await getChatGPTUser();
  if (user) return user;

  redirect(chatGPTSignInPath(returnTo));
}

/**
 * 管理员页面用。未登录送回登录页，登录了但不是管理员送回错题本 ——
 * 这里给的是「退路」而不是 401：页面场景下甩一个错误页没有意义。
 * 接口侧要区分 401/403，用 `lib/api-guard.ts` 的 `authenticateAdmin()`。
 */
export async function requireAdmin(returnTo: string): Promise<ChatGPTUser> {
  const user = await getChatGPTUser();
  if (!user) redirect(chatGPTSignInPath(returnTo));
  if (user.role !== "admin") redirect("/");

  return user;
}

export function chatGPTSignInPath(returnTo: string): string {
  const safeReturnTo = safeRelativeReturnPath(returnTo);
  return `${SIGN_IN_PATH}?return_to=${encodeURIComponent(safeReturnTo)}`;
}

/**
 * 只放行站内相对路径，挡掉 `//evil.com`、`https://evil.com` 这类开放重定向，
 * 并把登录/注册路径归一成 `/`，避免 `?return_to=/login` 形成重定向环。
 * 登录页和注册页都用它清洗 `return_to`。
 */
export function safeRelativeReturnPath(value: string): string {
  if (!value.startsWith("/") || value.startsWith("//")) return "/";

  let url: URL;
  try {
    url = new URL(value, "https://app.local");
  } catch {
    return "/";
  }
  if (url.origin !== "https://app.local") return "/";
  if (isReservedAuthPath(url.pathname)) return "/";

  return `${url.pathname}${url.search}${url.hash}`;
}

function isReservedAuthPath(pathname: string): boolean {
  return (
    pathname === SIGN_IN_PATH ||
    pathname === CALLBACK_PATH ||
    pathname === REGISTER_PATH
  );
}

function safeDecodeURIComponent(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}
