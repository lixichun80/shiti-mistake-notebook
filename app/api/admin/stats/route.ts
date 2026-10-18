import { authenticateAdmin } from "@/lib/api-guard";
import { getAdminOverviewStats } from "@/lib/admin";

export async function GET() {
  const auth = await authenticateAdmin();
  if ("response" in auth) return auth.response;

  try {
    const stats = await getAdminOverviewStats();
    return Response.json(stats, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Failed to load admin stats", error);
    return Response.json({ error: "获取统计概览失败" }, { status: 503 });
  }
}
