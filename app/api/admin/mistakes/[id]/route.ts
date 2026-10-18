import { authenticateAdmin } from "@/lib/api-guard";
import {
  AdminInputError,
  deleteAdminMistake,
  updateAdminMistake,
} from "@/lib/admin";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authenticateAdmin();
  if ("response" in auth) return auth.response;

  const { id } = await params;
  try {
    const body = (await request.json()) as {
      subject?: string;
      question?: string;
      incorrectAnswer?: string;
      correctAnswer?: string;
      reasoning?: string;
      knowledgePoint?: string;
    };
    const updated = await updateAdminMistake(id, body);
    if (!updated)
      return Response.json({ error: "错题不存在" }, { status: 404 });
    return Response.json(
      { ok: true },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof SyntaxError || error instanceof AdminInputError)
      return Response.json(
        {
          error:
            error instanceof AdminInputError
              ? error.message
              : "请求 JSON 格式错误",
        },
        { status: 400 },
      );
    console.error("Failed to update mistake", error);
    return Response.json({ error: "更新错题失败" }, { status: 503 });
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authenticateAdmin();
  if ("response" in auth) return auth.response;

  const { id } = await params;
  try {
    const deleted = await deleteAdminMistake(id);
    if (!deleted)
      return Response.json({ error: "错题不存在" }, { status: 404 });
    return Response.json(
      { ok: true },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("Failed to delete mistake", error);
    return Response.json({ error: "删除错题失败" }, { status: 503 });
  }
}
