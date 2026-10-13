import { createHash } from "node:crypto";
import { extname } from "node:path";
import { fileURLToPath } from "node:url";
import type { DecodedImage } from "./image-codec";
import { MAX_IMAGE_BYTES, MAX_IMAGE_SOURCE_BYTES, ImageSizeError, checkImageDimensions, imageSizeError, readImageFile } from "./image-limits";

export const MAX_CLIPBOARD_IMAGE_BYTES = MAX_IMAGE_BYTES;
export const MAX_CLIPBOARD_BITMAP_BYTES = MAX_IMAGE_SOURCE_BYTES;
const IMAGE_TYPES = ["image/png", "image/jpeg", "image/tiff", "image/bmp", "image/heic", "image/heif", "image/webp", "image/gif", "image/avif", "image/jp2"];
const NATIVE_TYPES: Record<string, string> = {
  "public.png": "image/png", "public.jpeg": "image/jpeg", "public.tiff": "image/tiff",
  "public.bmp": "image/bmp", "com.microsoft.bmp": "image/bmp", "public.heic": "image/heic", "public.heif": "image/heif",
  "nstiffpboardtype": "image/tiff", "next tiff v4.0 pasteboard type": "image/tiff",
  "apple png pasteboard type": "image/png", "apple jpeg pasteboard type": "image/jpeg",
  "public.gif": "image/gif", "com.compuserve.gif": "image/gif", "org.webmproject.webp": "image/webp",
  "public.avif": "image/avif", "public.jpeg-2000": "image/jp2",
  "image/x-tiff": "image/tiff", "image/x-ms-bmp": "image/bmp", "image/jpg": "image/jpeg",
  "public.file-url": "text/uri-list", "nsurlpboardtype": "text/uri-list", "apple url pasteboard type": "text/uri-list"
};
const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".tif", ".tiff", ".bmp", ".heic", ".heif", ".webp", ".gif", ".avif", ".jp2"]);
const PAYLOAD_TIMEOUT_MS = 2_000;

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
  const raw = /^electron application\/osclipboard;\s*format="([^"]+)"$/i.exec(type.trim())?.[1]
    ?? type.split(";", 1)[0];
  const normalized = raw.split(";", 1)[0].trim().toLowerCase();
  return NATIVE_TYPES[normalized] ?? normalized;
}

/** A lazy pasteboard provider must not leave image capture locked indefinitely. */
async function readPayload<T>(operation: () => Promise<T>): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([Promise.resolve().then(operation), new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("Image pasteboard provider timed out")), PAYLOAD_TIMEOUT_MS);
    })]);
  } finally { if (timer) clearTimeout(timer); }
}

export async function readClipboardImages(
  read: () => Promise<ImageClipboardItem[]>, previousHash: string,
  decode: (source: Buffer) => Promise<DecodedImage | null>
): Promise<ClipboardImageResult | null> {
  return readImageItems(await readPayload(read), previousHash, decode);
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
  let limitError: ImageSizeError | undefined;
  async function decodeSource(source: Buffer, limit: number): Promise<ClipboardImageResult | null> {
    if (!source.byteLength) return null;
    if (source.byteLength > limit) { limitError = imageSizeError(); return null; }
    const hash = createHash("sha256").update(source).digest("hex");
    if (hash === previousHash) return { hash };
    const image = await decode(source);
    if (image) checkImageDimensions(image.width, image.height);
    if (image && image.buffer.byteLength > MAX_CLIPBOARD_IMAGE_BYTES) { limitError = imageSizeError(); return null; }
    return image ? { ...image, hash } : null;
  }
  for (const item of items) {
    const types = item.types.filter((type) => IMAGE_TYPES.includes(canonicalImageType(type)))
      .sort((a, b) => IMAGE_TYPES.indexOf(canonicalImageType(a)) - IMAGE_TYPES.indexOf(canonicalImageType(b)));
    for (const type of types) {
      sawImage = true;
      try {
        const blob = await readPayload(() => item.getType(type));
        if (!isBlob(blob)) continue;
        const limit = sourceLimit(canonicalImageType(type));
        if (blob.size > limit) { limitError = imageSizeError(); continue; }
        const result = await decodeSource(Buffer.from(await readPayload(() => blob.arrayBuffer())), limit);
        if (result) return result;
      } catch (error) {
        if (error instanceof ImageSizeError) limitError = error;
        // Another representation of the same image may still work.
      }
    }
    // Finder's Copy puts file references on the pasteboard, not image bytes.
    for (const referenceType of item.types.filter(type => canonicalImageType(type) === "text/uri-list")) {
      let blob: unknown;
      try { blob = await readPayload(() => item.getType(referenceType)); } catch { continue; }
      if (!isBlob(blob) || blob.size > 64 * 1024) continue;
      let uris: string[];
      try { uris = Buffer.from(await readPayload(() => (blob as Blob).arrayBuffer())).toString("utf8").replace(/\0+$/, "").split(/\r?\n/); }
      catch { continue; }
      for (const uri of uris) {
        if (!uri || uri.startsWith("#")) continue;
        let filePath: string;
        try {
          const url = new URL(uri.trim());
          if (url.protocol !== "file:" || (url.hostname && url.hostname !== "localhost")) continue;
          filePath = fileURLToPath(url);
        } catch { continue; }
        if (!IMAGE_EXTENSIONS.has(extname(filePath).toLowerCase())) continue;
        sawImage = true;
        try {
          const extension = extname(filePath).toLowerCase();
          const limit = sourceLimit(extension === ".tif" || extension === ".tiff" ? "image/tiff" : extension === ".bmp" ? "image/bmp" : "image/png");
          const result = await decodeSource(await readImageFile(filePath, limit), limit);
          if (result) return result;
        } catch (error) {
          if (error instanceof ImageSizeError) limitError = error;
          // Permission failures must not silently look like no image.
        }
      }
    }
  }
  if (sawImage) throw limitError ?? new Error("无法读取剪贴板图片，请检查图片格式及文件访问权限，再尝试重新复制。");
  return null;
}
