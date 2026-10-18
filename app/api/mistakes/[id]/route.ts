import { env } from "cloudflare:workers";
import { authenticate } from "@/lib/api-guard";

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticate();
  if ("response" in auth) return auth.response;
  const user = auth.user;
  if (!env.DB) return Response.json({ error: "存储服务暂不可用" }, { status: 503 });
  const { id } = await params;
  const result = await env.DB.prepare("DELETE FROM mistakes WHERE id = ? AND user_id = ?").bind(id, user.userId).run();
  return Response.json({ deleted: result.meta.changes > 0 });
}
