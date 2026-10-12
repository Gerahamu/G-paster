import { nativeImage } from "electron";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const runFile = promisify(execFile);

export interface DecodedImage {
  buffer: Buffer;
  width: number;
  height: number;
}

/** Keep the stored format portable; macOS pasteboards commonly contain TIFF. */
export async function decodeImageBuffer(source: Buffer): Promise<DecodedImage | null> {
  let image = nativeImage.createFromBuffer(source);
  if (image.isEmpty() && process.platform === "darwin") {
    const directory = await mkdtemp(join(tmpdir(), "gpaster-image-"));
    try {
      const input = join(directory, "source");
      const output = join(directory, "image.png");
      await writeFile(input, source, { mode: 0o600 });
      // sips ships with macOS; execFile avoids executing clipboard data in a shell.
      await runFile("/usr/bin/sips", ["-s", "format", "png", input, "--out", output], {
        timeout: 10_000,
        maxBuffer: 1024 * 1024
      });
      image = nativeImage.createFromBuffer(await readFile(output));
    } catch {
      return null;
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
  if (image.isEmpty()) return null;
  const { width, height } = image.getSize();
  if (width <= 0 || height <= 0) return null;
  return { buffer: image.toPNG(), width, height };
}
