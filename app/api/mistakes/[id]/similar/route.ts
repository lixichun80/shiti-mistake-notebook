import { env } from "cloudflare:workers";
import { authenticate } from "@/lib/api-guard";
import { aiConfigured, createSimilar, type SimilarQuestion } from "@/lib/ai";

type Row = { question: string; knowledge_point: string; subject: string; similar_questions: string };

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticate();
  if ("response" in auth) return auth.response;
  const user = auth.user;
  if (!aiConfigured()) return Response.json({ error: "AI 分析服务尚未配置" }, { status: 503 });
  if (!env.DB) return Response.json({ error: "存储服务暂不可用" }, { status: 503 });
  const body = await request.json().catch(() => null) as { count?: unknown } | null;
  const count = body?.count;
  if (typeof count !== "number" || !Number.isInteger(count) || count < 1 || count > 5) {
    return Response.json({ error: "类似题数量只能是 1 到 5 的整数" }, { status: 400 });
  }
  const { id } = await params;
  const row = await env.DB.prepare("SELECT question, knowledge_point, subject, similar_questions FROM mistakes WHERE id = ? AND user_id = ?").bind(id, user.userId).first<Row>();
  if (!row) return Response.json({ error: "没有找到这道错题" }, { status: 404 });
  try {
    const saved = JSON.parse(row.similar_questions || "[]") as unknown;
    const previous = Array.isArray(saved) ? saved as SimilarQuestion[] : [];
    const questions = await createSimilar(row.question, row.knowledge_point, row.subject, count, previous.map(item => item.question));
    const allQuestions = [...previous, ...questions];
    await env.DB.prepare("UPDATE mistakes SET similar_questions = ? WHERE id = ? AND user_id = ?").bind(JSON.stringify(allQuestions), id, user.userId).run();
    return Response.json({ questions: allQuestions });
  } catch (error) {
    console.error("Similar question generation failed", error);
    return Response.json({ error: error instanceof Error ? error.message : "生成失败，请重试" }, { status: 500 });
  }
}
