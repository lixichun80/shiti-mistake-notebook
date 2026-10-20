import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const source = readFileSync(new URL("../lib/ai.ts", import.meta.url), "utf8");
const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;

function loadAi(output) {
  const exports = {};
  const calls = [];
  const fetch = async (_url, options) => {
    calls.push(JSON.parse(options.body));
    return { ok: true, json: async () => ({ output: [{ content: [{ type: "output_text", text: JSON.stringify(output) }] }] }) };
  };
  vm.runInNewContext(code, { exports, require: name => {
    if (name === "cloudflare:workers") return { env: { DEEPSEEK_API_KEY: "test-key" } };
    throw new Error(`Unexpected import: ${name}`);
  }, fetch });
  return { exports, calls };
}

test("unit paper generation requires exactly the requested complete questions", async () => {
  const questions = [
    { question: "2x=4，求 x", answer: "2", explanation: "两边除以 2", knowledgePoint: "方程" },
    { question: "x+1=5，求 x", answer: "4", explanation: "两边减 1", knowledgePoint: "方程" },
  ];
  const { exports, calls } = loadAi({ questions });
  assert.equal((await exports.createUnitPaper({ subject: "数学", unitName: "方程", gradeLevel: "七年级", count: 2, weakPoints: [] })).length, 2);
  assert.equal(calls[0].text.format.name, "unit_practice_paper");
  await assert.rejects(exports.createUnitPaper({ subject: "数学", unitName: "方程", gradeLevel: "", count: 5, weakPoints: [] }), /生成不完整/);
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
