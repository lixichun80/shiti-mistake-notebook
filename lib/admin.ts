import { env } from "cloudflare:workers";

export class AdminInputError extends Error {}

export function adminPagination(params: URLSearchParams) {
  const read = (name: string, fallback: number, max: number) => {
    const raw = params.get(name);
    if (raw === null) return fallback;
    const value = Number(raw);
    if (
      !/^\d+$/.test(raw) ||
      !Number.isSafeInteger(value) ||
      value < 1 ||
      value > max
    ) {
      throw new AdminInputError(`${name} 必须是 1–${max} 之间的整数`);
    }
    return value;
  };
  return {
    page: read("page", 1, 1_000_000),
    pageSize: read("pageSize", 20, 100),
  };
}

function stringArray(raw: string): string[] {
  try {
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value)
      ? value.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

function db(): D1Database {
  if (!env.DB) throw new Error("D1 绑定缺失（env.DB），无法访问数据库");
  return env.DB;
}

export type AdminOverviewStats = {
  totalUsers: number;
  activeUsers: number;
  adminUsers: number;
  totalMistakes: number;
  totalUploads: number;
  totalSimilarQuestions: number;
  subjectDistribution: { subject: string; count: number; percentage: number }[];
  recentMistakes: {
    id: string;
    subject: string;
    question: string;
    knowledgePoint: string;
    createdAt: string;
    username: string;
    displayName: string;
  }[];
  recentUsers: {
    id: string;
    username: string;
    displayName: string;
    role: string;
    status: string;
    createdAt: string;
    lastLoginAt: string | null;
  }[];
  recentUploads: {
    id: string;
    subject: string;
    fileNames: string[];
    createdAt: string;
    username: string;
    displayName: string;
    mistakeCount: number;
  }[];
};

export async function getAdminOverviewStats(): Promise<AdminOverviewStats> {
  const d1 = db();

  // 1. Users count
  const userStats = await d1
    .prepare(
      "SELECT " +
        "COUNT(*) AS total, " +
        "SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active, " +
        "SUM(CASE WHEN role = 'admin' THEN 1 ELSE 0 END) AS admins " +
        "FROM users",
    )
    .first<{ total: number; active: number; admins: number }>();

  // 2. Mistakes count & similar questions count
  const mistakeStats = await d1
    .prepare("SELECT COUNT(*) AS total FROM mistakes")
    .first<{ total: number }>();

  // 3. Uploads count
  const uploadStats = await d1
    .prepare("SELECT COUNT(*) AS total FROM uploads")
    .first<{ total: number }>();

  // 4. Subject distribution
  const { results: subjectRows } = await d1
    .prepare(
      "SELECT subject, COUNT(*) AS count FROM mistakes GROUP BY subject ORDER BY count DESC",
    )
    .all<{ subject: string; count: number }>();

  const totalMistakes = Number(mistakeStats?.total ?? 0);
  const subjectDistribution = subjectRows.map((r) => ({
    subject: r.subject || "未分类",
    count: Number(r.count),
    percentage:
      totalMistakes > 0
        ? Math.round((Number(r.count) / totalMistakes) * 100)
        : 0,
  }));

  // 5. Total similar questions
  const { results: similarRows } = await d1
    .prepare(
      "SELECT similar_questions FROM mistakes WHERE similar_questions != '[]'",
    )
    .all<{ similar_questions: string }>();

  let totalSimilarQuestions = 0;
  for (const row of similarRows) {
    try {
      const parsed = JSON.parse(row.similar_questions || "[]");
      if (Array.isArray(parsed)) totalSimilarQuestions += parsed.length;
    } catch {
      // ignore
    }
  }

  // 6. Recent Mistakes
  const { results: recentMistakesRows } = await d1
    .prepare(
      "SELECT m.id, m.subject, m.question, m.knowledge_point, m.created_at, " +
        "u.username, u.display_name " +
        "FROM mistakes m " +
        "LEFT JOIN users u ON u.id = m.user_id " +
        "ORDER BY m.created_at DESC LIMIT 8",
    )
    .all<{
      id: string;
      subject: string;
      question: string;
      knowledge_point: string;
      created_at: string;
      username: string | null;
      display_name: string | null;
    }>();

  const recentMistakes = recentMistakesRows.map((r) => ({
    id: r.id,
    subject: r.subject,
    question:
      r.question.length > 80 ? r.question.slice(0, 80) + "..." : r.question,
    knowledgePoint: r.knowledge_point || "未标明",
    createdAt: r.created_at,
    username: r.username || "已删除用户",
    displayName: r.display_name || "未知用户",
  }));

  // 7. Recent Users
  const { results: recentUsersRows } = await d1
    .prepare(
      "SELECT id, username, display_name, role, status, created_at, last_login_at " +
        "FROM users ORDER BY created_at DESC LIMIT 5",
    )
    .all<{
      id: string;
      username: string;
      display_name: string;
      role: string;
      status: string;
      created_at: string;
      last_login_at: string | null;
    }>();

  const recentUsers = recentUsersRows.map((r) => ({
    id: r.id,
    username: r.username,
    displayName: r.display_name,
    role: r.role,
    status: r.status,
    createdAt: r.created_at,
    lastLoginAt: r.last_login_at ?? null,
  }));

  // 8. Recent Uploads with mistake counts
  const { results: recentUploadsRows } = await d1
    .prepare(
      "SELECT up.id, up.subject, up.file_names, up.created_at, " +
        "u.username, u.display_name, " +
        "COUNT(m.id) AS mistake_count " +
        "FROM uploads up " +
        "LEFT JOIN users u ON u.id = up.user_id " +
        "LEFT JOIN mistakes m ON m.upload_id = up.id " +
        "GROUP BY up.id " +
        "ORDER BY up.created_at DESC LIMIT 5",
    )
    .all<{
      id: string;
      subject: string;
      file_names: string;
      created_at: string;
      username: string | null;
      display_name: string | null;
      mistake_count: number;
    }>();

  const recentUploads = recentUploadsRows.map((r) => {
    const fileNames = stringArray(r.file_names);
    return {
      id: r.id,
      subject: r.subject,
      fileNames,
      createdAt: r.created_at,
      username: r.username || "已删除用户",
      displayName: r.display_name || "未知用户",
      mistakeCount: Number(r.mistake_count ?? 0),
    };
  });

  return {
    totalUsers: Number(userStats?.total ?? 0),
    activeUsers: Number(userStats?.active ?? 0),
    adminUsers: Number(userStats?.admins ?? 0),
    totalMistakes,
    totalUploads: Number(uploadStats?.total ?? 0),
    totalSimilarQuestions,
    subjectDistribution,
    recentMistakes,
    recentUsers,
    recentUploads,
  };
}

export type AdminMistakeItem = {
  id: string;
  uploadId: string;
  userId: string;
  username: string;
  displayName: string;
  subject: string;
  question: string;
  incorrectAnswer: string;
  correctAnswer: string;
  reasoning: string;
  knowledgePoint: string;
  pageNumber: number;
  sourceName: string;
  similarQuestions: Array<{
    question: string;
    answer: string;
    explanation: string;
  }>;
  createdAt: string;
};

export async function listAdminMistakes(params: {
  page?: number;
  pageSize?: number;
  search?: string;
  subject?: string;
  userId?: string;
}): Promise<{
  mistakes: AdminMistakeItem[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}> {
  const d1 = db();
  const page = Math.max(1, params.page || 1);
  const pageSize = Math.min(100, Math.max(1, params.pageSize || 20));
  const offset = (page - 1) * pageSize;

  const conditions: string[] = [];
  const binds: Array<string | number> = [];

  if (params.search && params.search.trim()) {
    conditions.push(
      "(m.question LIKE ? OR m.knowledge_point LIKE ? OR m.source_name LIKE ? OR m.incorrect_answer LIKE ? OR m.correct_answer LIKE ?)",
    );
    const pattern = `%${params.search.trim()}%`;
    binds.push(pattern, pattern, pattern, pattern, pattern);
  }

  if (
    params.subject &&
    params.subject !== "all" &&
    params.subject !== "全部科目"
  ) {
    conditions.push("m.subject = ?");
    binds.push(params.subject);
  }

  if (params.userId && params.userId.trim()) {
    conditions.push("m.user_id = ?");
    binds.push(params.userId.trim());
  }

  const whereClause =
    conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  // Count total
  const countStmt = d1
    .prepare(`SELECT COUNT(*) AS total FROM mistakes m ${whereClause}`)
    .bind(...binds);
  const countRow = await countStmt.first<{ total: number }>();
  const total = Number(countRow?.total ?? 0);
  const totalPages = Math.ceil(total / pageSize) || 1;

  // Fetch page
  const queryStmt = d1
    .prepare(
      `SELECT m.id, m.upload_id, m.user_id, m.subject, m.question, ` +
        `m.incorrect_answer, m.correct_answer, m.reasoning, m.knowledge_point, ` +
        `m.page_number, m.source_name, m.similar_questions, m.created_at, ` +
        `u.username, u.display_name ` +
        `FROM mistakes m ` +
        `LEFT JOIN users u ON u.id = m.user_id ` +
        `${whereClause} ` +
        `ORDER BY m.created_at DESC ` +
        `LIMIT ? OFFSET ?`,
    )
    .bind(...binds, pageSize, offset);

  const { results } = await queryStmt.all<{
    id: string;
    upload_id: string;
    user_id: string;
    subject: string;
    question: string;
    incorrect_answer: string;
    correct_answer: string;
    reasoning: string;
    knowledge_point: string;
    page_number: number;
    source_name: string;
    similar_questions: string;
    created_at: string;
    username: string | null;
    display_name: string | null;
  }>();

  const mistakes: AdminMistakeItem[] = results.map((r) => {
    let similarQuestions = [];
    try {
      const parsed: unknown = JSON.parse(r.similar_questions || "[]");
      similarQuestions = Array.isArray(parsed) ? parsed : [];
    } catch {
      similarQuestions = [];
    }
    return {
      id: r.id,
      uploadId: r.upload_id,
      userId: r.user_id,
      username: r.username || "已删除用户",
      displayName: r.display_name || "未知用户",
      subject: r.subject,
      question: r.question,
      incorrectAnswer: r.incorrect_answer,
      correctAnswer: r.correct_answer,
      reasoning: r.reasoning,
      knowledgePoint: r.knowledge_point,
      pageNumber: r.page_number,
      sourceName: r.source_name,
      similarQuestions,
      createdAt: r.created_at,
    };
  });

  return { mistakes, total, page, pageSize, totalPages };
}

export async function updateAdminMistake(
  id: string,
  data: {
    subject?: string;
    question?: string;
    incorrectAnswer?: string;
    correctAnswer?: string;
    reasoning?: string;
    knowledgePoint?: string;
  },
): Promise<boolean> {
  const d1 = db();
  const sets: string[] = [];
  const binds: Array<string | number> = [];

  if (!data || typeof data !== "object" || Array.isArray(data))
    throw new AdminInputError("请提交错题修改内容");
  const fields = [
    "subject",
    "question",
    "incorrectAnswer",
    "correctAnswer",
    "reasoning",
    "knowledgePoint",
  ] as const;
  for (const key of Object.keys(data)) {
    if (!fields.includes(key as (typeof fields)[number]))
      throw new AdminInputError("包含不支持修改的字段");
    const value = data[key as (typeof fields)[number]];
    if (
      typeof value !== "string" ||
      value.length > (key === "subject" ? 100 : 50_000)
    ) {
      throw new AdminInputError("修改内容格式错误或过长");
    }
    if (
      ["subject", "question", "correctAnswer"].includes(key) &&
      !value.trim()
    ) {
      throw new AdminInputError("科目、题干和正确答案不能为空");
    }
  }

  if (typeof data.subject === "string" && data.subject.trim()) {
    sets.push("subject = ?");
    binds.push(data.subject.trim());
  }
  if (typeof data.question === "string" && data.question.trim()) {
    sets.push("question = ?");
    binds.push(data.question.trim());
  }
  if (typeof data.incorrectAnswer === "string") {
    sets.push("incorrect_answer = ?");
    binds.push(data.incorrectAnswer.trim());
  }
  if (typeof data.correctAnswer === "string" && data.correctAnswer.trim()) {
    sets.push("correct_answer = ?");
    binds.push(data.correctAnswer.trim());
  }
  if (typeof data.reasoning === "string") {
    sets.push("reasoning = ?");
    binds.push(data.reasoning.trim());
  }
  if (typeof data.knowledgePoint === "string") {
    sets.push("knowledge_point = ?");
    binds.push(data.knowledgePoint.trim());
  }

  if (sets.length === 0) throw new AdminInputError("请至少修改一个字段");
  binds.push(id);

  const result = await d1
    .prepare(`UPDATE mistakes SET ${sets.join(", ")} WHERE id = ?`)
    .bind(...binds)
    .run();
  return (result.meta.changes ?? 0) > 0;
}

export async function deleteAdminMistake(id: string): Promise<boolean> {
  const d1 = db();
  const res = await d1
    .prepare("DELETE FROM mistakes WHERE id = ?")
    .bind(id)
    .run();
  return (res.meta.changes ?? 0) > 0;
}

export type AdminUploadItem = {
  id: string;
  userId: string;
  username: string;
  displayName: string;
  subject: string;
  fileKeys: string[];
  fileNames: string[];
  mistakeCount: number;
  createdAt: string;
};

export async function listAdminUploads(params: {
  page?: number;
  pageSize?: number;
  search?: string;
  userId?: string;
}): Promise<{
  uploads: AdminUploadItem[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}> {
  const d1 = db();
  const page = Math.max(1, params.page || 1);
  const pageSize = Math.min(100, Math.max(1, params.pageSize || 20));
  const offset = (page - 1) * pageSize;

  const conditions: string[] = [];
  const binds: Array<string | number> = [];

  if (params.search && params.search.trim()) {
    conditions.push("(up.file_names LIKE ? OR up.subject LIKE ?)");
    const pattern = `%${params.search.trim()}%`;
    binds.push(pattern, pattern);
  }

  if (params.userId && params.userId.trim()) {
    conditions.push("up.user_id = ?");
    binds.push(params.userId.trim());
  }

  const whereClause =
    conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  // Count total
  const countStmt = d1
    .prepare(`SELECT COUNT(*) AS total FROM uploads up ${whereClause}`)
    .bind(...binds);
  const countRow = await countStmt.first<{ total: number }>();
  const total = Number(countRow?.total ?? 0);
  const totalPages = Math.ceil(total / pageSize) || 1;

  const queryStmt = d1
    .prepare(
      `SELECT up.id, up.user_id, up.subject, up.file_keys, up.file_names, up.created_at, ` +
        `u.username, u.display_name, ` +
        `COUNT(m.id) AS mistake_count ` +
        `FROM uploads up ` +
        `LEFT JOIN users u ON u.id = up.user_id ` +
        `LEFT JOIN mistakes m ON m.upload_id = up.id ` +
        `${whereClause} ` +
        `GROUP BY up.id ` +
        `ORDER BY up.created_at DESC ` +
        `LIMIT ? OFFSET ?`,
    )
    .bind(...binds, pageSize, offset);

  const { results } = await queryStmt.all<{
    id: string;
    user_id: string;
    subject: string;
    file_keys: string;
    file_names: string;
    created_at: string;
    username: string | null;
    display_name: string | null;
    mistake_count: number;
  }>();

  const uploads: AdminUploadItem[] = results.map((r) => {
    const fileKeys = stringArray(r.file_keys);
    const fileNames = stringArray(r.file_names);
    return {
      id: r.id,
      userId: r.user_id,
      username: r.username || "已删除用户",
      displayName: r.display_name || "未知用户",
      subject: r.subject,
      fileKeys,
      fileNames,
      mistakeCount: Number(r.mistake_count ?? 0),
      createdAt: r.created_at,
    };
  });

  return { uploads, total, page, pageSize, totalPages };
}

export async function deleteAdminUpload(id: string): Promise<string[] | null> {
  const d1 = db();

  // Find file keys to delete in R2
  const uploadRow = await d1
    .prepare("SELECT file_keys FROM uploads WHERE id = ?")
    .bind(id)
    .first<{ file_keys: string }>();

  if (!uploadRow) return null;
  // Never discard malformed keys and delete the only remaining record of the files.
  const parsed: unknown = JSON.parse(uploadRow.file_keys);
  if (
    !Array.isArray(parsed) ||
    parsed.some((key) => typeof key !== "string" || !key)
  ) {
    throw new Error("上传文件索引损坏，请先修复后再删除");
  }
  const keysToDelete = [...new Set(parsed as string[])];
  if (keysToDelete.length) {
    if (!env.BUCKET) throw new Error("R2 未绑定，已保留批次以便重试");
    // R2 deletes are idempotent: partial failure can safely retry using the retained rows.
    for (let offset = 0; offset < keysToDelete.length; offset += 1000) {
      await env.BUCKET.delete(keysToDelete.slice(offset, offset + 1000));
    }
  }

  // Batch delete mistakes and upload
  await d1.batch([
    d1.prepare("DELETE FROM mistakes WHERE upload_id = ?").bind(id),
    d1.prepare("DELETE FROM uploads WHERE id = ?").bind(id),
  ]);

  return keysToDelete;
}

export type AdminSystemStatus = {
  dbStatus: "ok" | "error";
  dbLatencyMs: number;
  tableStats: {
    users: number;
    uploads: number;
    mistakes: number;
  };
  r2Configured: boolean;
  aiConfigured: boolean;
  aiModel: string;
  security: {
    sessionSecretConfigured: boolean;
    trustOaiHeadersDisabled: boolean;
  };
  timestamp: string;
};

export async function getAdminSystemStatus(): Promise<AdminSystemStatus> {
  const startTime = Date.now();
  let dbStatus: "ok" | "error" = "ok";
  let latency = 0;
  let userCount = 0;
  let uploadCount = 0;
  let mistakeCount = 0;

  try {
    const d1 = db();
    const [uRow, upRow, mRow] = await Promise.all([
      d1.prepare("SELECT COUNT(*) AS c FROM users").first<{ c: number }>(),
      d1.prepare("SELECT COUNT(*) AS c FROM uploads").first<{ c: number }>(),
      d1.prepare("SELECT COUNT(*) AS c FROM mistakes").first<{ c: number }>(),
    ]);
    latency = Date.now() - startTime;
    userCount = Number(uRow?.c ?? 0);
    uploadCount = Number(upRow?.c ?? 0);
    mistakeCount = Number(mRow?.c ?? 0);
  } catch {
    dbStatus = "error";
    latency = Date.now() - startTime;
  }

  const aiKey = env.DEEPSEEK_API_KEY;
  const isAiConfigured = Boolean(
    aiKey?.trim() &&
      !["placeholder_key", "local-e2e-dummy-key"].includes(aiKey.trim()),
  );
  const isR2Configured = Boolean(env.BUCKET);
  const hasSecret = Boolean(
    env.SESSION_SECRET && env.SESSION_SECRET.length >= 32,
  );
  const trustOaiHeadersDisabled = env.TRUST_OAI_HEADERS !== "1";

  return {
    dbStatus,
    dbLatencyMs: latency,
    tableStats: {
      users: userCount,
      uploads: uploadCount,
      mistakes: mistakeCount,
    },
    r2Configured: isR2Configured,
    aiConfigured: isAiConfigured,
    aiModel: "deepseek-flash (多模态视觉识别与解析)",
    security: {
      sessionSecretConfigured: hasSecret,
      trustOaiHeadersDisabled,
    },
    timestamp: new Date().toISOString(),
  };
}
