// Independently validate generated Word packages with Python's ZIP/XML readers.
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import ts from "typescript";

const source = readFileSync(
  new URL("../lib/mistake-docx.ts", import.meta.url),
  "utf8",
);
const code = ts.transpileModule(source, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.CommonJS,
  },
}).outputText;
const mathCode = ts.transpileModule(readFileSync(new URL("../lib/math-notation.ts", import.meta.url), "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const mathExports = {};
vm.runInNewContext(mathCode, { exports: mathExports });
const blueprintCode = ts.transpileModule(readFileSync(new URL("../lib/practice-blueprint.ts", import.meta.url), "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const blueprintExports = {};
vm.runInNewContext(blueprintCode, { exports: blueprintExports });
const exports = {};
vm.runInNewContext(code, { exports, require: name => {
  if (name === "./math-notation") return mathExports;
  if (name === "./practice-blueprint") return blueprintExports;
  throw new Error(`Unexpected import: ${name}`);
}, TextEncoder, Uint8Array, DataView, Date });
const fixture = {
  subject: "数学",
  question: "计算：(-3)² + 2 × (-4)\n判断：3 < 5 & 8 > 2。\u0000\n再求 √(9) 和 1/2。",
  incorrectAnswer: "-17",
  correctAnswer: "1",
  reasoning: "先算乘方，再算乘除，最后加减。\n保留换行。",
  knowledgePoint: "有理数混合运算",
  pageNumber: 2,
  sourceName: "周练 & <练习>.png",
  createdAt: "2026-10-18T00:00:00Z",
  similarQuestions: [
    {
      question: "求 (-2)³ + 4 × 3 的值。",
      answer: "4",
      explanation: "-8 + 12 = 4。",
    },
    {
      question: "This is a long English question. ".repeat(50),
      answer: "English answer",
      explanation: "Explanation.",
    },
  ],
};
mkdirSync(new URL("../outputs/", import.meta.url), { recursive: true });
const files = ["mistake-worksheet.docx", "mistake-no-practice.docx"];
for (const [index, name] of files.entries()) {
  const item = index
    ? { ...fixture, similarQuestions: [], createdAt: "invalid-date" }
    : fixture;
  const bytes = exports.makeMistakeDocx(item);
  assert.equal(new DataView(bytes.buffer).getUint32(0, true), 0x04034b50);
  writeFileSync(new URL(`../outputs/${name}`, import.meta.url), bytes);
}
const batchItems = [fixture, { ...fixture, subject: "英语", question: "第二道独立错题：选择正确时态。", incorrectAnswer: "go", correctAnswer: "went", reasoning: "根据过去时间判断。", similarQuestions: [] }];
const batchFile = "mistake-batch.docx";
writeFileSync(new URL(`../outputs/${batchFile}`, import.meta.url), exports.makeMistakesDocx(batchItems));
assert.match(exports.mistakesDocxFilename(batchItems), /2道错题练习\.docx$/);
assert.throws(() => exports.makeMistakesDocx([]), /请先选择错题/);
const imageFile = "mistake-with-chart.docx";
const chartBytes = readFileSync(new URL("./fixtures/word-chart.jpg", import.meta.url));
writeFileSync(new URL(`../outputs/${imageFile}`, import.meta.url), exports.makeMistakesDocx([{
  ...fixture, similarQuestions: [], visualQuestion: true,
  sourceImage: { bytes: chartBytes, width: 640, height: 350, fullPage: false },
}]));
const pngFile = "mistake-with-png.docx";
const pngBytes = readFileSync(new URL("./fixtures/homework-grading.png", import.meta.url));
writeFileSync(new URL(`../outputs/${pngFile}`, import.meta.url), exports.makeMistakesDocx([{
  ...fixture, similarQuestions: [], visualQuestion: true,
  sourceImage: { bytes: pngBytes, width: pngBytes.readUInt32BE(16), height: pngBytes.readUInt32BE(20), fullPage: true, mime: "image/png" },
}]));
const unitFile = "unit-practice-blueprint.docx";
writeFileSync(new URL(`../outputs/${unitFile}`, import.meta.url), exports.makeUnitPaperDocx({
  subject: "数学", unitName: "根式与分数", gradeLevel: "八年级",
  questions: [
    { question: "写出 \\(\\sqrt{9}\\) 的值", answer: "3", explanation: "算术平方根为非负数", knowledgePoint: "平方根", kind: "concept" },
    { question: "计算 \\(\\frac{1}{2}+\\frac{1}{2}\\)", answer: "1", explanation: "分母相同，分子相加", knowledgePoint: "分数", kind: "method" },
    { question: "两个半份共是多少？", answer: "1", explanation: "联系生活情境", knowledgePoint: "分数", kind: "application" },
    { question: "根据表格，计算两组数据的差。", answer: "2", explanation: "比较表中数据", knowledgePoint: "统计表", kind: "application", format: "chart", table: { headers: ["组别", "数量"], rows: [["甲", "5"], ["乙", "3"]] } },
  ],
}));
assert(
  !/[\\/:*?"<>|\u0000-\u001f]/.test(
    exports.mistakeDocxFilename({ ...fixture, subject: '数/学:*?"<>|' }),
  ),
);
const python = String.raw`
import sys, zipfile, xml.etree.ElementTree as ET, posixpath
ns = {'w': 'http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'm': 'http://schemas.openxmlformats.org/officeDocument/2006/math', 'wp': 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing'}
for i, path in enumerate(sys.argv[1:]):
    with zipfile.ZipFile(path) as z:
        assert z.testzip() is None, 'ZIP integrity/CRC failed'
        for name in z.namelist():
            if name.endswith(('.xml', '.rels')): ET.fromstring(z.read(name))
        doc = ET.fromstring(z.read('word/document.xml'))
        text = '\n'.join(n.text or '' for n in doc.findall('.//w:t', ns))
        if i == 4:
            assert '根式与分数单元练习卷' in text
            assert '基础概念' in text and '典型方法' in text and '迁移应用' in text
            assert len(doc.findall('.//m:rad', ns)) >= 1 and len(doc.findall('.//m:f', ns)) >= 1
            assert len(doc.findall('.//w:br[@w:type="page"]', ns)) == 1
            assert len(doc.findall('.//w:tbl', ns)) == 1
            assert '组别' in text and '甲' in text and '乙' in text
            continue
        assert '(-3)² + 2 × (-4)' in text
        assert '3 < 5 & 8 > 2' in text
        assert '周练 & <练习>.png' in text
        assert len(doc.findall('.//m:rad', ns)) >= 1
        assert len(doc.findall('.//m:f', ns)) >= 1
        assert '我的原答案：-17' in text and '正确答案：1' in text
        assert '\x00' not in text
        assert len(doc.findall('.//w:br[@w:type="page"]', ns)) == 1
        assert len(doc.findall('.//w:pBdr', ns)) == (2 if i in (1, 3, 5) else 8 if i == 2 else 6)
        assert ('二、举一反三' in text) == (i == 0)
        if i == 2:
            assert '第二道独立错题：选择正确时态。' in text
            assert '正确答案：went' in text
            assert '第 2 道错题' in text
            assert '错题练习单 · 2 道' in text
        if i == 3:
            assert len(doc.findall('.//w:drawing', ns)) == 1
            assert z.read('word/media/question-1.jpg')[:2] == b'\xff\xd8'
            assert doc.find('.//wp:extent', ns) is not None
        if i == 5:
            assert len(doc.findall('.//w:drawing', ns)) == 1
            assert z.read('word/media/question-1.png')[:8] == b'\x89PNG\r\n\x1a\n'
        assert doc.find('.//w:pgSz', ns).get('{'+ns['w']+'}w') == '11906'
        footer = ET.fromstring(z.read('word/footer1.xml'))
        assert footer.find('.//w:fldSimple', ns).get('{'+ns['w']+'}instr') == 'PAGE'
        rels = ET.fromstring(z.read('word/_rels/document.xml.rels'))
        for rel in rels: assert posixpath.normpath('word/'+rel.get('Target')) in z.namelist()
        if i in (3, 5): assert any(rel.get('Type', '').endswith('/image') for rel in rels)
print('PASS: ZIP/CRC, OOXML parts and relationships, Chinese/math/XML escaping, long text, page break, A4, writing space, answer key and page fields.')
`;
const result = spawnSync(
  process.platform === "win32" ? "python" : "python3",
  [
    "-c",
    python,
    ...[...files, batchFile, imageFile, unitFile, pngFile].map((name) =>
      fileURLToPath(new URL(`../outputs/${name}`, import.meta.url)),
    ),
  ],
  { encoding: "utf8", windowsHide: true },
);
if (result.status !== 0)
  throw new Error(
    result.stderr || result.error?.message || "Word package validation failed",
  );
console.log(result.stdout.trim());
