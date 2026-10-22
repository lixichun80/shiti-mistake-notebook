import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

function compile(path) {
  return ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
}
const types = {};
vm.runInNewContext(compile("../lib/essay-types.ts"), { exports: types });
const blueprint = {};
vm.runInNewContext(compile("../lib/practice-blueprint.ts"), { exports: blueprint });

function ai(output) {
  const exports = {};
  const requests = [];
  const fetch = async (_url, options) => {
    requests.push(JSON.parse(options.body));
    return { ok: true, json: async () => ({ output: [{ content: [{ type: "output_text", text: JSON.stringify(output) }] }] }) };
  };
  vm.runInNewContext(compile("../lib/ai.ts"), { exports, fetch, require: name => {
    if (name === "cloudflare:workers") return { env: { DEEPSEEK_API_KEY: "test-only" } };
    if (name === "@/lib/essay-types") return types;
    if (name === "@/lib/practice-blueprint") return blueprint;
    throw new Error(`Unexpected import: ${name}`);
  } });
  return { exports, requests };
}

const essay = "This is my dad. He play football every day. I love my family.";
const report = {
  summary: "内容完整，动词形式需要核对。",
  content: { strength: "介绍了家庭", evidence: "I love my family.", improvement: "加入具体细节" },
  language: { strength: "表达清楚", evidence: "This is my dad.", improvement: "核对主谓一致" },
  structure: { strength: "有结尾", evidence: "I love my family.", improvement: "补充过渡" },
  handwriting: { strength: "照片可辨", evidence: "字母清晰", improvement: "保持行距", assessable: true },
  sentenceEdits: [{ original: "He play football every day.", suggested: "He plays football every day.", issueType: "grammar", explanation: "第三人称单数动词加 s" }],
  polish: [{ original: "I love my family.", polished: "I feel lucky to have such a warm family.", reason: "结尾更具体" }],
  references: [{ purpose: "开头", example: "Let me introduce my family.", usage: "可用作介绍家庭的开头" }],
  uncertaintyNote: "",
};

test("essay extraction keeps student text and teacher marks separate", async () => {
  const extraction = { promptText: "Introduce your family.", essayText: essay, uncertainNote: "", teacherMarksNote: "动词有批注" };
  const { exports, requests } = ai(extraction);
  const result = await exports.extractEssay([{ mime: "image/jpeg", base64: "abc" }], "My Family");
  assert.equal(result.essayText, essay);
  assert.equal(result.teacherMarksNote, "动词有批注");
  assert.equal(requests[0].text.format.name, "essay_extraction");
  assert.equal(requests[0].input[0].content[1].type, "input_image");
});

test("essay report quotes only confirmed original sentences", async () => {
  const { exports, requests } = ai(report);
  const result = await exports.analyzeEssay({ confirmedText: essay, promptText: "Introduce your family.", gradeLevel: "七年级", images: [{ mime: "image/jpeg", base64: "abc" }] });
  assert.equal(result.sentenceEdits[0].original, "He play football every day.");
  assert.equal(requests[0].text.format.name, "essay_report");
  assert.match(requests[0].input[0].content[0].text, /确认后的原文/);
  const fabricated = ai({ ...report, sentenceEdits: [{ ...report.sentenceEdits[0], original: "He likes basketball." }] });
  await assert.rejects(fabricated.exports.analyzeEssay({ confirmedText: essay, promptText: "Introduce your family.", gradeLevel: "", images: [] }), /原文对应/);
});

test("essay validators reject incomplete fields and invented polish quotes", () => {
  assert.throws(() => types.parseEssayExtraction({ essayText: essay }), /不完整/);
  assert.throws(() => types.parseEssayReport({ ...report, polish: [{ ...report.polish[0], original: "My brother is seven." }] }, essay), /原文对应/);
});
