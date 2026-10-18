import { cookies } from "next/headers";
import { SESSION_COOKIE, isSameOriginRequest } from "@/lib/auth";

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) {
    return Response.json({ error: "请求来源不被允许" }, { status: 403 });
  }

  // 会话是无状态的，登出就是删掉浏览器上的 cookie。
  // 旧 token 在过期前密码学上依然有效（见 lib/auth.ts 顶部说明），
  // 所以 deploy.sh 验证登出时断言的是「响应清除了 cookie」，而不是「旧 cookie 失效」。
  const store = await cookies();
  store.set(SESSION_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });

  return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
