import { authenticateAdmin } from "@/lib/api-guard";
import {
  AdminInputError,
  adminPagination,
  listAdminMistakes,
} from "@/lib/admin";

export async function GET(request: Request) {
  const auth = await authenticateAdmin();
  if ("response" in auth) return auth.response;

  const url = new URL(request.url);
  const search = url.searchParams.get("search") || "";
  const subject = url.searchParams.get("subject") || "";
  const userId = url.searchParams.get("userId") || "";

  try {
    const { page, pageSize } = adminPagination(url.searchParams);
    const data = await listAdminMistakes({
      page,
      pageSize,
      search,
      subject,
      userId,
    });
    return Response.json(data, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof AdminInputError)
      return Response.json({ error: error.message }, { status: 400 });
    console.error("Failed to list mistakes for admin", error);
    return Response.json({ error: "获取错题列表失败" }, { status: 503 });
  }
}
