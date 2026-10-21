import { env } from "cloudflare:workers";
import { authenticate } from "@/lib/api-guard";
import { makeMistakeDocx, mistakeDocxFilename } from "@/lib/mistake-docx";

type MistakeRow = {
  subject: string;
  question: string;
  incorrect_answer: string;
  correct_answer: string;
  reasoning: string;
  knowledge_point: string;
  page_number: number;
  source_name: string;
  created_at: string;
  similar_questions: string;
};

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticate();
  if ("response" in auth) return auth.response.status === 401
    ? Response.redirect(new URL("/login", request.url), 302)
    : auth.response;
  if (!env.DB) return Response.json({ error: "存储服务暂不可用" }, { status: 503 });

  try {
    const row = await env.DB.prepare(
      "SELECT subject, question, incorrect_answer, correct_answer, reasoning, knowledge_point, page_number, source_name, created_at, similar_questions FROM mistakes WHERE id = ? AND user_id = ?",
    ).bind((await params).id, auth.user.userId).first<MistakeRow>();
    if (!row) return Response.json({ error: "错题不存在" }, { status: 404 });

    const item = {
      subject: row.subject,
      question: row.question,
      incorrectAnswer: row.incorrect_answer,
      correctAnswer: row.correct_answer,
      reasoning: row.reasoning,
      knowledgePoint: row.knowledge_point,
      pageNumber: row.page_number,
      sourceName: row.source_name,
      createdAt: row.created_at,
      similarQuestions: JSON.parse(row.similar_questions || "[]") as { question: string; answer: string; explanation: string }[],
    };
    const bytes = makeMistakeDocx(item);
    const name = mistakeDocxFilename(item);
    return new Response(bytes.buffer, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": `attachment; filename="mistake.docx"; filename*=UTF-8''${encodeURIComponent(name)}`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    console.error("Mistake Word export failed", error);
    return Response.json({ error: "Word 文档生成失败" }, { status: 500 });
  }
}
