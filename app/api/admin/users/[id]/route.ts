import { env } from "cloudflare:workers";
import { authenticateAdmin } from "@/lib/api-guard";
import { hashPassword } from "@/lib/auth";
import { checkDisplayName, checkPassword, checkWechat, normalizeWechat } from "@/lib/credentials";
import { extendTrialByWeek } from "@/lib/trial";
import {
  countAdmins,
  deleteUserRows,
  findUserById,
  listUploadFileKeys,
  setDisplayName,
  setPassword,
  setRole,
  setStatus,
  setTrialEndsAt,
  setWechat,
} from "@/lib/users";

function fail(error: string, status: number) {
  return Response.json({ error }, { status, headers: { "Cache-Control": "no-store" } });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticateAdmin();
  if ("response" in auth) return auth.response;
  const admin = auth.user;
  const { id } = await params;

  let body: {
    displayName?: unknown;
    role?: unknown;
    status?: unknown;
    password?: unknown;
    wechat?: unknown;
    trialAction?: unknown;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return fail("请求格式不正确", 400);
  }

  if (!env.DB) return fail("存储服务暂不可用", 503);

  let target;
  try {
    target = await findUserById(id);
  } catch {
    return fail("存储服务暂不可用", 503);
  }
  if (!target) return fail("账号不存在", 404);

  const isSelf = id === admin.userId;
  const displayName = typeof body.displayName === "string" ? body.displayName.trim() : null;
  const role = body.role === "admin" ? "admin" : body.role === "user" ? "user" : null;
  const status = body.status === "active" ? "active" : body.status === "disabled" ? "disabled" : null;
  const password = typeof body.password === "string" && body.password ? body.password : null;
  // 没传这个字段就不动；传空串表示清空
  const wechat = typeof body.wechat === "string" ? normalizeWechat(body.wechat) : null;
  const trialAction = body.trialAction === "extend7" || body.trialAction === "unlimited" ? body.trialAction : null;
  if (body.trialAction !== undefined && trialAction === null) return fail("试用期操作不正确", 400);
  if (trialAction === "extend7" && target.trialEndsAt === null) return fail("此账号已长期可用，无需延长试用期", 400);

  if (displayName !== null) {
    const invalid = checkDisplayName(displayName);
    if (invalid) return fail(invalid, 400);
    if (!displayName) return fail("昵称不能为空", 400);
  }
  if (password !== null) {
    const invalid = checkPassword(password);
    if (invalid) return fail(invalid, 400);
  }
  if (wechat !== null) {
    const invalid = checkWechat(wechat, false);
    if (invalid) return fail(invalid, 400);
  }

  // ---- 自锁保护 ----
  // 前两条是真正起作用的：没有它们，一次误操作就能把最后一个管理员关在门外，
  // 而且没有任何后门能救回来（不收集邮箱，也就没有找回密码）。
  if (isSelf && role === "user") return fail("不能取消自己的管理员权限", 400);
  if (isSelf && status === "disabled") return fail("不能停用自己的账号", 400);

  // 第三条是后备，正常操作路径上到不了：调用者本身一定是管理员，所以当他去动
  // 另一个管理员时，管理员总数至少是 2，`admins <= 1` 不可能成立。留着是为了将来
  // 万一放开「自己降级自己」，或者加了转移管理员之类的功能时，这层还在。
  if (!isSelf && role === "user" && target.role === "admin") {
    let admins: number;
    try {
      admins = await countAdmins();
    } catch {
      return fail("存储服务暂不可用", 503);
    }
    if (admins <= 1) return fail("这是最后一个管理员，不能降级", 400);
  }

  try {
    if (displayName !== null) await setDisplayName(id, displayName);
    if (role !== null) await setRole(id, role);
    if (wechat !== null) await setWechat(id, wechat);
    if (trialAction === "extend7") await setTrialEndsAt(id, extendTrialByWeek(target.trialEndsAt!));
    if (trialAction === "unlimited") await setTrialEndsAt(id, null);
    // setStatus / setPassword 内部会递增 session_epoch，把这个用户的旧 cookie 全部作废
    if (status !== null) await setStatus(id, status);
    if (password !== null) await setPassword(id, await hashPassword(password));
  } catch {
    return fail("更新失败，请稍后重试", 503);
  }

  return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticateAdmin();
  if ("response" in auth) return auth.response;
  const admin = auth.user;
  const { id } = await params;

  if (id === admin.userId) return fail("不能删除自己的账号", 400);
  if (!env.DB) return fail("存储服务暂不可用", 503);

  let target;
  try {
    target = await findUserById(id);
  } catch {
    return fail("存储服务暂不可用", 503);
  }
  if (!target) return fail("账号不存在", 404);

  // 同上，正常路径到不了（调用者自己是管理员，说明至少有两个），留作后备
  if (target.role === "admin") {
    let admins: number;
    try {
      admins = await countAdmins();
    } catch {
      return fail("存储服务暂不可用", 503);
    }
    if (admins <= 1) return fail("这是最后一个管理员，删掉就没人能进后台了", 400);
  }

  // 先删 R2 对象，再删库里的行 —— 顺序不能反。反过来的话，删完 uploads
  // 就再也查不到 file_keys 了，那些图片会永远留在桶里成为孤儿。
  let keys: string[] = [];
  try {
    keys = await listUploadFileKeys(id);
  } catch {
    return fail("读取该账号的上传记录失败", 503);
  }

  if (keys.length > 0) {
    if (!env.BUCKET) return fail("图片存储未绑定，为避免留下孤儿文件，未执行删除", 503);
    try {
      await env.BUCKET.delete(keys);
    } catch {
      // 这里中止是有意的：R2 删不掉就把账号留着，管理员可以重试。
      // 继续删库会留下永远清不掉的孤儿图片，而且再也没人知道它们属于谁。
      return fail("删除图片失败，账号未删除，请稍后重试", 503);
    }
  }

  try {
    await deleteUserRows(id);
  } catch {
    return fail("删除账号失败，请稍后重试", 503);
  }

  return Response.json(
    { ok: true, deletedImages: keys.length },
    { headers: { "Cache-Control": "no-store" } },
  );
}
