import type { Metadata } from "next";
import { getChatGPTUser } from "./chatgpt-auth";
import Dashboard from "./dashboard";
import Landing from "./landing";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "拾题 · 智能错题本 | 新用户免费体验 7 天" };

export default async function Home() {
  let user = null;
  try {
    user = await getChatGPTUser();
  } catch {
    // 存储暂不可用时仍让访客看到介绍页；所有受保护接口会独立拒绝请求。
  }
  if (!user) return <Landing />;

  return <Dashboard name={user.fullName || "同学"} trialEndsAt={user.trialEndsAt} role={user.role} />;
}
