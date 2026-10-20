import { authenticate } from "@/lib/api-guard";
import { getPracticePaper, paperDetail } from "@/lib/practice-papers";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticate();
  if ("response" in auth) return auth.response;
  try {
    const row = await getPracticePaper((await params).id, auth.user.userId);
    if (!row) return Response.json({ error: "练习卷不存在" }, { status: 404 });
    return Response.json({ paper: paperDetail(row) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Practice detail failed", error);
    return Response.json({ error: "练习卷加载失败" }, { status: 503 });
  }
}
