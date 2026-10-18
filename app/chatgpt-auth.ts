import { env } from "cloudflare:workers";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { readSession } from "@/lib/auth";

export type ChatGPTUser = {
  userId: string;
  displayName: string;
  email: string;
  fullName: string | null;
};

const USER_ID_HEADER = "oai-authenticated-user-id";
const USER_EMAIL_HEADER = "oai-authenticated-user-email";
const USER_FULL_NAME_HEADER = "oai-authenticated-user-full-name";
const USER_FULL_NAME_ENCODING_HEADER =
  "oai-authenticated-user-full-name-encoding";
const PERCENT_ENCODED_UTF8 = "percent-encoded-utf-8";
const SIGN_IN_PATH = "/login";
const CALLBACK_PATH = "/callback";

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

export async function getChatGPTUser(): Promise<ChatGPTUser | null> {
  const session = await readSession();
  if (session) {
    return {
      userId: session.userId,
      displayName: session.fullName ?? session.userId,
      // 会话里不存邮箱；目前没有消费者（只有 userId 与 fullName 被用到）
      email: "",
      fullName: session.fullName,
    };
  }

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
  };
}

export async function requireChatGPTUser(
  returnTo: string,
): Promise<ChatGPTUser> {
  const user = await getChatGPTUser();
  if (user) return user;

  redirect(chatGPTSignInPath(returnTo));
}

export function chatGPTSignInPath(returnTo: string): string {
  const safeReturnTo = safeRelativeReturnPath(returnTo);
  return `${SIGN_IN_PATH}?return_to=${encodeURIComponent(safeReturnTo)}`;
}

/**
 * 只放行站内相对路径，挡掉 `//evil.com`、`https://evil.com` 这类开放重定向，
 * 并把登录相关路径归一成 `/`，避免 `?return_to=/login` 形成重定向环。
 * 登录页用它清洗 `return_to` 参数。
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
  return pathname === SIGN_IN_PATH || pathname === CALLBACK_PATH;
}

function safeDecodeURIComponent(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}
