export type EssayExtraction = {
  promptText: string;
  essayText: string;
  uncertainNote: string;
  teacherMarksNote: string;
};

export type EssayFeedback = {
  strength: string;
  evidence: string;
  improvement: string;
};

export type EssayReport = {
  summary: string;
  content: EssayFeedback;
  language: EssayFeedback;
  structure: EssayFeedback;
  handwriting: EssayFeedback & { assessable: boolean };
  sentenceEdits: Array<{
    original: string;
    suggested: string;
    issueType: "spelling" | "grammar" | "punctuation" | "expression";
    explanation: string;
  }>;
  polish: Array<{ original: string; polished: string; reason: string }>;
  references: Array<{ purpose: string; example: string; usage: string }>;
  uncertaintyNote: string;
};

export type EssaySummary = {
  id: string;
  promptText: string;
  excerpt: string;
  createdAt: string;
};

export type EssayDetail = EssaySummary & {
  originalText: string;
  gradeLevel: string;
  report: EssayReport;
};

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

function string(value: unknown, max: number, allowEmpty = false): value is string {
  return typeof value === "string" && value.length <= max && (allowEmpty || Boolean(value.trim()));
}

export function parseEssayExtraction(value: unknown): EssayExtraction {
  const item = record(value);
  if (!item || !string(item.promptText, 2000, true) || !string(item.essayText, 10000, true) ||
    !string(item.uncertainNote, 1000, true) || !string(item.teacherMarksNote, 1000, true)) {
    throw new Error("作文识别结果不完整，请重新上传清晰照片");
  }
  return {
    promptText: item.promptText.trim(), essayText: item.essayText.trim(),
    uncertainNote: item.uncertainNote.trim(), teacherMarksNote: item.teacherMarksNote.trim(),
  };
}

function feedback(value: unknown): value is EssayFeedback {
  const item = record(value);
  return Boolean(item && string(item.strength, 1000, true) && string(item.evidence, 1000, true) && string(item.improvement, 1000, true));
}

function quoteKey(value: string): string {
  return value.toLowerCase().replace(/[’‘]/g, "'").replace(/[\s\p{P}]/gu, "");
}

function appearsInEssay(essay: string, excerpt: string): boolean {
  const key = quoteKey(excerpt);
  return key.length >= 3 && quoteKey(essay).includes(key);
}

export function parseEssayReport(value: unknown, confirmedText: string): EssayReport {
  const item = record(value);
  const hand = record(item?.handwriting);
  if (!item || !string(item.summary, 1500) || !feedback(item.content) || !feedback(item.language) ||
    !feedback(item.structure) || !feedback(item.handwriting) || typeof hand?.assessable !== "boolean" ||
    !string(item.uncertaintyNote, 1500, true) || !Array.isArray(item.sentenceEdits) || item.sentenceEdits.length > 40 ||
    !Array.isArray(item.polish) || item.polish.length > 6 || !Array.isArray(item.references) || item.references.length > 8) {
    throw new Error("作文分析结果不完整，请重试");
  }
  const edits = item.sentenceEdits.map(record);
  if (edits.some(edit => !edit || !string(edit.original, 1000) || !string(edit.suggested, 1000) ||
    !string(edit.explanation, 1000) || !["spelling", "grammar", "punctuation", "expression"].includes(String(edit.issueType)) ||
    !appearsInEssay(confirmedText, edit.original as string))) {
    throw new Error("逐句批改未能与确认后的原文对应，请重试");
  }
  const polish = item.polish.map(record);
  if (polish.some(entry => !entry || !string(entry.original, 1200) || !string(entry.polished, 1500) ||
    !string(entry.reason, 1000) || !appearsInEssay(confirmedText, entry.original as string))) {
    throw new Error("润色建议未能与确认后的原文对应，请重试");
  }
  const references = item.references.map(record);
  if (references.some(entry => !entry || !string(entry.purpose, 100) || !string(entry.example, 700) || !string(entry.usage, 700))) {
    throw new Error("佳句参考内容不完整，请重试");
  }
  return item as EssayReport;
}
