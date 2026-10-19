import { env } from "cloudflare:workers";

type AiResponse = { output?: Array<{ type?: string; content?: Array<{ type?: string; text?: string }> }>; error?: { message?: string } };

function parseJsonOutput(raw: string): unknown {
  const text = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  return JSON.parse(text);
}

const mistakeSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    subject: { type: "string" },
    summary: { type: "string" },
    uncertainNote: { type: "string" },
    gradingMode: { type: "string", enum: ["marked", "unmarked", "mixed"] },
    grading: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          pageNumber: { type: "integer" },
          questionLabel: { type: "string" },
          verdict: { type: "string", enum: ["correct", "incorrect", "uncertain"] },
          comment: { type: "string" },
        },
        required: ["pageNumber", "questionLabel", "verdict", "comment"],
      },
    },
    mistakes: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          pageNumber: { type: "integer" },
          question: { type: "string" },
          incorrectAnswer: { type: "string" },
          correctAnswer: { type: "string" },
          reasoning: { type: "string" },
          knowledgePoint: { type: "string" },
        },
        required: ["pageNumber", "question", "incorrectAnswer", "correctAnswer", "reasoning", "knowledgePoint"],
      },
    },
  },
  required: ["subject", "summary", "uncertainNote", "gradingMode", "grading", "mistakes"],
};

const similarSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    questions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          question: { type: "string" },
          answer: { type: "string" },
          explanation: { type: "string" },
        },
        required: ["question", "answer", "explanation"],
      },
    },
  },
  required: ["questions"],
};

export type AnalyzedMistake = {
  pageNumber: number;
  question: string;
  incorrectAnswer: string;
  correctAnswer: string;
  reasoning: string;
  knowledgePoint: string;
};
export type GradedQuestion = { pageNumber: number; questionLabel: string; verdict: "correct" | "incorrect" | "uncertain"; comment: string };
export type Analysis = { subject: string; summary: string; uncertainNote: string; gradingMode: "marked" | "unmarked" | "mixed"; grading: GradedQuestion[]; mistakes: AnalyzedMistake[] };
export type SimilarQuestion = { question: string; answer: string; explanation: string };

export function aiConfigured() { return Boolean(env.DEEPSEEK_API_KEY); }

async function requestAi(input: unknown, name: string, schema: object): Promise<unknown> {
  if (!env.DEEPSEEK_API_KEY) throw new Error("AI 服务尚未配置");
  const response = await fetch("https://api.deepseek.com/responses", {
    method: "POST",
    headers: { "Authorization": `Bearer ${env.DEEPSEEK_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "deepseek-flash",
      instructions: "你是谨慎的中小学学习助手。只能根据给定内容判断，不得编造题目或批改结果。最终只输出符合 JSON Schema 的 JSON，不要使用 Markdown 代码块。",
      input,
      text: { format: { type: "json_schema", name, strict: true, schema } },
    }),
  });
  const result = (await response.json()) as AiResponse;
  if (!response.ok) throw new Error(result.error?.message || `AI 请求失败（${response.status}）`);
  const output = result.output?.flatMap(item => item.content || []).find(item => item.type === "output_text")?.text;
  if (!output) throw new Error("AI 未返回可读取的分析结果");
  return parseJsonOutput(output);
}

export async function analyzePages(images: Array<{ mime: string; base64: string }>): Promise<Analysis> {
  const input = [{
    role: "user",
    content: [
      { type: "input_text", text: "请批改并分析这些试卷或作业图片。图片按传入顺序编号，从第 1 页开始。先判断科目，以及每页是否已有老师的批改标记：全都有则 gradingMode=marked，全都没有则 unmarked，两种都有则 mixed。逐题读取清晰可辨的题目和学生作答。已有批改标记的题，优先依据明确的红笔叉号、扣分、纠错等判定；不要把印刷的红色内容当成批改。没有批改标记的题，你要独立解题并将学生作答与正确答案逐题比较，给出 correct 或 incorrect。每道已作答且可辨认的题都写入 grading，questionLabel 用图片上的题号（没有题号则用简短题目描述），comment 简要说明判定依据。题目、作答、标准或评分规则不清楚，或存在合理的多种答案时，verdict=uncertain，不得臆断为错题；空白题也列为 uncertain，并在 comment 指出未作答。只有能够确认错误的题才写入 mistakes，且必须在 grading 中对应 incorrect。对每道错题完整抄录题意与学生错误答案，给出正确答案、面向学生的分步解题思路及核心知识点。不得编造看不清的文字、作答或批改结果；有遗漏或不确定情况在 uncertainNote 说明。summary 简述本次批改和分析结果。全部用简体中文。若无明确错题，mistakes 返回空数组。" },
      ...images.map(image => ({ type: "input_image", image_url: `data:${image.mime};base64,${image.base64}`, detail: "high" })),
    ],
  }];
  const result = await requestAi(input, "wrong_questions", mistakeSchema) as Analysis;
  if (!result || !Array.isArray(result.mistakes) || !Array.isArray(result.grading) || typeof result.subject !== "string") throw new Error("AI 返回的数据格式不完整");
  result.grading = result.grading.slice(0, 100).filter(item => item && Number.isInteger(item.pageNumber) && typeof item.questionLabel === "string" && ["correct", "incorrect", "uncertain"].includes(item.verdict));
  result.mistakes = result.mistakes.slice(0, 30).filter(item => item.question && item.reasoning && item.correctAnswer);
  return result;
}

export async function createSimilar(question: string, knowledgePoint: string, subject: string, count: number, previousQuestions: string[] = []): Promise<SimilarQuestion[]> {
  const avoidRepeats = previousQuestions.length ? `\n已生成的练习题（不要重复）：${previousQuestions.slice(-20).join("；")}` : "";
  const input = [{ role: "user", content: [{ type: "input_text", text: `请针对下面这道${subject}错题，围绕相同的知识点出恰好 ${count} 道不同的练习题，难度从易到中等。每题有准确答案和简短解题思路。不要直接照抄原题。用简体中文。\n知识点：${knowledgePoint}\n原题：${question}${avoidRepeats}` }] }];
  const result = await requestAi(input, "similar_questions", similarSchema) as { questions: SimilarQuestion[] };
  if (!result || !Array.isArray(result.questions) || result.questions.length !== count || result.questions.some(item => !item.question || !item.answer || !item.explanation)) throw new Error(`未能生成完整的 ${count} 道练习题，请重试`);
  return result.questions;
}
