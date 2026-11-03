import { env } from "cloudflare:workers";
import type { WorksheetMistake } from "./mistake-docx";

export function isVisualQuestion(question: string): boolean {
  return /(?:如|见|下|右|左).{0,4}[图表]|图(?:形|像|象|表|示)|统计图|坐标系|作图/.test(question);
}

export function needsOriginalPicture(subject: string, question: string): boolean {
  return subject.includes("数学") || isVisualQuestion(question) || /计算|求值|化简|解方程/.test(question);
}

function imageDimensions(bytes: Uint8Array, mime: "image/jpeg" | "image/png"): { width: number; height: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (mime === "image/png") {
    if (bytes.length < 24 || view.getUint32(0) !== 0x89504e47) throw new Error("原题 PNG 图片损坏");
    return { width: view.getUint32(16), height: view.getUint32(20) };
  }
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) throw new Error("原题 JPEG 图片损坏");
  for (let offset = 2; offset + 9 < bytes.length;) {
    if (bytes[offset] !== 0xff) { offset++; continue; }
    const marker = bytes[offset + 1];
    if (marker === 0xff) { offset++; continue; }
    if (marker === 0xd9 || marker === 0xda) break;
    if (marker >= 0xd0 && marker <= 0xd7) { offset += 2; continue; }
    const length = view.getUint16(offset + 2);
    if (length < 2) break;
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
      return { height: view.getUint16(offset + 5), width: view.getUint16(offset + 7) };
    }
    offset += 2 + length;
  }
  throw new Error("无法读取原题 JPEG 图片尺寸");
}

/** Existing uploads retain whole-page images; include them rather than silently losing diagrams. */
export async function loadWordSourceImage(userId: string, uploadId: string, pageNumber: number): Promise<NonNullable<WorksheetMistake["sourceImage"]>> {
  if (!env.DB || !env.BUCKET) throw new Error("原图存储暂不可用");
  const upload = await env.DB.prepare("SELECT file_keys FROM uploads WHERE id = ? AND user_id = ?")
    .bind(uploadId, userId).first<{ file_keys: string }>();
  if (!upload) throw new Error("原题图片已不存在，无法导出完整试卷");
  const keys: unknown = JSON.parse(upload.file_keys);
  const key = Array.isArray(keys) ? keys[pageNumber - 1] : undefined;
  if (typeof key !== "string" || !key.startsWith(`${userId}/${uploadId}/`)) throw new Error("原题图片已不存在，无法导出完整试卷");
  const source = await env.BUCKET.get(key);
  if (!source) throw new Error("原题图片已不存在，无法导出完整试卷");
  const mime = source.httpMetadata?.contentType;
  if (mime !== "image/jpeg" && mime !== "image/png") throw new Error("原题图片为 WEBP，请使用页面上的生成 Word 按钮转换后下载");
  const bytes = new Uint8Array(await source.arrayBuffer());
  const { width, height } = imageDimensions(bytes, mime);
  if (!width || !height) throw new Error("原题图片尺寸无效");
  return { bytes, width, height, fullPage: true, mime };
}
