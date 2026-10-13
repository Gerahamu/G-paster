import { open } from "node:fs/promises";

export const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
export const MAX_IMAGE_SOURCE_BYTES = 100 * 1024 * 1024;
export const MAX_IMAGE_PIXELS = 50_000_000;

export class ImageSizeError extends Error {}

export function checkImageDimensions(width: number, height: number): void {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0) {
    throw new Error("Invalid image dimensions");
  }
  if (width * height > MAX_IMAGE_PIXELS) {
    throw new ImageSizeError("剪贴板图片像素过大（上限 5000 万像素），请缩小图片后重试。");
  }
}

export function imageSizeError(): ImageSizeError {
  return new ImageSizeError("剪贴板图片体积过大或无法解码，请尝试较小的 PNG 图片（保存上限 25 MB）。");
}

/** Bound reads before allocating, including files that grow or change during copy. */
export async function readImageFile(path: string, limit = MAX_IMAGE_SOURCE_BYTES): Promise<Buffer> {
  const file = await open(path, "r");
  try {
    const info = await file.stat();
    if (!info.isFile()) throw new Error("Image reference is not a regular file");
    if (info.size > limit) throw imageSizeError();
    const buffer = Buffer.alloc(info.size + 1);
    let read = 0;
    while (read < buffer.length) {
      const { bytesRead } = await file.read(buffer, read, buffer.length - read, read);
      if (!bytesRead) break;
      read += bytesRead;
    }
    const after = await file.stat();
    if (read !== info.size || after.size !== info.size || after.mtimeMs !== info.mtimeMs || after.ctimeMs !== info.ctimeMs) {
      throw new Error("Image file changed while reading; retry with the next snapshot");
    }
    return buffer.subarray(0, read);
  } finally { await file.close(); }
}
