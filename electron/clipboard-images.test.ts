import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, it } from "node:test";
import { MAX_CLIPBOARD_IMAGE_BYTES, readImageItems, type ImageClipboardItem } from "./clipboard-images";

const decode = async (source: Buffer) => source.toString() === "valid"
  ? { buffer: source, width: 3, height: 2 } : null;
function item(values: Record<string, Blob | Error>): ImageClipboardItem {
  return { types: Object.keys(values), async getType(type) {
    const value = values[type];
    if (value instanceof Error) throw value;
    return value;
  } };
}

describe("clipboard image representations", () => {
  it("tries another representation when the first is unavailable or damaged", async () => {
    for (const failure of [new Error("unavailable"), new Blob(["invalid"])]) {
      const result = await readImageItems([item({ "image/png": failure, "image/tiff": new Blob(["valid"]) })], "", decode);
      assert.equal(result?.width, 3);
    }
  });
  it("recognizes native macOS TIFF types wrapped by Electron 44", async () => {
    const result = await readImageItems([item({ 'electron application/osclipboard;format="public.tiff"': new Blob(["valid"]) })], "", decode);
    assert.equal(result?.height, 2);
  });
  it("prefers PNG and suppresses repeated decoding of an unchanged image", async () => {
    const hash = createHash("sha256").update("valid").digest("hex");
    const result = await readImageItems([item({ "image/tiff": new Blob(["invalid"]), "image/png": new Blob(["valid"]) })], hash, async () => { throw new Error("must not decode twice"); });
    assert.deepEqual(result, { hash });
  });
  it("skips oversized representations while preserving a usable alternative", async () => {
    const oversized: ImageClipboardItem = { types: ["image/png", "image/jpeg"], async getType(type) {
      return type === "image/png" ? { size: MAX_CLIPBOARD_IMAGE_BYTES + 1, arrayBuffer() { throw new Error("must not allocate"); } } : new Blob(["valid"]);
    } };
    assert.equal((await readImageItems([oversized], "", decode))?.width, 3);
  });
  it("reports invalid images instead of silently treating them as empty clipboard", async () => {
    await assert.rejects(readImageItems([item({ "image/png": new Blob(["invalid"]) })], "", decode), /无法读取剪贴板图片/);
    assert.equal(await readImageItems([item({ "text/plain": new Blob(["hello"]) })], "", decode), null);
  });
  it("accepts a large TIFF representation when its normalized PNG stays within the limit", async () => {
    const large = new Blob([new Uint8Array(MAX_CLIPBOARD_IMAGE_BYTES + 1)]);
    const result = await readImageItems([item({ "image/tiff": large })], "", async (source) => {
      assert.equal(source.length, MAX_CLIPBOARD_IMAGE_BYTES + 1);
      return { buffer: Buffer.from("small-png"), width: 3840, height: 2160 };
    });
    assert.equal(result?.width, 3840);
    await assert.rejects(readImageItems([item({ "image/png": new Blob(["valid"]) })], "", async () => ({ buffer: Buffer.alloc(MAX_CLIPBOARD_IMAGE_BYTES + 1), width: 3840, height: 2160 })), /保存上限 25 MB/);
  });
  it("imports copied local image files without reading network URIs or non-images", async () => {
    const directory = await mkdtemp(join(tmpdir(), "gpaster-file-copy-"));
    try {
      const path = join(directory, "image with spaces.png");
      await writeFile(path, "valid");
      const files = ["# comment", "https://example.com/image.png", pathToFileURL(join(directory, "private.txt")).href, pathToFileURL(path).href].join("\r\n");
      assert.equal((await readImageItems([item({ "text/uri-list": new Blob([files]) })], "", decode))?.width, 3);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
});
