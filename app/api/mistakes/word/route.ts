import { env } from "cloudflare:workers";
import { authenticate } from "@/lib/api-guard";
import { makeMistakesDocx, mistakesDocxFilename } from "@/lib/mistake-docx";
import { isVisualQuestion, loadWordSourceImage, needsOriginalPicture } from "@/lib/word-source";

type Row = {
  id: string; upload_id: string; subject: string; question: string;
  incorrect_answer: string; correct_answer: string; reasoning: string; knowledge_point: string;
  page_number: number; source_name: string; created_at: string; similar_questions: string;
};

export async function GET(request: Request) {
  const auth = await authenticate();
  if ("response" in auth) return auth.response.status === 401
    ? Response.redirect(new URL("/login", request.url), 302)
    : auth.response;
  if (!env.DB) return Response.json({ error: "存储服务暂不可用" }, { status: 503 });
  const ids = [...new Set(new URL(request.url).searchParams.getAll("id"))];
  if (ids.length < 2 || ids.length > 30 || ids.some(id => !id || id.length > 128)) {
    return Response.json({ error: "请选择 2 至 30 道错题合并下载" }, { status: 400 });
  }
  try {
    const placeholders = ids.map(() => "?").join(",");
    const { results } = await env.DB.prepare(
      `SELECT id, upload_id, subject, question, incorrect_answer, correct_answer, reasoning, knowledge_point, page_number, source_name, created_at, similar_questions FROM mistakes WHERE user_id = ? AND id IN (${placeholders})`,
    ).bind(auth.user.userId, ...ids).all<Row>();
    if (results.length !== ids.length) return Response.json({ error: "部分错题不存在或无权访问" }, { status: 404 });
    const rows = new Map(results.map(row => [row.id, row]));
    const imageCache = new Map<string, ReturnType<typeof loadWordSourceImage>>();
    const sourceFor = (row: Row) => {
      const key = `${row.upload_id}:${row.page_number}`;
      let pending = imageCache.get(key);
      if (!pending) {
        pending = loadWordSourceImage(auth.user.userId, row.upload_id, row.page_number);
        imageCache.set(key, pending);
      }
      return pending;
    };
    const items = await Promise.all(ids.map(async id => {
      const row = rows.get(id)!;
      return {
        subject: row.subject, question: row.question, incorrectAnswer: row.incorrect_answer,
        correctAnswer: row.correct_answer, reasoning: row.reasoning, knowledgePoint: row.knowledge_point,
        pageNumber: row.page_number, sourceName: row.source_name, createdAt: row.created_at,
        similarQuestions: JSON.parse(row.similar_questions || "[]") as { question: string; answer: string; explanation: string }[],
        visualQuestion: isVisualQuestion(row.question),
        ...(needsOriginalPicture(row.subject, row.question) ? { sourceImage: await sourceFor(row) } : {}),
      };
    }));
    const bytes = makeMistakesDocx(items);
    const name = mistakesDocxFilename(items);
    return new Response(bytes.buffer, { headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Content-Disposition": `attachment; filename="mistake-batch.docx"; filename*=UTF-8''${encodeURIComponent(name)}`,
      "Cache-Control": "private, no-store",
    } });
  } catch (error) {
    console.error("Batch Word export failed", error);
    return Response.json({ error: error instanceof Error ? error.message : "Word 文档生成失败" }, { status: 500 });
  }
}
