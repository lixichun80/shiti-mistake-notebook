import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync, rmSync, rmdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import vm from "node:vm";
import ts from "typescript";

function storedZipEntry(bytes, target) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const decoder = new TextDecoder();
  let offset = 0;
  while (offset + 30 <= bytes.length && view.getUint32(offset, true) === 0x04034b50) {
    const size = view.getUint32(offset + 18, true);
    const nameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);
    const name = decoder.decode(bytes.subarray(offset + 30, offset + 30 + nameLength));
    const start = offset + 30 + nameLength + extraLength;
    if (name === target) return decoder.decode(bytes.subarray(start, start + size));
    offset = start + size;
  }
  throw new Error(`Missing Word entry: ${target}`);
}

const source = readFileSync(new URL("../lib/mistake-docx.ts", import.meta.url), "utf8");
const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const mathCode = ts.transpileModule(readFileSync(new URL("../lib/math-notation.ts", import.meta.url), "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const mathExports = {};
vm.runInNewContext(mathCode, { exports: mathExports });
const blueprintCode = ts.transpileModule(readFileSync(new URL("../lib/practice-blueprint.ts", import.meta.url), "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const blueprintExports = {};
vm.runInNewContext(blueprintCode, { exports: blueprintExports });
const exports = {};
vm.runInNewContext(code, { exports, require: name => name === "./math-notation" ? mathExports : blueprintExports, TextEncoder, Uint8Array, DataView, Date });
const paper = {
  subject: "数/学", unitName: "一元一次方程 & <应用>", gradeLevel: "七年级",
  questions: [
    { question: "计算 \\(\\sqrt{9}+\\frac{1}{2}\\) 的值。", answer: "\\(\\frac{7}{2}\\)", explanation: "根号 9 等于 3，3+1/2=7/2。", knowledgePoint: "根式与分数" },
    { question: "判断 3 < 5 & 8 > 2。\u0000", answer: "都成立", explanation: "逐个比较。", knowledgePoint: "不等式" },
    { question: "哪一项正确？", answer: "B", explanation: "检查定义。", knowledgePoint: "方程", format: "choice", options: ["错误选项", "正确选项", "其他", "都不是"] },
    { question: "根据表格，乙的数量是多少？", answer: "2", explanation: "读取乙所在行。", knowledgePoint: "统计", format: "chart", table: { headers: ["项目", "数量"], rows: [["甲", "1"], ["乙", "2"]] } },
  ],
};
const bytes = exports.makeUnitPaperDocx(paper);
assert.equal(new DataView(bytes.buffer).getUint32(0, true), 0x04034b50);
assert(!/[\\/:*?"<>|\u0000-\u001f]/.test(exports.unitPaperDocxFilename(paper)));
const dir = mkdtempSync(join(tmpdir(), "shiti-unit-"));
const path = join(dir, "unit.docx");
try {
  writeFileSync(path, bytes);
  const python = String.raw`
import sys, zipfile, xml.etree.ElementTree as ET
ns = {'w': 'http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'm': 'http://schemas.openxmlformats.org/officeDocument/2006/math'}
with zipfile.ZipFile(sys.argv[1]) as z:
    assert z.testzip() is None
    for name in z.namelist(): ET.fromstring(z.read(name))
    doc = ET.fromstring(z.read('word/document.xml'))
    text = '\n'.join(n.text or '' for n in doc.findall('.//w:t', ns))
    assert '数/学 · 一元一次方程 & <应用>单元练习卷' in text
    assert '计算 ' in text and '根号 9 等于 3' in text
    assert len(doc.findall('.//m:rad', ns)) >= 1
    assert len(doc.findall('.//m:f', ns)) >= 3
    assert ''.join(n.text or '' for n in doc.findall('.//m:num//m:t', ns)).count('1') >= 1
    assert '3 < 5 & 8 > 2' in text and '\x00' not in text
    assert len(doc.findall('.//w:br[@w:type="page"]', ns)) == 1
    assert len(doc.findall('.//w:pBdr', ns)) == 6
    assert len(doc.findall('.//w:tbl', ns)) == 1
    assert 'B. 正确选项' in text and '根据表格' in text
    assert doc.find('.//w:pgSz', ns).get('{'+ns['w']+'}w') == '11906'
print('PASS: unit Word ZIP, XML, answer page, writing space, A4 and escaping.')
`;
  const result = spawnSync(process.platform === "win32" ? "python" : "python3", ["-c", python, path], { encoding: "utf8", windowsHide: true });
  if (result.error?.code === "EPERM") {
    // Restricted Windows sandboxes deny child processes; inspect the stored OOXML directly.
    const document = storedZipEntry(bytes, "word/document.xml");
    assert(document.includes("数/学 · 一元一次方程 &amp; &lt;应用&gt;单元练习卷"));
    assert(document.includes("B. 正确选项") && document.includes("根据表格"));
    assert.equal((document.match(/<w:tbl>/g) || []).length, 1);
    assert.equal((document.match(/<w:pBdr>/g) || []).length, 6);
    assert((document.match(/<m:rad>/g) || []).length >= 1);
    assert((document.match(/<m:f>/g) || []).length >= 3);
    assert.equal((document.match(/<w:br w:type="page"\/>/g) || []).length, 1);
    console.log("PASS: unit Word stored ZIP, math, options, data table and answer page (XML parser unavailable in sandbox).");
  } else {
    if (result.status !== 0) throw new Error(result.stderr || result.error?.message || "Word validation failed");
    console.log(result.stdout.trim());
  }
} finally {
  rmSync(path, { force: true });
  rmdirSync(dir);
}
