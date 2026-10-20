import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync, rmSync, rmdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import vm from "node:vm";
import ts from "typescript";

const source = readFileSync(new URL("../lib/mistake-docx.ts", import.meta.url), "utf8");
const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const exports = {};
vm.runInNewContext(code, { exports, TextEncoder, Uint8Array, DataView, Date });
const paper = {
  subject: "数/学", unitName: "一元一次方程 & <应用>", gradeLevel: "七年级",
  questions: [
    { question: "求 x：2x + 3 = 9。", answer: "x = 3", explanation: "两边减 3，再除以 2。", knowledgePoint: "解一元一次方程" },
    { question: "判断 3 < 5 & 8 > 2。\u0000", answer: "都成立", explanation: "逐个比较。", knowledgePoint: "不等式" },
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
ns = {'w': 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'}
with zipfile.ZipFile(sys.argv[1]) as z:
    assert z.testzip() is None
    for name in z.namelist(): ET.fromstring(z.read(name))
    doc = ET.fromstring(z.read('word/document.xml'))
    text = '\n'.join(n.text or '' for n in doc.findall('.//w:t', ns))
    assert '数/学 · 一元一次方程 & <应用>单元练习卷' in text
    assert '2x + 3 = 9' in text and 'x = 3' in text
    assert '3 < 5 & 8 > 2' in text and '\x00' not in text
    assert len(doc.findall('.//w:br[@w:type="page"]', ns)) == 1
    assert len(doc.findall('.//w:pBdr', ns)) == 6
    assert doc.find('.//w:pgSz', ns).get('{'+ns['w']+'}w') == '11906'
print('PASS: unit Word ZIP, XML, answer page, writing space, A4 and escaping.')
`;
  const result = spawnSync(process.platform === "win32" ? "python" : "python3", ["-c", python, path], { encoding: "utf8", windowsHide: true });
  if (result.status !== 0) throw new Error(result.stderr || result.error?.message || "Word validation failed");
  console.log(result.stdout.trim());
} finally {
  rmSync(path, { force: true });
  rmdirSync(dir);
}
