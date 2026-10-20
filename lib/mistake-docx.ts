/** Editable Word worksheet. Uses standard OOXML and an uncompressed ZIP, with no network or runtime dependencies. */
export type WorksheetMistake = {
  subject: string;
  question: string;
  incorrectAnswer: string;
  correctAnswer: string;
  reasoning: string;
  knowledgePoint: string;
  pageNumber: number;
  sourceName: string;
  createdAt: string;
  similarQuestions: { question: string; answer: string; explanation: string }[];
};

const encoder = new TextEncoder();
const escapeXml = (value: string) =>
  value
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/g, "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");

function paragraphs(value: string, style = "Normal"): string {
  return value
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map(
      (line) =>
        `<w:p><w:pPr><w:pStyle w:val="${style}"/></w:pPr><w:r><w:t xml:space="preserve">${escapeXml(line)}</w:t></w:r></w:p>`,
    )
    .join("");
}
function writingSpace(): string {
  return Array.from(
    { length: 3 },
    () =>
      '<w:p><w:pPr><w:spacing w:after="100" w:line="440" w:lineRule="auto"/><w:pBdr><w:bottom w:val="single" w:sz="4" w:color="D9D9D9"/></w:pBdr></w:pPr><w:r><w:t> </w:t></w:r></w:p>',
  ).join("");
}
const ns =
  'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const xml = (value: string) =>
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' + value;

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++)
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** ZIP store method keeps the generator small and is supported by Word/WPS. */
function zip(entries: [string, string][]): Uint8Array<ArrayBuffer> {
  const files: Uint8Array[] = [];
  const directory: Uint8Array[] = [];
  let offset = 0;
  let directorySize = 0;
  for (const [path, content] of entries) {
    const name = encoder.encode(path);
    const data = encoder.encode(content);
    const crc = crc32(data);
    const local = new Uint8Array(30 + name.length);
    const l = new DataView(local.buffer);
    l.setUint32(0, 0x04034b50, true);
    l.setUint16(4, 20, true);
    l.setUint16(6, 0x0800, true);
    l.setUint16(12, 33, true); // 1980-01-01, valid DOS date
    l.setUint32(14, crc, true);
    l.setUint32(18, data.length, true);
    l.setUint32(22, data.length, true);
    l.setUint16(26, name.length, true);
    local.set(name, 30);
    files.push(local, data);
    const central = new Uint8Array(46 + name.length);
    const c = new DataView(central.buffer);
    c.setUint32(0, 0x02014b50, true);
    c.setUint16(4, 20, true);
    c.setUint16(6, 20, true);
    c.setUint16(8, 0x0800, true);
    c.setUint16(14, 33, true);
    c.setUint32(16, crc, true);
    c.setUint32(20, data.length, true);
    c.setUint32(24, data.length, true);
    c.setUint16(28, name.length, true);
    c.setUint32(42, offset, true);
    central.set(name, 46);
    directory.push(central);
    directorySize += central.length;
    offset += local.length + data.length;
  }
  const end = new Uint8Array(22);
  const e = new DataView(end.buffer);
  e.setUint32(0, 0x06054b50, true);
  e.setUint16(8, entries.length, true);
  e.setUint16(10, entries.length, true);
  e.setUint32(12, directorySize, true);
  e.setUint32(16, offset, true);
  const result = new Uint8Array(offset + directorySize + end.length);
  let cursor = 0;
  for (const chunk of [...files, ...directory, end]) {
    result.set(chunk, cursor);
    cursor += chunk.length;
  }
  return result;
}

export function makeMistakeDocx(
  item: WorksheetMistake,
): Uint8Array<ArrayBuffer> {
  const parsedDate = new Date(item.createdAt);
  const recorded = Number.isNaN(parsedDate.getTime())
    ? ""
    : parsedDate.toLocaleDateString("zh-CN");
  const body = [
    paragraphs("错题练习单", "Title"),
    paragraphs(
      [item.subject, item.knowledgePoint, recorded].filter(Boolean).join(" · "),
      "Subtitle",
    ),
    paragraphs("姓名：________________    日期：________________", "Subtitle"),
    paragraphs("一、原题", "Heading1"),
    paragraphs(item.question),
    ...(item.sourceName
      ? [
          paragraphs(
            `来源：${item.sourceName} · 第 ${item.pageNumber} 页`,
            "Subtitle",
          ),
        ]
      : []),
    writingSpace(),
    ...(item.similarQuestions.length
      ? [
          paragraphs("二、举一反三", "Heading1"),
          ...item.similarQuestions.flatMap((similar, index) => [
            paragraphs(`练习 ${index + 1}`, "Heading2"),
            paragraphs(similar.question),
            writingSpace(),
          ]),
        ]
      : []),
    '<w:p><w:r><w:br w:type="page"/></w:r></w:p>',
    paragraphs("参考答案与解析", "Title"),
    paragraphs("完成练习后再核对答案。", "Subtitle"),
    paragraphs("原题解析", "Heading1"),
    paragraphs(`我的原答案：${item.incorrectAnswer || "未记录"}`),
    paragraphs(`正确答案：${item.correctAnswer}`),
    paragraphs(`解题思路：${item.reasoning || "未记录"}`),
    ...item.similarQuestions.flatMap((similar, index) => [
      paragraphs(`练习 ${index + 1}`, "Heading2"),
      paragraphs(`答案：${similar.answer}`),
      paragraphs(`解析：${similar.explanation || "未记录"}`),
    ]),
    '<w:sectPr><w:footerReference w:type="default" r:id="rIdFooter"/><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="567" w:footer="567"/><w:pgNumType w:start="1"/></w:sectPr>',
  ].join("");
  const styles = `<w:styles ${ns}>
    <w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="宋体"/><w:sz w:val="24"/><w:lang w:val="zh-CN" w:eastAsia="zh-CN"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="160" w:line="360" w:lineRule="auto"/><w:widowControl/></w:pPr></w:pPrDefault></w:docDefaults>
    <w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
    <w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="160" w:after="240"/></w:pPr><w:rPr><w:b/><w:sz w:val="40"/></w:rPr></w:style>
    <w:style w:type="paragraph" w:styleId="Subtitle"><w:name w:val="Subtitle"/><w:basedOn w:val="Normal"/><w:rPr><w:color w:val="666666"/><w:sz w:val="21"/></w:rPr></w:style>
    <w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:outlineLvl w:val="0"/><w:spacing w:before="280" w:after="180"/></w:pPr><w:rPr><w:b/><w:sz w:val="36"/></w:rPr></w:style>
    <w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:outlineLvl w:val="1"/><w:spacing w:before="180" w:after="120"/></w:pPr><w:rPr><w:b/><w:sz w:val="28"/></w:rPr></w:style>
    </w:styles>`;
  return zip([
    [
      "[Content_Types].xml",
      xml(
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/></Types>',
      ),
    ],
    [
      "_rels/.rels",
      xml(
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
      ),
    ],
    [
      "word/document.xml",
      xml(`<w:document ${ns}><w:body>${body}</w:body></w:document>`),
    ],
    ["word/styles.xml", xml(styles)],
    [
      "word/_rels/document.xml.rels",
      xml(
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rIdFooter" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/></Relationships>',
      ),
    ],
    [
      "word/footer1.xml",
      xml(
        `<w:ftr ${ns}><w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:sz w:val="18"/><w:color w:val="777777"/></w:rPr><w:t xml:space="preserve">拾题 · 第 </w:t></w:r><w:fldSimple w:instr="PAGE"><w:r><w:t>1</w:t></w:r></w:fldSimple><w:r><w:t xml:space="preserve"> 页</w:t></w:r></w:p></w:ftr>`,
      ),
    ],
  ]);
}

export function mistakeDocxFilename(item: WorksheetMistake): string {
  const title = ["拾题", item.subject, item.knowledgePoint || "错题练习"].join(
    "-",
  );
  return (
    title
      .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_")
      .slice(0, 90)
      .trim() + ".docx"
  );
}

export type UnitWorksheet = {
  subject: string;
  unitName: string;
  gradeLevel: string;
  questions: { question: string; answer: string; explanation: string; knowledgePoint: string }[];
};

/** A4 editable worksheet; answers start on a separate page. */
export function makeUnitPaperDocx(paper: UnitWorksheet): Uint8Array<ArrayBuffer> {
  const title = `${paper.subject} · ${paper.unitName}单元练习卷`;
  const body = [
    paragraphs(title, "Title"),
    paragraphs([paper.gradeLevel, `${paper.questions.length} 道题`].filter(Boolean).join(" · "), "Subtitle"),
    paragraphs("姓名：________________    日期：________________    得分：________", "Subtitle"),
    paragraphs("请独立完成练习，答案和解析在文档后半部分。", "Normal"),
    ...paper.questions.flatMap((item, index) => [
      paragraphs(`${index + 1}. ${item.question}`, "Question"),
      writingSpace(),
    ]),
    '<w:p><w:r><w:br w:type="page"/></w:r></w:p>',
    paragraphs("参考答案与解析", "Title"),
    ...paper.questions.flatMap((item, index) => [
      paragraphs(`${index + 1}. ${item.knowledgePoint}`, "Question"),
      paragraphs(`答案：${item.answer}`),
      paragraphs(`解析：${item.explanation}`),
    ]),
    '<w:sectPr><w:footerReference w:type="default" r:id="rIdFooter"/><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:header="567" w:footer="567"/></w:sectPr>',
  ].join("");
  const styles = `<w:styles ${ns}>
    <w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="宋体"/><w:sz w:val="24"/><w:lang w:val="zh-CN" w:eastAsia="zh-CN"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="160" w:line="360" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
    <w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
    <w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="160" w:after="240"/></w:pPr><w:rPr><w:b/><w:sz w:val="40"/></w:rPr></w:style>
    <w:style w:type="paragraph" w:styleId="Subtitle"><w:name w:val="Subtitle"/><w:basedOn w:val="Normal"/><w:rPr><w:color w:val="666666"/><w:sz w:val="21"/></w:rPr></w:style>
    <w:style w:type="paragraph" w:styleId="Question"><w:name w:val="Question"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="260" w:after="130"/></w:pPr><w:rPr><w:b/><w:sz w:val="27"/></w:rPr></w:style>
    </w:styles>`;
  return zip([
    ["[Content_Types].xml", xml('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/></Types>')],
    ["_rels/.rels", xml('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>')],
    ["word/document.xml", xml(`<w:document ${ns}><w:body>${body}</w:body></w:document>`)],
    ["word/styles.xml", xml(styles)],
    ["word/_rels/document.xml.rels", xml('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rIdFooter" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/></Relationships>')],
    ["word/footer1.xml", xml(`<w:ftr ${ns}><w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:t>拾题 · 第 </w:t></w:r><w:fldSimple w:instr="PAGE"><w:r><w:t>1</w:t></w:r></w:fldSimple><w:r><w:t> 页</w:t></w:r></w:p></w:ftr>`) ],
  ]);
}

export function unitPaperDocxFilename(paper: Pick<UnitWorksheet, "subject" | "unitName">): string {
  return `拾题-${paper.subject}-${paper.unitName}-单元练习卷`
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").slice(0, 90).trim() + ".docx";
}
