import { env } from "cloudflare:workers";
import { authenticateForAi } from "@/lib/api-guard";
import { aiConfigured, createKnowledgeGuide } from "@/lib/ai";
import { isSameOriginRequest } from "@/lib/auth";
import { normalizeKnowledgePoint, type KnowledgeGuide } from "@/lib/knowledge-types";

type Example = { question: string; incorrect_answer: string; correct_answer: string };

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return Response.json({ error: "请求来源不被允许" }, { status: 403 });
  const auth = await authenticateForAi();
  if ("response" in auth) return auth.response;
  if (!env.DB) return Response.json({ error: "存储服务暂不可用" }, { status: 503 });
  if (!aiConfigured()) return Response.json({ error: "AI 服务尚未配置" }, { status: 503 });

  const body = await request.json().catch(() => null) as { subject?: unknown; knowledgePoint?: unknown } | null;
  const subject = typeof body?.subject === "string" ? body.subject.trim() : "";
  const point = typeof body?.knowledgePoint === "string" ? normalizeKnowledgePoint(body.knowledgePoint) : "";
  if (!subject || subject.length > 30 || !point || point.length > 100) {
    return Response.json({ error: "请选择有效的知识点" }, { status: 400 });
  }

  try {
    const profile = await env.DB.prepare("SELECT unit_name, guide FROM knowledge_units WHERE user_id = ? AND subject = ? AND knowledge_point = ?")
      .bind(auth.user.userId, subject, point).first<{ unit_name: string; guide: string }>();
    if (profile?.guide) {
      try { return Response.json({ guide: JSON.parse(profile.guide) as KnowledgeGuide, cached: true }, { headers: { "Cache-Control": "private, no-store" } }); }
      catch { /* Regenerate a damaged cache entry. */ }
    }
    const { results } = await env.DB.prepare("SELECT question, incorrect_answer, correct_answer FROM mistakes WHERE user_id = ? AND subject = ? AND TRIM(knowledge_point) = ? ORDER BY created_at DESC LIMIT 2")
      .bind(auth.user.userId, subject, point).all<Example>();
    const guide = await createKnowledgeGuide({
      subject, knowledgePoint: point, unitName: profile?.unit_name || "",
      examples: results.map(row => ({ question: row.question, incorrectAnswer: row.incorrect_answer, correctAnswer: row.correct_answer })),
    });
    await env.DB.prepare("INSERT INTO knowledge_units (user_id, subject, knowledge_point, unit_name, guide, updated_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(user_id, subject, knowledge_point) DO UPDATE SET guide = CASE WHEN unit_name = excluded.unit_name THEN excluded.guide ELSE guide END, updated_at = excluded.updated_at")
      .bind(auth.user.userId, subject, point, profile?.unit_name || "", JSON.stringify(guide), new Date().toISOString()).run();
    return Response.json({ guide, cached: false }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    console.error("Knowledge guide failed", error);
    return Response.json({ error: error instanceof Error ? error.message : "概念提示生成失败" }, { status: 500 });
  }
}
