import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSessionUser } from "../chatgpt-auth";
import RegisterForm from "./register-form";

export const metadata: Metadata = { title: "注册 · 拾题" };
export const dynamic = "force-dynamic";

export default async function RegisterPage() {
  // 必须和 app/page.tsx 用同一个判定（getSessionUser 会回查库）。
  // 只看 cookie 的话，被停用/被删除的账号会在 /register ↔ / 之间来回跳，
  // 浏览器直接 ERR_TOO_MANY_REDIRECTS。理由同 app/login/page.tsx。
  let signedIn = false;
  try {
    signedIn = (await getSessionUser()) !== null;
  } catch {
    // 查库失败就当未登录，至少把注册页渲染出来给人操作
    signedIn = false;
  }
  if (signedIn) redirect("/");

  return <RegisterForm />;
}
