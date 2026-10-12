import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { extname } from "node:path";
import { fileURLToPath } from "node:url";
import type { DecodedImage } from "./image-codec";

export const MAX_CLIPBOARD_IMAGE_BYTES = 25 * 1024 * 1024;
export const MAX_CLIPBOARD_BITMAP_BYTES = 100 * 1024 * 1024;
const IMAGE_TYPES = ["image/png", "image/jpeg", "image/tiff", "image/bmp", "image/heic", "image/heif", "image/webp"];
const NATIVE_TYPES: Record<string, string> = {
  "public.png": "image/png", "public.jpeg": "image/jpeg", "public.tiff": "image/tiff",
  "public.bmp": "image/bmp", "com.microsoft.bmp": "image/bmp", "public.heic": "image/heic", "public.heif": "image/heif",
  "nstiffpboardtype": "image/tiff", "image/x-tiff": "image/tiff", "image/x-ms-bmp": "image/bmp", "image/jpg": "image/jpeg"
};
const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".tif", ".tiff", ".bmp", ".heic", ".heif", ".webp"]);

export interface ImageClipboardItem {
  types: string[];
  getType(type: string): Promise<unknown>;
}
export interface ClipboardImageResult {
  hash: string;
  buffer?: Buffer;
  width?: number;
  height?: number;
}

function canonicalImageType(type: string): string {
  const raw = /^electron application\/osclipboard;format="([^"]+)"$/i.exec(type)?.[1] ?? type;
  return NATIVE_TYPES[raw.toLowerCase()] ?? raw.toLowerCase();
}

function isBlob(value: unknown): value is Blob {
  return !!value && typeof value === "object" &&
    typeof (value as Blob).size === "number" && typeof (value as Blob).arrayBuffer === "function";
}

function sourceLimit(type: string): number {
  // A normal 4K TIFF can exceed 25 MB before conversion to a much smaller PNG.
  return type === "image/tiff" || type === "image/bmp" ? MAX_CLIPBOARD_BITMAP_BYTES : MAX_CLIPBOARD_IMAGE_BYTES;
}

/** Try all representations before rejecting an image, rather than just the first. */
export async function readImageItems(
  items: ImageClipboardItem[], previousHash: string,
  decode: (source: Buffer) => Promise<DecodedImage | null>
): Promise<ClipboardImageResult | null> {
  let sawImage = false;
  let oversized = false;
  async function decodeSource(source: Buffer, limit: number): Promise<ClipboardImageResult | null> {
    if (source.byteLength > limit) { oversized = true; return null; }
    const hash = createHash("sha256").update(source).digest("hex");
    if (hash === previousHash) return { hash };
    const image = await decode(source);
    if (image && image.buffer.byteLength > MAX_CLIPBOARD_IMAGE_BYTES) { oversized = true; return null; }
    return image ? { ...image, hash } : null;
  }
  for (const item of items) {
    const types = item.types.filter((type) => IMAGE_TYPES.includes(canonicalImageType(type)))
      .sort((a, b) => IMAGE_TYPES.indexOf(canonicalImageType(a)) - IMAGE_TYPES.indexOf(canonicalImageType(b)));
    for (const type of types) {
      sawImage = true;
      try {
        const blob = await item.getType(type);
        if (!isBlob(blob)) continue;
        const limit = sourceLimit(canonicalImageType(type));
        if (blob.size > limit) { oversized = true; continue; }
        const result = await decodeSource(Buffer.from(await blob.arrayBuffer()), limit);
        if (result) return result;
      } catch { /* Another representation of the same image may still work. */ }
    }
    // Finder's Copy puts file references on the pasteboard, not image bytes.
    if (item.types.includes("text/uri-list")) {
      let blob: unknown;
      try { blob = await item.getType("text/uri-list"); } catch { continue; }
      if (!isBlob(blob) || blob.size > 64 * 1024) continue;
      const uris = Buffer.from(await blob.arrayBuffer()).toString("utf8").split(/\r?\n/);
      for (const uri of uris) {
        if (!uri || uri.startsWith("#")) continue;
        let filePath: string;
        try { filePath = fileURLToPath(uri); } catch { continue; }
        if (!IMAGE_EXTENSIONS.has(extname(filePath).toLowerCase())) continue;
        sawImage = true;
        try {
          const info = await stat(filePath);
          if (!info.isFile()) continue;
          const extension = extname(filePath).toLowerCase();
          const limit = sourceLimit(extension === ".tif" || extension === ".tiff" ? "image/tiff" : extension === ".bmp" ? "image/bmp" : "image/png");
          if (info.size > limit) { oversized = true; continue; }
          const result = await decodeSource(await readFile(filePath), limit);
          if (result) return result;
        } catch { /* Permission failures must not silently look like no image. */ }
      }
    }
  }
  if (sawImage) throw new Error(oversized
    ? "剪贴板图片体积过大或无法解码，请尝试较小的 PNG 图片（保存上限 25 MB）。"
    : "无法读取剪贴板图片，请检查图片格式及文件访问权限，再尝试重新复制。");
  return null;
}
