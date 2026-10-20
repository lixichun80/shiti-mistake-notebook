import { authenticateForAi } from "@/lib/api-guard";
import { aiConfigured, gradeUnitPaper } from "@/lib/ai";
import { getPracticePaper, paperDetail, parsePaper, savePracticeGrade } from "@/lib/practice-papers";
import type { PracticeGrade } from "@/lib/practice-types";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticateForAi();
  if ("response" in auth) return auth.response;
  if (!aiConfigured()) return Response.json({ error: "AI 服务尚未配置" }, { status: 503 });
  const body = await request.json().catch(() => null) as { answers?: unknown } | null;
  if (!Array.isArray(body?.answers) || body.answers.some(answer => typeof answer !== "string" || answer.length > 2000)) {
    return Response.json({ error: "作答格式不正确，单题最多 2000 字" }, { status: 400 });
  }
  try {
    const id = (await params).id;
    const row = await getPracticePaper(id, auth.user.userId);
    if (!row) return Response.json({ error: "练习卷不存在" }, { status: 404 });
    const { questions } = parsePaper(row);
    if (body.answers.length !== questions.length || !body.answers.some(answer => answer.trim())) {
      return Response.json({ error: "请至少完成一题再提交批改" }, { status: 400 });
    }
    const answers = body.answers.map(answer => answer.trim()) as string[];
    const result = await gradeUnitPaper(questions, answers);
    const grading: PracticeGrade[] = result.map((item, index) => ({
      ...item, answer: questions[index].answer, explanation: questions[index].explanation,
      knowledgePoint: questions[index].knowledgePoint,
    }));
    const gradedAt = new Date().toISOString();
    await savePracticeGrade(id, auth.user.userId, answers, grading, gradedAt);
    return Response.json({ paper: paperDetail({ ...row, answers: JSON.stringify(answers), grading: JSON.stringify(grading), graded_at: gradedAt }) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Practice grading failed", error);
    return Response.json({ error: error instanceof Error ? error.message : "批改失败，请重试" }, { status: 500 });
  }
}
