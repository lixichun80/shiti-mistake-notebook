import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { readSession } from "@/lib/auth";
import { safeRelativeReturnPath } from "../chatgpt-auth";
import LoginForm from "./login-form";

export const metadata: Metadata = { title: "登录 · 拾题" };
export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ return_to?: string }>;
}) {
  // 这里只看会话 cookie，不看平台请求头 —— 本地开发开着 TRUST_OAI_HEADERS
  // 时请求头一直有值，若一并认了，登录页会被自动跳过，等于没法调它。
  if (await readSession()) redirect("/");

  const params = await searchParams;
  const returnTo = safeRelativeReturnPath(
    typeof params.return_to === "string" ? params.return_to : "/",
  );

  return <LoginForm returnTo={returnTo} />;
}
