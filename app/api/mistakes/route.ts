import { env } from "cloudflare:workers";
import { getChatGPTUser } from "@/app/chatgpt-auth";

type Row = {
  id: string; upload_id: string; subject: string; question: string;
  incorrect_answer: string; correct_answer: string; reasoning: string;
  knowledge_point: string; page_number: number; source_name: string;
  similar_questions: string; created_at: string;
};

export async function GET() {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "请先登录" }, { status: 401 });
  if (!env.DB) return Response.json({ error: "存储服务暂不可用" }, { status: 503 });
  const { results } = await env.DB.prepare("SELECT id, upload_id, subject, question, incorrect_answer, correct_answer, reasoning, knowledge_point, page_number, source_name, similar_questions, created_at FROM mistakes WHERE user_id = ? ORDER BY created_at DESC").bind(user.userId).all<Row>();
  const mistakes = results.map(row => ({
    id: row.id, uploadId: row.upload_id, subject: row.subject, question: row.question,
    incorrectAnswer: row.incorrect_answer, correctAnswer: row.correct_answer,
    reasoning: row.reasoning, knowledgePoint: row.knowledge_point,
    pageNumber: row.page_number, sourceName: row.source_name,
    similarQuestions: JSON.parse(row.similar_questions || "[]"), createdAt: row.created_at,
  }));
  return Response.json({ mistakes });
}
