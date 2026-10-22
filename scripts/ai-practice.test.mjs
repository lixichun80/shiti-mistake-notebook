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
    return { ok: true, json: async () => ({ output: [{ content: [{ type: "output_text", text: typeof output === "string" ? output : JSON.stringify(output) }] }] }) };
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
    { question: "什么是一元一次方程？", answer: "含一个未知数且次数为一次的方程", explanation: "根据定义判断", knowledgePoint: "方程", kind: "concept" },
    { question: "2x=4，求 x", answer: "2", explanation: "两边除以 2", knowledgePoint: "方程", kind: "method" },
    { question: "某数加 1 得 5，求该数", answer: "4", explanation: "列方程并求解", knowledgePoint: "方程", kind: "application" },
  ];
  const { exports, calls } = loadAi({ questions });
  assert.equal((await exports.createUnitPaper({ subject: "数学", unitName: "方程", gradeLevel: "七年级", count: 3, focusPoints: ["方程"], weakPoints: [] })).length, 3);
  assert.equal(calls[0].text.format.name, "unit_practice_paper");
  await assert.rejects(exports.createUnitPaper({ subject: "数学", unitName: "方程", gradeLevel: "", count: 5, focusPoints: [], weakPoints: [] }), /生成不完整/);
});

test("unit paper rejects wrong blueprint order and omitted selected points", async () => {
  const questions = [
    { question: "甲", answer: "1", explanation: "甲解析", knowledgePoint: "方程", kind: "method" },
    { question: "乙", answer: "2", explanation: "乙解析", knowledgePoint: "方程", kind: "concept" },
    { question: "丙", answer: "3", explanation: "丙解析", knowledgePoint: "方程", kind: "application" },
  ];
  const { exports } = loadAi({ questions });
  const input = { subject: "数学", unitName: "方程", gradeLevel: "七年级", count: 3, focusPoints: ["函数"], weakPoints: [] };
  await assert.rejects(exports.createUnitPaper(input), /生成不完整/);
  questions[0].kind = "concept";
  questions[1].kind = "method";
  const second = loadAi({ questions });
  await assert.rejects(second.exports.createUnitPaper(input), /未覆盖所选知识点/);
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

test("grading repairs raw LaTeX escapes while preserving valid JSON escapes", async () => {
  const { exports } = loadAi(String.raw`{"grading":[{"index":1,"verdict":"correct","comment":"答案 \(\frac{1}{2}\)\n保持引号 \"与\\路径"}]}`);
  const result = await exports.gradeUnitPaper([
    { question: "1/2", answer: "1/2", explanation: "分数", knowledgePoint: "分数" },
  ], ["1/2"]);
  assert.equal(result[0].comment, '答案 \\(\\frac{1}{2}\\)\n保持引号 "与\\路径');
});

test("malformed JSON unrelated to math remains an error", async () => {
  const { exports } = loadAi('{"grading": [broken]}');
  await assert.rejects(exports.gradeUnitPaper([], []), /JSON|Unexpected/);
});
