import { stat } from "node:fs/promises";
import { nativeImage } from "electron";
import type { ClipboardFileEntry } from "../src/shared/contracts";
import { FileStore, type StoredFileEntry } from "./file-store";
import { decodeImageBuffer, type DecodedImage } from "./image-codec";
import { FILE_OPERATION_TIMEOUT_MS, readImageFile } from "./image-limits";
import { withTimeout } from "./async-timeout";

type ImagePreview = NonNullable<ClipboardFileEntry["image"]>;
const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "webp", "gif", "bmp", "tif", "tiff", "heic", "heif", "avif"]);

/** Resolve existing file-history IDs, never renderer-supplied filesystem paths. */
export class FileImages {
  private previews = new Map<string, { key: string; pending: Promise<ImagePreview | null> }>();

  constructor(private readonly files: FileStore) {}

  private isCandidate(entry: StoredFileEntry | ClipboardFileEntry): boolean {
    return entry.files.length === 1 && !entry.files[0].isDirectory && IMAGE_EXTENSIONS.has(entry.files[0].extension.toLowerCase());
  }

  private async decode(path: string): Promise<DecodedImage | null> {
    try { return await decodeImageBuffer(await readImageFile(path)); }
    catch { return null; } // Invalid, oversized or unavailable files remain ordinary references.
  }

  async read(id: string): Promise<DecodedImage | null> {
    const entry = await this.files.get(id);
    if (!entry || !this.isCandidate(entry)) return null;
    const paths = await this.files.resolvePaths(id);
    return paths ? this.decode(paths[0]) : null;
  }

  async preview(entry: ClipboardFileEntry): Promise<ImagePreview | null> {
    if (!entry.available || !this.isCandidate(entry)) { this.previews.delete(entry.id); return null; }
    const paths = await this.files.resolvePaths(entry.id);
    if (!paths) { this.previews.delete(entry.id); return null; }
    try {
      const info = await withTimeout(stat(paths[0]), FILE_OPERATION_TIMEOUT_MS, "File image preview timed out");
      const key = JSON.stringify([paths[0], info.size, info.mtimeMs, info.ctimeMs]);
      const cached = this.previews.get(entry.id);
      if (cached?.key === key) return cached.pending;
      const pending = this.decode(paths[0]).then(decoded => {
        if (!decoded) return null;
        const scale = Math.min(1, 96 / decoded.width, 96 / decoded.height);
        const previewDataUrl = nativeImage.createFromBuffer(decoded.buffer).resize({
          width: Math.max(1, Math.round(decoded.width * scale)),
          height: Math.max(1, Math.round(decoded.height * scale)), quality: "best"
        }).toDataURL();
        return { width: decoded.width, height: decoded.height, previewDataUrl };
      });
      this.previews.set(entry.id, { key, pending });
      return pending;
    } catch { this.previews.delete(entry.id); return null; }
  }

  prune(ids: Set<string>): void {
    for (const id of this.previews.keys()) if (!ids.has(id)) this.previews.delete(id);
  }
}
