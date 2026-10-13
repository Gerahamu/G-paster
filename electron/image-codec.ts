import { nativeImage } from "electron";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { readImageHeader } from "./image-header";
import { MAX_IMAGE_BYTES, MAX_IMAGE_SOURCE_BYTES, ImageSizeError, checkImageDimensions, imageSizeError, readImageFile } from "./image-limits";

const runFile = promisify(execFile);

export interface DecodedImage {
  buffer: Buffer;
  width: number;
  height: number;
}

/** Keep the stored format portable; macOS pasteboards commonly contain TIFF. */
export async function decodeImageBuffer(source: Buffer): Promise<DecodedImage | null> {
  if (!source.length) return null;
  if (source.length > MAX_IMAGE_SOURCE_BYTES) throw imageSizeError();
  const header = readImageHeader(source);
  if (header) {
    try { checkImageDimensions(header.width, header.height); }
    catch (error) { if (error instanceof ImageSizeError) throw error; return null; }
  }
  // Unknown containers are inspected by macOS before any full bitmap allocation.
  let image = header && (header.orientation === 1 || process.platform !== "darwin") ? nativeImage.createFromBuffer(source) : nativeImage.createEmpty();
  if (image.isEmpty() && process.platform === "darwin") {
    const directory = await mkdtemp(join(tmpdir(), "gpaster-image-"));
    try {
      const input = join(directory, "source");
      const output = join(directory, "image.png");
      await writeFile(input, source, { mode: 0o600 });
      const options = { timeout: 10_000, maxBuffer: 1024 * 1024 };
      if (!header) {
        const { stdout } = await runFile("/usr/bin/sips", ["-g", "pixelWidth", "-g", "pixelHeight", input], options);
        checkImageDimensions(Number(/pixelWidth:\s*(\d+)/.exec(stdout)?.[1]), Number(/pixelHeight:\s*(\d+)/.exec(stdout)?.[1]));
      }
      const orientation = header?.orientation ?? 1;
      const transform: Record<number, string[]> = {
        2: ["--flip", "horizontal"], 3: ["--rotate", "180"], 4: ["--flip", "vertical"],
        // sips applies flips before rotation, regardless of argument order.
        5: ["--rotate", "90", "--flip", "vertical"], 6: ["--rotate", "90"],
        7: ["--rotate", "90", "--flip", "horizontal"], 8: ["--rotate", "270"]
      };
      // sips ships with macOS; execFile avoids executing clipboard data in a shell.
      await runFile("/usr/bin/sips", [...(transform[orientation] ?? []), "-s", "format", "png", input, "--out", output], options);
      image = nativeImage.createFromBuffer(await readImageFile(output, MAX_IMAGE_BYTES));
    } catch (error) {
      if (error instanceof ImageSizeError) throw error;
      return null;
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
  if (image.isEmpty()) return null;
  const { width, height } = image.getSize();
  if (width <= 0 || height <= 0) return null;
  checkImageDimensions(width, height);
  const buffer = image.toPNG();
  if (!buffer.length) return null;
  if (buffer.length > MAX_IMAGE_BYTES) throw imageSizeError();
  return { buffer, width, height };
}
