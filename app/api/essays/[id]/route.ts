import { env } from "cloudflare:workers";
import { authenticate } from "@/lib/api-guard";
import { getEssayReport } from "@/lib/essay-reports";

export const runtime = "edge";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticate();
  if ("response" in auth) return auth.response;
  if (!env.DB) return Response.json({ error: "存储服务暂不可用" }, { status: 503 });
  const { id } = await params;
  if (!id || id.length > 100) return Response.json({ error: "作文记录不存在" }, { status: 404 });
  try {
    const essay = await getEssayReport(id, auth.user.userId);
    return essay ? Response.json({ essay }, { headers: { "Cache-Control": "private, no-store" } })
      : Response.json({ error: "作文记录不存在" }, { status: 404 });
  } catch (error) {
    console.error("Essay detail failed", error);
    return Response.json({ error: "作文记录加载失败" }, { status: 503 });
  }
}
