import { env } from "cloudflare:workers";
import { getChatGPTUser } from "@/app/chatgpt-auth";

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "请先登录" }, { status: 401 });
  if (!env.DB) return Response.json({ error: "存储服务暂不可用" }, { status: 503 });
  const { id } = await params;
  const result = await env.DB.prepare("DELETE FROM mistakes WHERE id = ? AND user_id = ?").bind(id, user.userId).run();
  return Response.json({ deleted: result.meta.changes > 0 });
}
