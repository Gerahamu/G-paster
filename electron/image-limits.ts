import { open } from "node:fs/promises";
import { withTimeout } from "./async-timeout";

export const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
export const MAX_IMAGE_SOURCE_BYTES = 100 * 1024 * 1024;
export const MAX_IMAGE_PIXELS = 50_000_000;
export const FILE_READ_TIMEOUT_MS = 10_000;
export const FILE_OPERATION_TIMEOUT_MS = 3_000;

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
export async function readImageFile(path: string, limit = MAX_IMAGE_SOURCE_BYTES, timeoutMs = FILE_READ_TIMEOUT_MS): Promise<Buffer> {
  const deadline = Date.now() + timeoutMs;
  const remaining = () => Math.max(1, deadline - Date.now());
  const timeoutMessage = "Image file read timed out";
  const openOperation = open(path, "r");
  let file: Awaited<ReturnType<typeof open>>;
  try {
    file = await withTimeout(openOperation, remaining(), timeoutMessage);
  } catch (error) {
    // If open resolves after the timeout, close the late handle so it does not
    // leak while the caller is already recovering.
    void openOperation.then(handle => handle.close().catch(() => undefined)).catch(() => undefined);
    throw error;
  }
  try {
    const info = await withTimeout(file.stat(), remaining(), timeoutMessage);
    if (!info.isFile()) throw new Error("Image reference is not a regular file");
    if (info.size > limit) throw imageSizeError();
    const buffer = Buffer.alloc(info.size + 1);
    let read = 0;
    while (read < buffer.length) {
      const { bytesRead } = await withTimeout(file.read(buffer, read, buffer.length - read, read), remaining(), timeoutMessage);
      if (!bytesRead) break;
      read += bytesRead;
    }
    const after = await withTimeout(file.stat(), remaining(), timeoutMessage);
    if (read !== info.size || after.size !== info.size || after.mtimeMs !== info.mtimeMs || after.ctimeMs !== info.ctimeMs) {
      throw new Error("Image file changed while reading; retry with the next snapshot");
    }
    return buffer.subarray(0, read);
  } finally {
    // A timed-out remote read may not settle promptly. Ask to close, but do
    // not let cleanup itself block the caller indefinitely.
    await withTimeout(file.close(), 1_000, "Image file close timed out").catch(() => undefined);
  }
}
