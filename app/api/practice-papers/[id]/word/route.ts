import { authenticate } from "@/lib/api-guard";
import { makeUnitPaperDocx, unitPaperDocxFilename } from "@/lib/mistake-docx";
import { getPracticePaper, parsePaper } from "@/lib/practice-papers";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticate();
  if ("response" in auth) return auth.response.status === 401
    ? Response.redirect(new URL("/login", request.url), 302)
    : auth.response;
  try {
    const row = await getPracticePaper((await params).id, auth.user.userId);
    if (!row) return Response.json({ error: "练习卷不存在" }, { status: 404 });
    const paper = { subject: row.subject, unitName: row.unit_name, gradeLevel: row.grade_level, questions: parsePaper(row).questions };
    const bytes = makeUnitPaperDocx(paper);
    const name = unitPaperDocxFilename(paper);
    return new Response(bytes.buffer, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": `attachment; filename="unit-practice.docx"; filename*=UTF-8''${encodeURIComponent(name)}`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    console.error("Practice Word export failed", error);
    return Response.json({ error: "Word 文档生成失败" }, { status: 500 });
  }
}
