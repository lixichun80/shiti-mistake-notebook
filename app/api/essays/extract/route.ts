import { authenticateForAi } from "@/lib/api-guard";
import { aiConfigured, extractEssay } from "@/lib/ai";
import { isSameOriginRequest } from "@/lib/auth";
import { EssayImageError, readEssayImages } from "@/lib/essay-images";

export const runtime = "edge";

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return Response.json({ error: "请求来源不被允许" }, { status: 403 });
  const auth = await authenticateForAi();
  if ("response" in auth) return auth.response;
  if (!aiConfigured()) return Response.json({ error: "AI 服务尚未配置" }, { status: 503 });

  try {
    const form = await request.formData();
    const promptHint = form.get("promptHint");
    if (typeof promptHint !== "string" || promptHint.length > 2000) {
      return Response.json({ error: "题目要求最多 2000 字" }, { status: 400 });
    }
    const images = await readEssayImages(form);
    const extraction = await extractEssay(images, promptHint.trim());
    if (extraction.essayText.length < 10) {
      return Response.json({ error: extraction.uncertainNote || "未能读清作文正文，请上传更清晰的照片" }, { status: 422 });
    }
    return Response.json({ extraction }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof EssayImageError) return Response.json({ error: error.message }, { status: 400 });
    console.error("Essay extraction failed", error);
    return Response.json({ error: error instanceof Error ? error.message : "作文识别失败，请重试" }, { status: 500 });
  }
}
