import { env } from "cloudflare:workers";
import type { PracticeDetail, PracticeGrade, PracticeQuestion, PracticeSummary } from "@/lib/practice-types";

export type PracticePaperRow = {
  id: string; user_id: string; subject: string; unit_name: string; grade_level: string;
  questions: string; answers: string; grading: string; created_at: string; graded_at: string | null;
};

const columns = "id, user_id, subject, unit_name, grade_level, questions, answers, grading, created_at, graded_at";

function db(): D1Database {
  if (!env.DB) throw new Error("存储服务暂不可用");
  return env.DB;
}

export function parsePaper(row: PracticePaperRow) {
  return {
    questions: JSON.parse(row.questions) as PracticeQuestion[],
    answers: JSON.parse(row.answers) as string[],
    grading: JSON.parse(row.grading) as PracticeGrade[],
  };
}

export function paperSummary(row: PracticePaperRow): PracticeSummary {
  const { questions, grading } = parsePaper(row);
  return {
    id: row.id, subject: row.subject, unitName: row.unit_name, gradeLevel: row.grade_level,
    questionCount: questions.length, createdAt: row.created_at, gradedAt: row.graded_at,
    correctCount: grading.filter(item => item.verdict === "correct").length,
    incorrectCount: grading.filter(item => item.verdict === "incorrect").length,
    uncertainCount: grading.filter(item => item.verdict === "uncertain").length,
    wrongKnowledgePoints: grading.filter(item => item.verdict === "incorrect").map(item => item.knowledgePoint),
    correctKnowledgePoints: grading.filter(item => item.verdict === "correct").map(item => item.knowledgePoint),
  };
}

export function paperDetail(row: PracticePaperRow): PracticeDetail {
  const { questions, answers, grading } = parsePaper(row);
  return {
    ...paperSummary(row),
    questions: questions.map(item => ({ question: item.question, knowledgePoint: item.knowledgePoint, kind: item.kind })),
    answers, grading,
  };
}

export async function listPracticePapers(userId: string): Promise<PracticePaperRow[]> {
  const { results } = await db().prepare(`SELECT ${columns} FROM practice_papers WHERE user_id = ? ORDER BY created_at DESC LIMIT 100`).bind(userId).all<PracticePaperRow>();
  return results;
}

export async function getPracticePaper(id: string, userId: string): Promise<PracticePaperRow | null> {
  return db().prepare(`SELECT ${columns} FROM practice_papers WHERE id = ? AND user_id = ?`).bind(id, userId).first<PracticePaperRow>();
}

export async function insertPracticePaper(input: {
  id: string; userId: string; subject: string; unitName: string; gradeLevel: string;
  questions: PracticeQuestion[]; createdAt: string;
}): Promise<void> {
  await db().prepare("INSERT INTO practice_papers (id, user_id, subject, unit_name, grade_level, questions, answers, grading, created_at) VALUES (?, ?, ?, ?, ?, ?, '[]', '[]', ?)")
    .bind(input.id, input.userId, input.subject, input.unitName, input.gradeLevel, JSON.stringify(input.questions), input.createdAt).run();
}

export async function savePracticeGrade(id: string, userId: string, answers: string[], grading: PracticeGrade[], gradedAt: string): Promise<void> {
  await db().prepare("UPDATE practice_papers SET answers = ?, grading = ?, graded_at = ? WHERE id = ? AND user_id = ?")
    .bind(JSON.stringify(answers), JSON.stringify(grading), gradedAt, id, userId).run();
}
