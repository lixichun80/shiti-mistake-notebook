import { env } from "cloudflare:workers";
import { authenticate, authenticateForAi } from "@/lib/api-guard";
import { aiConfigured, createUnitPaper } from "@/lib/ai";
import { insertPracticePaper, listPracticePapers, paperDetail, paperSummary } from "@/lib/practice-papers";

export const runtime = "edge";

const noStore = { "Cache-Control": "no-store" };
const fail = (error: string, status: number) => Response.json({ error }, { status, headers: noStore });

export async function GET() {
  const auth = await authenticate();
  if ("response" in auth) return auth.response;
  try {
    const rows = await listPracticePapers(auth.user.userId);
    return Response.json({ papers: rows.map(paperSummary) }, { headers: noStore });
  } catch (error) {
    console.error("Practice list failed", error);
    return fail("练习卷加载失败", 503);
  }
}

export async function POST(request: Request) {
  const auth = await authenticateForAi();
  if ("response" in auth) return auth.response;
  if (!aiConfigured()) return fail("AI 服务尚未配置", 503);
  if (!env.DB) return fail("存储服务暂不可用", 503);

  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const subject = typeof body?.subject === "string" ? body.subject.trim() : "";
  const unitName = typeof body?.unitName === "string" ? body.unitName.trim() : "";
  const gradeLevel = typeof body?.gradeLevel === "string" ? body.gradeLevel.trim() : "";
  const count = body?.count;
  if (!subject || subject.length > 30 || !unitName || unitName.length > 80 || gradeLevel.length > 30 || (count !== 5 && count !== 10)) {
    return fail("请填写科目与单元名称，并选择 5 或 10 道题", 400);
  }

  try {
    const { results } = await env.DB.prepare("SELECT knowledge_point, question FROM mistakes WHERE user_id = ? AND subject = ? ORDER BY created_at DESC LIMIT 100")
      .bind(auth.user.userId, subject).all<{ knowledge_point: string; question: string }>();
    const weak = new Map<string, { name: string; count: number; example: string }>();
    for (const row of results) {
      const name = row.knowledge_point.trim();
      if (!name) continue;
      const prior = weak.get(name);
      if (prior) prior.count++;
      else weak.set(name, { name: name.slice(0, 80), count: 1, example: row.question.slice(0, 160) });
    }
    const questions = await createUnitPaper({
      subject, unitName, gradeLevel, count,
      weakPoints: [...weak.values()].sort((a, b) => b.count - a.count).slice(0, 12),
    });
    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    const row = {
      id, user_id: auth.user.userId, subject, unit_name: unitName, grade_level: gradeLevel,
      questions: JSON.stringify(questions), answers: "[]", grading: "[]", created_at: createdAt, graded_at: null,
    };
    await insertPracticePaper({ id, userId: auth.user.userId, subject, unitName, gradeLevel, questions, createdAt });
    return Response.json({ paper: paperDetail(row) }, { status: 201, headers: noStore });
  } catch (error) {
    console.error("Practice generation failed", error);
    return fail(error instanceof Error ? error.message : "生成练习卷失败，请重试", 500);
  }
}
