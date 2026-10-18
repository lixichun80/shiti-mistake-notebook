import { redirect } from "next/navigation";
import { getChatGPTUser, chatGPTSignInPath } from "./chatgpt-auth";
import Dashboard from "./dashboard";

export const dynamic = "force-dynamic";

export default async function Home() {
  const user = await getChatGPTUser();
  // 未登录不再渲染「访客版」首页，直接去登录页 —— 两套 UI 只会各自腐化
  if (!user) redirect(chatGPTSignInPath("/"));

  return <Dashboard name={user.fullName || "同学"} />;
}
