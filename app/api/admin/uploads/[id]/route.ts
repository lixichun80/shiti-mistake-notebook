import { authenticateAdmin } from "@/lib/api-guard";
import { deleteAdminUpload } from "@/lib/admin";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authenticateAdmin();
  if ("response" in auth) return auth.response;

  const { id } = await params;
  try {
    const fileKeys = await deleteAdminUpload(id);

    if (fileKeys === null)
      return Response.json({ error: "上传批次不存在" }, { status: 404 });

    return Response.json(
      { ok: true },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("Failed to delete upload batch", error);
    return Response.json(
      { error: "删除上传批次失败，批次记录已保留，请重试" },
      { status: 503 },
    );
  }
}
