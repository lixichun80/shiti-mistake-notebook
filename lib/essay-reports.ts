import { env } from "cloudflare:workers";
import { parseEssayReport, type EssayDetail, type EssaySummary } from "@/lib/essay-types";

type EssayRow = {
  id: string; user_id: string; prompt_text: string; original_text: string;
  grade_level: string; report_json: string; created_at: string;
};

function db(): D1Database {
  if (!env.DB) throw new Error("存储服务暂不可用");
  return env.DB;
}

function summary(row: Pick<EssayRow, "id" | "prompt_text" | "original_text" | "created_at">): EssaySummary {
  return {
    id: row.id, promptText: row.prompt_text,
    excerpt: row.original_text.replace(/\s+/g, " ").slice(0, 100), createdAt: row.created_at,
  };
}

export async function listEssayReports(userId: string): Promise<EssaySummary[]> {
  const { results } = await db().prepare("SELECT id, prompt_text, original_text, created_at FROM essay_reports WHERE user_id = ? ORDER BY created_at DESC LIMIT 100")
    .bind(userId).all<EssayRow>();
  return results.map(summary);
}

export async function getEssayReport(id: string, userId: string): Promise<EssayDetail | null> {
  const row = await db().prepare("SELECT id, user_id, prompt_text, original_text, grade_level, report_json, created_at FROM essay_reports WHERE id = ? AND user_id = ?")
    .bind(id, userId).first<EssayRow>();
  if (!row) return null;
  return {
    ...summary(row), originalText: row.original_text, gradeLevel: row.grade_level,
    report: parseEssayReport(JSON.parse(row.report_json), row.original_text),
  };
}

export async function insertEssayReport(input: {
  id: string; userId: string; promptText: string; originalText: string;
  gradeLevel: string; reportJson: string; createdAt: string;
}): Promise<void> {
  await db().prepare("INSERT INTO essay_reports (id, user_id, prompt_text, original_text, grade_level, report_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .bind(input.id, input.userId, input.promptText, input.originalText, input.gradeLevel, input.reportJson, input.createdAt).run();
}
