import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSessionUser, safeRelativeReturnPath } from "../chatgpt-auth";
import LoginForm from "./login-form";

export const metadata: Metadata = { title: "登录 · 拾题" };
export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ return_to?: string }>;
}) {
  // 这里用 getSessionUser() 而不是 readSession()：**必须和 app/page.tsx 用同一个判定**。
  // 只看 cookie 的话，被停用/被删除/被重置密码的用户会陷入死循环 ——
  // 他手里的 cookie 签名有效，登录页就把他送去 `/`，而 `/` 回查库认为他没登录，
  // 又把他送回 `/login`，浏览器直接 ERR_TOO_MANY_REDIRECTS。
  //
  // 仍然不看平台请求头：本地开发开着 TRUST_OAI_HEADERS 时请求头一直有值，
  // 一并认了的话登录页会被自动跳过，等于没法调它。
  let signedIn = false;
  try {
    signedIn = (await getSessionUser()) !== null;
  } catch {
    // 查库失败就当未登录，把登录页渲染出来 —— 至少给人一个能操作的界面，
    // 而不是把他卷进重定向环。
    signedIn = false;
  }
  if (signedIn) redirect("/");

  const params = await searchParams;
  const returnTo = safeRelativeReturnPath(
    typeof params.return_to === "string" ? params.return_to : "/",
  );

  return <LoginForm returnTo={returnTo} />;
}
