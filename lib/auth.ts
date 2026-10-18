import { env } from "cloudflare:workers";
import { cookies } from "next/headers";

/**
 * 拾题 · 智能错题本 —— 登录会话
 *
 * 会话是**无状态**的：cookie 值 = base64url(JSON 载荷) + HMAC-SHA256 签名，
 * 密钥取 env.SESSION_SECRET。没有服务端会话表，所以登出只是删掉浏览器 cookie，
 * 旧 token 在过期前密码学上依然有效（家庭自用可接受，见 AGENTS.md）。
 *
 * 全部用 Web Crypto，不引入任何依赖 —— workerd 原生支持 PBKDF2 与 HMAC-SHA256。
 */

export const SESSION_COOKIE = "shiti_session";

const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 天
const PBKDF2_ITERATIONS = 600_000;
const PBKDF2_BYTES = 32;
const PBKDF2_SALT_BYTES = 16;
const MIN_SECRET_LENGTH = 32;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/**
 * TS 5.7 起 `Uint8Array` 带上了 `ArrayBufferLike` 泛型，可能是 SharedArrayBuffer 背书的，
 * 而 Web Crypto 的 `BufferSource` 只收普通 ArrayBuffer 背书的视图。统一收窄成这个别名。
 */
type Bytes = Uint8Array<ArrayBuffer>;

/* ------------------------------------------------------------------ *
 * base64url —— workerd 的 btoa/atob 只认标准 base64，手工换字符表
 * ------------------------------------------------------------------ */

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  // 分块，避免超长数组把 String.fromCharCode 的参数撑爆
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(value: string): Bytes {
  const padded =
    value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (value.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/* ------------------------------------------------------------------ *
 * 口令
 * ------------------------------------------------------------------ */

const DUMMY_SALT: Bytes = new Uint8Array(PBKDF2_SALT_BYTES);

async function deriveBits(
  password: string,
  salt: Bytes,
  iterations: number,
  bits: number,
): Promise<ArrayBuffer> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, [
    "deriveBits",
  ]);
  return crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, bits);
}

/** 存成 `pbkdf2$<迭代数>$<saltB64url>$<hashB64url>`；迭代数写进格式，方便日后调高。 */
export async function hashPassword(plain: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(PBKDF2_SALT_BYTES));
  const derived = new Uint8Array(
    await deriveBits(plain, salt, PBKDF2_ITERATIONS, PBKDF2_BYTES * 8),
  );
  return `pbkdf2$${PBKDF2_ITERATIONS}$${toBase64Url(salt)}$${toBase64Url(derived)}`;
}

export async function verifyPassword(plain: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 4 || parts[0] !== "pbkdf2") return false;

  const iterations = Number.parseInt(parts[1], 10);
  if (!Number.isInteger(iterations) || iterations < 1000 || iterations > 5_000_000) return false;

  let salt: Bytes;
  let expected: Bytes;
  try {
    salt = fromBase64Url(parts[2]);
    expected = fromBase64Url(parts[3]);
  } catch {
    return false;
  }

  const actual = new Uint8Array(await deriveBits(plain, salt, iterations, expected.length * 8));
  // 常数时间比较：别用 === 或提前 return，那会按字节泄露信息
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= actual[i] ^ expected[i];
  return diff === 0;
}

/**
 * 用户名不存在时也要跑一次同代价的哈希 —— 否则「查无此人」会立刻返回，
 * 响应时间就把账号是否存在告诉了攻击者。
 */
export async function burnPasswordTime(plain: string): Promise<void> {
  await deriveBits(plain, DUMMY_SALT, PBKDF2_ITERATIONS, PBKDF2_BYTES * 8);
}

/* ------------------------------------------------------------------ *
 * 会话
 * ------------------------------------------------------------------ */

export type SessionUser = { userId: string; fullName: string | null };

type SessionPayload = { v: 1; uid: string; name: string; exp: number };

async function hmacKey(): Promise<CryptoKey> {
  const secret = env.SESSION_SECRET;
  if (!secret || secret.length < MIN_SECRET_LENGTH) {
    throw new Error(
      `SESSION_SECRET 未配置或短于 ${MIN_SECRET_LENGTH} 字符，请在 .dev.vars 里设置后重启应用。`,
    );
  }
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

export async function createSessionToken(user: SessionUser): Promise<string> {
  const payload: SessionPayload = {
    v: 1,
    uid: user.userId,
    name: user.fullName ?? user.userId,
    exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
  };
  // 签名覆盖 base64url 之后的原字符串，而不是重新序列化的对象 ——
  // 否则 JSON 键序或空白差异会让验签莫名失败。
  const body = toBase64Url(encoder.encode(JSON.stringify(payload)));
  const signature = new Uint8Array(
    await crypto.subtle.sign("HMAC", await hmacKey(), encoder.encode(body)),
  );
  return `${body}.${toBase64Url(signature)}`;
}

export async function readSessionToken(
  token: string | null | undefined,
): Promise<SessionPayload | null> {
  if (!token) return null;

  const dot = token.indexOf(".");
  if (dot <= 0) return null;

  const body = token.slice(0, dot);
  let signature: Bytes;
  try {
    signature = fromBase64Url(token.slice(dot + 1));
  } catch {
    return null;
  }

  // crypto.subtle.verify 内部是常数时间比较，不要自己写比对
  let valid = false;
  try {
    valid = await crypto.subtle.verify("HMAC", await hmacKey(), signature, encoder.encode(body));
  } catch {
    return null;
  }
  if (!valid) return null;

  let payload: SessionPayload;
  try {
    payload = JSON.parse(decoder.decode(fromBase64Url(body))) as SessionPayload;
  } catch {
    return null;
  }

  if (!payload || payload.v !== 1) return null;
  if (typeof payload.uid !== "string" || typeof payload.exp !== "number") return null;
  if (payload.exp * 1000 <= Date.now()) return null;

  return payload;
}

/** 从当前请求的 cookie 解析会话；没有或无效都返回 null。 */
export async function readSession(): Promise<SessionUser | null> {
  let token: string | undefined;
  try {
    token = (await cookies()).get(SESSION_COOKIE)?.value;
  } catch {
    // 拿不到请求上下文（例如静态渲染）时按未登录处理
    return null;
  }

  const payload = await readSessionToken(token);
  if (!payload) return null;
  return { userId: payload.uid, fullName: payload.name };
}

/**
 * 应用跑在 nginx 后面，worker 看到的 request.url 永远是 http://127.0.0.1:3105/…，
 * 所以判断协议必须看 x-forwarded-proto。若对 http 的 IP 直连入口写死 Secure=true，
 * 浏览器会**静默丢弃**这个 cookie —— 表现为「登录成功又跳回登录页」。
 */
export function isHttpsRequest(request: Request): boolean {
  const forwarded = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  if (forwarded) return forwarded === "https";
  try {
    return new URL(request.url).protocol === "https:";
  } catch {
    return false;
  }
}

export function sessionCookieOptions(secure: boolean) {
  return {
    httpOnly: true,
    secure,
    sameSite: "lax" as const,
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  };
}

/**
 * 防登录 CSRF：跨站请求直接拒。
 * 注意不能用 new URL(request.url).origin 比对 —— nginx 后面 worker 看到的
 * request.url 是内网地址，origin 永远是 http://127.0.0.1:3105。要用 Host 头。
 */
export function isSameOriginRequest(request: Request): boolean {
  if (request.headers.get("sec-fetch-site") === "cross-site") return false;

  const origin = request.headers.get("origin");
  if (!origin) return true; // 非浏览器客户端（curl、部署脚本）不带 Origin

  try {
    return new URL(origin).host === request.headers.get("host");
  } catch {
    return false;
  }
}
