import { env } from "cloudflare:workers";
import { authenticate } from "@/lib/api-guard";
import { aiConfigured, analyzePages } from "@/lib/ai";

export const runtime = "edge";

const allowedTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
const maxFileBytes = 8 * 1024 * 1024;

function toBase64(bytes: Uint8Array) {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 32768) binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
  return btoa(binary);
}

export async function POST(request: Request) {
  const auth = await authenticate();
  if ("response" in auth) return auth.response;
  const user = auth.user;
  if (!aiConfigured()) return Response.json({ error: "AI 分析服务尚未配置，暂时无法处理图片" }, { status: 503 });
  if (!env.DB || !env.BUCKET) return Response.json({ error: "存储服务暂不可用" }, { status: 503 });

  try {
    const form = await request.formData();
    const files = form.getAll("files").filter((item): item is File => item instanceof File);
    if (!files.length || files.length > 4) return Response.json({ error: "请选择 1 至 4 张图片" }, { status: 400 });
    if (files.some(file => !allowedTypes.has(file.type) || file.size > maxFileBytes || file.size === 0)) {
      return Response.json({ error: "仅支持 JPG、PNG、WEBP，单张不超过 8MB" }, { status: 400 });
    }

    const images = await Promise.all(files.map(async file => {
      const bytes = new Uint8Array(await file.arrayBuffer());
      return { bytes, mime: file.type, base64: toBase64(bytes) };
    }));
    const analysis = await analyzePages(images);
    const uploadId = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    const keys = files.map((_, i) => `${user.userId}/${uploadId}/${i}`);
    const written: string[] = [];
    try {
      for (let i = 0; i < files.length; i++) {
        await env.BUCKET.put(keys[i], images[i].bytes, { httpMetadata: { contentType: files[i].type } });
        written.push(keys[i]);
      }
      const statements = [env.DB.prepare("INSERT INTO uploads (id, user_id, subject, file_keys, file_names, created_at) VALUES (?, ?, ?, ?, ?, ?)")
        .bind(uploadId, user.userId, analysis.subject.trim() || "其他", JSON.stringify(keys), JSON.stringify(files.map(file => file.name)), createdAt)];
      const saved = analysis.mistakes.map(item => {
        const id = crypto.randomUUID();
        statements.push(env.DB!.prepare("INSERT INTO mistakes (id, upload_id, user_id, subject, question, incorrect_answer, correct_answer, reasoning, knowledge_point, page_number, source_name, similar_questions, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
          .bind(id, uploadId, user.userId, analysis.subject.trim() || "其他", item.question.trim(), item.incorrectAnswer.trim(), item.correctAnswer.trim(), item.reasoning.trim(), item.knowledgePoint.trim(), Math.max(1, Math.min(files.length, item.pageNumber || 1)), files[Math.max(0, Math.min(files.length - 1, (item.pageNumber || 1) - 1))].name, "[]", createdAt));
        return { id, ...item, subject: analysis.subject.trim() || "其他", sourceName: files[Math.max(0, Math.min(files.length - 1, (item.pageNumber || 1) - 1))].name, createdAt, similarQuestions: [] };
      });
      await env.DB.batch(statements);
      return Response.json({ uploadId, subject: analysis.subject, summary: analysis.summary, uncertainNote: analysis.uncertainNote, mistakes: saved });
    } catch (error) {
      await Promise.allSettled(written.map(key => env.BUCKET!.delete(key)));
      throw error;
    }
  } catch (error) {
    console.error("Analysis failed", error);
    const message = error instanceof Error ? error.message : "分析失败，请稍后重试";
    return Response.json({ error: message }, { status: 500 });
  }
}
