import { env } from "cloudflare:workers";
import { authenticate, authenticateForAi } from "@/lib/api-guard";
import { aiConfigured, analyzeEssay } from "@/lib/ai";
import { isSameOriginRequest } from "@/lib/auth";
import { EssayImageError, readEssayImages } from "@/lib/essay-images";
import { insertEssayReport, listEssayReports } from "@/lib/essay-reports";

export const runtime = "edge";

const noStore = { "Cache-Control": "private, no-store" };

export async function GET() {
  const auth = await authenticate();
  if ("response" in auth) return auth.response;
  if (!env.DB) return Response.json({ error: "存储服务暂不可用" }, { status: 503 });
  try {
    return Response.json({ essays: await listEssayReports(auth.user.userId) }, { headers: noStore });
  } catch (error) {
    console.error("Essay list failed", error);
    return Response.json({ error: "作文记录加载失败" }, { status: 503 });
  }
}

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return Response.json({ error: "请求来源不被允许" }, { status: 403 });
  const auth = await authenticateForAi();
  if ("response" in auth) return auth.response;
  if (!aiConfigured()) return Response.json({ error: "AI 服务尚未配置" }, { status: 503 });
  if (!env.DB) return Response.json({ error: "存储服务暂不可用" }, { status: 503 });

  try {
    const form = await request.formData();
    const prompt = form.get("promptText");
    const original = form.get("confirmedText");
    const grade = form.get("gradeLevel");
    const promptText = typeof prompt === "string" ? prompt.trim() : "";
    const originalText = typeof original === "string" ? original.trim() : "";
    const gradeLevel = typeof grade === "string" ? grade.trim() : "";
    if (!promptText || promptText.length > 2000 || originalText.length < 10 || originalText.length > 10000 ||
      !/[A-Za-z]/.test(originalText) || gradeLevel.length > 30) {
      return Response.json({ error: "请确认题目要求和作文原文，原文应为可辨认的英语内容" }, { status: 400 });
    }
    const images = await readEssayImages(form);
    const report = await analyzeEssay({ confirmedText: originalText, promptText, gradeLevel, images });
    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    await insertEssayReport({ id, userId: auth.user.userId, promptText, originalText, gradeLevel, reportJson: JSON.stringify(report), createdAt });
    return Response.json({ essay: { id, promptText, originalText, gradeLevel, report, createdAt,
      excerpt: originalText.replace(/\s+/g, " ").slice(0, 100) } }, { status: 201, headers: noStore });
  } catch (error) {
    if (error instanceof EssayImageError) return Response.json({ error: error.message }, { status: 400 });
    console.error("Essay analysis failed", error);
    return Response.json({ error: error instanceof Error ? error.message : "作文分析失败，请重试" }, { status: 500 });
  }
}
