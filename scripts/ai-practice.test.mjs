import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const source = readFileSync(new URL("../lib/ai.ts", import.meta.url), "utf8");
const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const blueprintCode = ts.transpileModule(readFileSync(new URL("../lib/practice-blueprint.ts", import.meta.url), "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const blueprintExports = {};
vm.runInNewContext(blueprintCode, { exports: blueprintExports });
const essayTypesCode = ts.transpileModule(readFileSync(new URL("../lib/essay-types.ts", import.meta.url), "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const essayTypesExports = {};
vm.runInNewContext(essayTypesCode, { exports: essayTypesExports });

function loadAi(output) {
  const exports = {};
  const calls = [];
  const fetch = async (_url, options) => {
    calls.push(JSON.parse(options.body));
    const value = typeof output === "function" ? output(calls.length - 1) : output;
    return { ok: true, json: async () => ({ output: [{ content: [{ type: "output_text", text: typeof value === "string" ? value : JSON.stringify(value) }] }] }) };
  };
  vm.runInNewContext(code, { exports, require: name => {
    if (name === "cloudflare:workers") return { env: { DEEPSEEK_API_KEY: "test-key" } };
    if (name === "@/lib/practice-blueprint") return blueprintExports;
    if (name === "@/lib/essay-types") return essayTypesExports;
    throw new Error(`Unexpected import: ${name}`);
  }, fetch });
  return { exports, calls };
}

test("unit paper generation requires exactly the requested complete questions", async () => {
  const questions = [
    { question: "哪一个是一元一次方程？", answer: "A", explanation: "根据定义判断", knowledgePoint: "方程", kind: "concept", format: "choice", options: ["x+1=2", "x²=2", "xy=2", "1=2"], table: { headers: [], rows: [] } },
    { question: "2x=4，x=___", answer: "2", explanation: "两边除以 2", knowledgePoint: "方程", kind: "method", format: "fill", options: [], table: { headers: [], rows: [] } },
    { question: "某数加 1 得 5，求该数", answer: "4", explanation: "列方程并求解", knowledgePoint: "方程", kind: "application", format: "short", options: [], table: { headers: [], rows: [] } },
  ];
  const { exports, calls } = loadAi({ questions });
  assert.equal((await exports.createUnitPaper({ subject: "数学", unitName: "方程", gradeLevel: "七年级", count: 3, focusPoints: ["方程"], weakPoints: [] })).length, 3);
  assert.equal(calls[0].text.format.name, "unit_practice_paper");
  await assert.rejects(exports.createUnitPaper({ subject: "数学", unitName: "方程", gradeLevel: "", count: 5, focusPoints: [], weakPoints: [] }), /生成不完整/);
});

test("unit paper rejects wrong blueprint order and omitted selected points", async () => {
  const questions = [
    { question: "甲", answer: "A", explanation: "甲解析", knowledgePoint: "方程", kind: "method", format: "choice", options: ["1", "2", "3", "4"], table: { headers: [], rows: [] } },
    { question: "乙___", answer: "2", explanation: "乙解析", knowledgePoint: "方程", kind: "concept", format: "fill", options: [], table: { headers: [], rows: [] } },
    { question: "丙", answer: "3", explanation: "丙解析", knowledgePoint: "方程", kind: "application", format: "short", options: [], table: { headers: [], rows: [] } },
  ];
  const { exports } = loadAi({ questions });
  const input = { subject: "数学", unitName: "方程", gradeLevel: "七年级", count: 3, focusPoints: ["函数"], weakPoints: [] };
  await assert.rejects(exports.createUnitPaper(input), /生成不完整/);
  questions[0].kind = "concept";
  questions[1].kind = "method";
  const second = loadAi({ questions });
  await assert.rejects(second.exports.createUnitPaper(input), /未覆盖所选知识点/);
});

test("30-question papers are generated in bounded batches with choice, fill and chart data", async () => {
  const kinds = blueprintExports.practiceBlueprint(30);
  const formats = blueprintExports.practiceFormatBlueprint(30);
  const all = formats.map((format, index) => ({
    question: `独立题目${index + 1}${format === "fill" ? "___" : ""}`,
    answer: format === "choice" ? "B" : "2",
    explanation: "示例解析",
    knowledgePoint: index === 0 ? "方程" : "综合",
    kind: kinds[index], format,
    options: format === "choice" ? ["1", "2", "3", "4"] : [],
    table: format === "chart" ? { headers: ["项目", "数量"], rows: [["甲", "1"], ["乙", "2"]] } : { headers: [], rows: [] },
  }));
  const { exports, calls } = loadAi(index => ({ questions: all.slice(index * 10, (index + 1) * 10) }));
  const result = await exports.createUnitPaper({ subject: "数学", unitName: "方程", gradeLevel: "七年级", count: 30, focusPoints: ["方程"], weakPoints: [] });
  assert.equal(result.length, 30);
  assert.equal(calls.length, 3);
  assert.equal(result[4].format, "chart");
  assert.equal(result[4].table.rows.length, 2);
  assert.equal(result[0].options.length, 4);
  assert.equal(blueprintExports.validPracticeCount(31), false);
});

test("chart questions with missing table cells are rejected before saving", async () => {
  const kinds = blueprintExports.practiceBlueprint(5);
  const formats = blueprintExports.practiceFormatBlueprint(5);
  const questions = formats.map((format, index) => ({
    question: `题目${index + 1}`, answer: format === "choice" ? "A" : "2", explanation: "解析", knowledgePoint: "统计",
    kind: kinds[index], format, options: format === "choice" ? ["甲", "乙", "丙", "丁"] : [],
    table: format === "chart" ? { headers: ["项目", "数量"], rows: [["甲"], ["乙", "2"]] } : { headers: [], rows: [] },
  }));
  const { exports } = loadAi({ questions });
  await assert.rejects(exports.createUnitPaper({ subject: "数学", unitName: "统计", gradeLevel: "", count: 5, focusPoints: [], weakPoints: [] }), /生成不完整/);
});

test("knowledge guide requires complete, bounded advice", async () => {
  const input = { subject: "数学", knowledgePoint: "方程", unitName: "方程单元", examples: [] };
  const valid = loadAi({ coreIdea: "等式中的未知数", commonMistake: "可能混淆移项", firstStep: "先核对等式性质" });
  assert.equal((await valid.exports.createKnowledgeGuide(input)).firstStep, "先核对等式性质");
  const invalid = loadAi({ coreIdea: "", commonMistake: "可能混淆移项", firstStep: "先核对等式性质" });
  await assert.rejects(invalid.exports.createKnowledgeGuide(input), /生成不完整/);
});

test("grading sorts results and never marks blank answers correct", async () => {
  const { exports } = loadAi({ grading: [
    { index: 2, verdict: "correct", comment: "正确" },
    { index: 1, verdict: "correct", comment: "答案等价" },
  ] });
  const result = await exports.gradeUnitPaper([
    { question: "1+1", answer: "2", explanation: "加法", knowledgePoint: "加法" },
    { question: "2+2", answer: "4", explanation: "加法", knowledgePoint: "加法" },
  ], ["2", ""]);
  assert.equal(result[0].index, 1);
  assert.equal(result[0].verdict, "correct");
  assert.equal(result[1].verdict, "incorrect");
  assert.match(result[1].comment, /未作答/);
});

test("30-question grading keeps original indexes across three batches", async () => {
  const { exports, calls } = loadAi(batchIndex => ({ grading: Array.from({ length: 10 }, (_, index) => ({
    index: batchIndex * 10 + index + 1, verdict: "correct", comment: "答案正确",
  })) }));
  const questions = Array.from({ length: 30 }, (_, index) => ({ question: `题目${index + 1}`, answer: "A", explanation: "解析", knowledgePoint: "综合" }));
  const result = await exports.gradeUnitPaper(questions, questions.map(() => "A"));
  assert.equal(calls.length, 3);
  assert.equal(result.length, 30);
  assert.equal(result[29].index, 30);
});

test("grading repairs raw LaTeX escapes while preserving valid JSON escapes", async () => {
  const { exports } = loadAi(String.raw`{"grading":[{"index":1,"verdict":"correct","comment":"答案 \(\frac{1}{2}\)\n保持引号 \"与\\路径"}]}`);
  const result = await exports.gradeUnitPaper([
    { question: "1/2", answer: "1/2", explanation: "分数", knowledgePoint: "分数" },
  ], ["1/2"]);
  assert.equal(result[0].comment, '答案 \\(\\frac{1}{2}\\)\n保持引号 "与\\路径');
});

test("malformed JSON unrelated to math remains an error", async () => {
  const { exports } = loadAi('{"grading": [broken]}');
  await assert.rejects(exports.gradeUnitPaper([{ question: "1+1", answer: "2", explanation: "加法", knowledgePoint: "加法" }], ["2"]), /JSON|Unexpected/);
});
