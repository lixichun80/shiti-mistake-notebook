import { env } from "cloudflare:workers";
import { authenticate } from "@/lib/api-guard";
import { isSameOriginRequest } from "@/lib/auth";
import { normalizeKnowledgePoint, type KnowledgeGuide, type KnowledgeProfile } from "@/lib/knowledge-types";

type Row = {
  subject: string;
  knowledge_point: string;
  unit_name: string;
  guide: string;
};

function profile(row: Row): KnowledgeProfile {
  let guide: KnowledgeGuide | null = null;
  try { guide = row.guide ? JSON.parse(row.guide) as KnowledgeGuide : null; } catch { /* Ignore a damaged cached guide. */ }
  return { subject: row.subject, knowledgePoint: row.knowledge_point, unitName: row.unit_name, guide };
}

export async function GET() {
  const auth = await authenticate();
  if ("response" in auth) return auth.response;
  if (!env.DB) return Response.json({ error: "存储服务暂不可用" }, { status: 503 });
  try {
    const { results } = await env.DB.prepare("SELECT subject, knowledge_point, unit_name, guide FROM knowledge_units WHERE user_id = ?")
      .bind(auth.user.userId).all<Row>();
    return Response.json({ profiles: results.map(profile) }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    console.error("Knowledge profiles load failed", error);
    return Response.json({ error: "知识点归属加载失败" }, { status: 503 });
  }
}

export async function PUT(request: Request) {
  if (!isSameOriginRequest(request)) return Response.json({ error: "请求来源不被允许" }, { status: 403 });
  const auth = await authenticate();
  if ("response" in auth) return auth.response;
  if (!env.DB) return Response.json({ error: "存储服务暂不可用" }, { status: 503 });
  const body = await request.json().catch(() => null) as { subject?: unknown; knowledgePoint?: unknown; unitName?: unknown } | null;
  const subject = typeof body?.subject === "string" ? body.subject.trim() : "";
  const point = typeof body?.knowledgePoint === "string" ? normalizeKnowledgePoint(body.knowledgePoint) : "";
  const unit = typeof body?.unitName === "string" ? body.unitName.trim() : "";
  if (!subject || subject.length > 30 || !point || point.length > 100 || unit.length > 80) {
    return Response.json({ error: "知识点或单元名称不符合要求" }, { status: 400 });
  }
  try {
    const updatedAt = new Date().toISOString();
    await env.DB.prepare("INSERT INTO knowledge_units (user_id, subject, knowledge_point, unit_name, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(user_id, subject, knowledge_point) DO UPDATE SET unit_name = excluded.unit_name, guide = CASE WHEN unit_name = excluded.unit_name THEN guide ELSE '' END, updated_at = excluded.updated_at")
      .bind(auth.user.userId, subject, point, unit, updatedAt).run();
    const row = await env.DB.prepare("SELECT subject, knowledge_point, unit_name, guide FROM knowledge_units WHERE user_id = ? AND subject = ? AND knowledge_point = ?")
      .bind(auth.user.userId, subject, point).first<Row>();
    return Response.json({ profile: profile(row!) }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    console.error("Knowledge unit save failed", error);
    return Response.json({ error: "单元归属保存失败" }, { status: 503 });
  }
}
