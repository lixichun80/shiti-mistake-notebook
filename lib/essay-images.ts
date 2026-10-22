export type EssayImage = { bytes: Uint8Array; mime: string; base64: string };

export class EssayImageError extends Error {}

const allowedTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
const maxFileBytes = 8 * 1024 * 1024;

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 32768) binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
  return btoa(binary);
}

export async function readEssayImages(form: FormData): Promise<EssayImage[]> {
  const files = form.getAll("files").filter((item): item is File => item instanceof File);
  if (!files.length || files.length > 4) throw new EssayImageError("请选择 1 至 4 张作文或题目照片");
  if (files.some(file => !allowedTypes.has(file.type) || file.size === 0 || file.size > maxFileBytes)) {
    throw new EssayImageError("仅支持 JPG、PNG、WEBP，单张不超过 8MB");
  }
  return Promise.all(files.map(async file => {
    const bytes = new Uint8Array(await file.arrayBuffer());
    return { bytes, mime: file.type, base64: toBase64(bytes) };
  }));
}
