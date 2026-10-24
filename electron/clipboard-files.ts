import { createHash } from "node:crypto";
import { stat } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { ImageClipboardItem } from "./clipboard-images";
import { FILE_OPERATION_TIMEOUT_MS } from "./image-limits";
import { withTimeout } from "./async-timeout";

const MAX_REFERENCE_BYTES = 1024 * 1024;
export const MAX_FILE_REFERENCES = 1000;
export const NATIVE_FILE_URL = 'electron application/osclipboard;format="public.file-url"';
const FILE_TYPES = new Set(["text/uri-list", "public.file-url"]);

function platformType(type: string): string {
  return (/^electron application\/osclipboard;\s*format="([^"]+)"$/i.exec(type.trim())?.[1]
    ?? type.split(";", 1)[0]).trim().toLowerCase();
}

export function isFileClipboardType(type: string): boolean {
  return FILE_TYPES.has(platformType(type));
}

export function isNativeFileUrlType(type: string): boolean {
  return platformType(type) === "public.file-url";
}

export function fileReferenceKey(paths: readonly string[]): string {
  return createHash("sha256").update(JSON.stringify(paths)).digest("hex");
}

/** Keep path identity separate from image-content freshness for copied image files. */
export async function imageFileReferenceKey(path: string, referenceKey: string): Promise<string> {
  try {
    const info = await withTimeout(stat(path, { bigint: true }), FILE_OPERATION_TIMEOUT_MS, "Image file reference check timed out");
    if (!info.isFile()) return `${referenceKey}:unavailable`;
    return createHash("sha256").update([
      referenceKey, info.dev, info.ino, info.size, info.mtimeNs, info.ctimeNs
    ].join("\0")).digest("hex");
  } catch {
    return `${referenceKey}:unavailable`;
  }
}

export function fileUriList(paths: readonly string[]): string {
  if (!paths.length || paths.length > MAX_FILE_REFERENCES || paths.some(path => !isAbsolute(path) || path.includes("\0"))) {
    throw new Error("Invalid file references");
  }
  return paths.map(path => pathToFileURL(path).href).join("\r\n");
}

async function boundedPayload(operation: () => Promise<unknown>): Promise<Blob | null> {
  let timer: NodeJS.Timeout | undefined;
  try {
    const value = await Promise.race([operation(), new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("File pasteboard provider timed out")), 2000);
    })]);
    return value && typeof value === "object" && typeof (value as Blob).arrayBuffer === "function" &&
      typeof (value as Blob).size === "number" ? value as Blob : null;
  } finally { if (timer) clearTimeout(timer); }
}

/** Electron maps URI lists to NSPasteboard's native copied-file representation. */
export async function readFileItems(items: readonly ImageClipboardItem[]): Promise<{ paths: string[]; key: string } | null> {
  const paths: string[] = [];
  for (const item of items) {
    const types = item.types.filter(isFileClipboardType).sort((a, b) =>
      Number(platformType(b) === "text/uri-list") - Number(platformType(a) === "text/uri-list"));
    for (const type of types) {
      try {
        const blob = await boundedPayload(() => item.getType(type));
        if (!blob || blob.size > MAX_REFERENCE_BYTES) throw new Error("Invalid file reference payload");
        let timer: NodeJS.Timeout | undefined;
        let bytes: ArrayBuffer;
        try {
          bytes = await Promise.race([blob.arrayBuffer(), new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error("File URL read timed out")), 2000);
          })]);
        } finally { if (timer) clearTimeout(timer); }
        const current: string[] = [];
        for (const line of Buffer.from(bytes).toString("utf8").replace(/\0+$/, "").split(/\r?\n/)) {
          if (!line.trim() || line.startsWith("#")) continue;
          const url = new URL(line.trim());
          if (url.protocol !== "file:" || (url.hostname && url.hostname !== "localhost")) continue;
          const path = resolve(fileURLToPath(url));
          if (!isAbsolute(path) || path.includes("\0")) throw new Error("Invalid local file URL");
          current.push(path);
        }
        if (current.length) { paths.push(...current); break; }
      } catch {
        // A second native representation may still be usable.
        if (type === types[types.length - 1]) throw new Error("无法读取剪贴板文件引用，请重新复制文件。");
      }
    }
  }
  if (paths.length > MAX_FILE_REFERENCES) throw new Error("一次最多收集 1000 个文件或文件夹，请分批复制。");
  return paths.length ? { paths, key: fileReferenceKey(paths) } : null;
}
