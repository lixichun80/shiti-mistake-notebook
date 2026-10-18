import type { Metadata } from "next";
import { requireAdmin } from "../chatgpt-auth";
import AdminConsole from "./admin-console";

export const metadata: Metadata = { title: "管理后台 · 拾题" };
// 这个页面读 cookie 又读库，任何形式的缓存都会让「停用」在管理员自己眼前
// 看起来没生效 —— 刷新还是旧数据，很容易被当成功能坏了。
export const dynamic = "force-dynamic";

export default async function AdminPage() {
  // requireAdmin 里：未登录送回登录页，登录了但不是管理员送回错题本。
  // 接口侧走的是另一套（401 / 403），见 lib/api-guard.ts。
  const user = await requireAdmin("/admin");

  return (
    <AdminConsole currentUserId={user.userId} currentUserName={user.displayName} />
  );
}
