import { getChatGPTUser, type ChatGPTUser } from "@/app/chatgpt-auth";

/**
 * 拾题 · 智能错题本 —— 接口侧的认证入口
 *
 * 用法：
 *   const auth = await authenticate();
 *   if ("response" in auth) return auth.response;
 *   const user = auth.user;
 *
 * 存在的理由是把三种情况分清楚，而不是各路由自己 `if (!user) return 401`：
 *
 *   - **查库失败 → 503**。绝不能折叠成「未登录」。数据库故障表现成
 *     「所有人都掉线」，前端会以为是会话过期，把人送去登录页，然后
 *     在登录页又登不进去 —— 排查方向直接跑偏。而且 `/` 和 `/login` 都会
 *     认为对方该负责，能把人送进重定向环。
 *   - **未登录 → 401**。
 *   - **登录了但没权限 → 403**，跟 401 分开。混在一起的话，越权排查时
 *     分不清是「cookie 丢了」还是「权限不够」。
 */

function fail(error: string, status: number): Response {
  return Response.json({ error }, { status, headers: { "Cache-Control": "no-store" } });
}

export type AuthResult = { user: ChatGPTUser } | { response: Response };

export async function authenticate(): Promise<AuthResult> {
  let user: ChatGPTUser | null;
  try {
    user = await getChatGPTUser();
  } catch {
    return { response: fail("存储服务暂不可用", 503) };
  }

  if (!user) return { response: fail("请先登录", 401) };
  return { user };
}

export async function authenticateAdmin(): Promise<AuthResult> {
  const result = await authenticate();
  if ("response" in result) return result;
  if (result.user.role !== "admin") return { response: fail("需要管理员权限", 403) };

  return result;
}
