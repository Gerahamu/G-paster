import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, rm, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, it } from "node:test";
import { MAX_CLIPBOARD_IMAGE_BYTES, readClipboardImages, readImageItems, type ImageClipboardItem } from "./clipboard-images";
import { ImageSizeError, MAX_IMAGE_SOURCE_BYTES, checkImageDimensions, readImageFile } from "./image-limits";
import { readImageHeader } from "./image-header";

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
  it("accepts legacy Apple image names, native wrappers and MIME parameters", async () => {
    for (const type of ["NeXT TIFF v4.0 pasteboard type", "Apple PNG pasteboard type", "Apple JPEG pasteboard type", "public.jpeg", "public.heic", "com.compuserve.gif", "org.webmproject.webp", "public.avif", "public.jpeg-2000", "IMAGE/PNG; charset=binary"]) {
      for (const format of [type, `electron application/osclipboard;format="${type}"`]) {
        assert.equal((await readImageItems([item({ [format]: new Blob(["valid"]) })], "", decode))?.width, 3, format);
      }
    }
  });
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
  it("uses native file URLs when bitmap providers fail and preserves encoded filenames", async () => {
    const directory = await mkdtemp(join(tmpdir(), "gpaster-native-file-"));
    try {
      const path = join(directory, "照片 # 空格.HEIC");
      await writeFile(path, "valid");
      for (const type of ["public.file-url", 'electron application/osclipboard;format="public.file-url"', "Apple URL pasteboard type"]) {
        const result = await readImageItems([item({ "image/png": new Blob([]), [type]: new Blob([pathToFileURL(path).href + "\0"]) })], "", decode);
        assert.equal(result?.width, 3);
      }
      await assert.rejects(readImageItems([item({ "text/uri-list": new Blob([pathToFileURL(join(directory, "missing.png")).href]) })], "", decode), /无法读取/);
      assert.equal(await readImageItems([item({ "public.file-url": new Blob(["file://remote-host/photos/x.png\nhttps://example.com/x.png"]) })], "", decode), null);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
  it("does not let an unavailable lazy provider permanently block image capture", async () => {
    const lazy: ImageClipboardItem = { types: ["image/png", "image/tiff"], getType: type => type === "image/png" ? new Promise(() => {}) : Promise.resolve(new Blob(["valid"])) };
    assert.equal((await readImageItems([lazy], "", decode))?.height, 2);
  });
  it("releases a stalled clipboard enumeration so the next clipboard can recover", async () => {
    await assert.rejects(readClipboardImages(() => new Promise(() => {}), "", decode), /timed out/);
    assert.equal((await readClipboardImages(async () => [item({ "image/png": new Blob(["valid"]) })], "", decode))?.width, 3);
  });
  it("survives corrupt, empty and throwing representations and continues to other items", async () => {
    const result = await readImageItems([item({ "image/png": new Blob(["bad"]) }), item({ "image/tiff": new Blob([]) }), item({ "image/jpeg": new Blob(["valid"]) })], "", async source => {
      if (source.toString() === "bad") throw new Error("codec failure");
      return decode(source);
    });
    assert.equal(result?.width, 3);
  });
  it("reports unsafe pixel counts but still accepts an alternative representation", async () => {
    const unsafe = async () => ({ buffer: Buffer.from("png"), width: 100000, height: 100000 });
    await assert.rejects(readImageItems([item({ "image/png": new Blob(["huge"]) })], "", unsafe), /5000 万像素/);
    const result = await readImageItems([item({ "image/png": new Blob(["huge"]), "image/jpeg": new Blob(["valid"]) })], "", async source => source.toString() === "huge" ? unsafe() : decode(source));
    assert.equal(result?.width, 3);
  });
  it("bounds file reads before allocation and rejects non-regular image paths", async () => {
    const directory = await mkdtemp(join(tmpdir(), "gpaster-file-limits-"));
    try {
      const path = join(directory, "huge.tiff");
      await writeFile(path, "");
      await truncate(path, MAX_IMAGE_SOURCE_BYTES + 1);
      await assert.rejects(readImageFile(path), ImageSizeError);
      await mkdir(join(directory, "folder.png"));
      await assert.rejects(readImageFile(join(directory, "folder.png")), /regular file/);
      await writeFile(path, "valid");
      assert.equal((await readImageFile(path)).toString(), "valid");
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
});

describe("image preflight", () => {
  it("reads TIFF dimensions and camera orientation without decoding the bitmap", () => {
    const tiff = Buffer.alloc(50);
    tiff.write("II", 0); tiff.writeUInt16LE(42,2); tiff.writeUInt32LE(8,4); tiff.writeUInt16LE(3,8);
    for (const [index,tag,value] of [[0,0x100,8000],[1,0x101,6000],[2,0x112,6]]) {
      const offset=10+index*12; tiff.writeUInt16LE(tag,offset);tiff.writeUInt16LE(3,offset+2);tiff.writeUInt32LE(1,offset+4);tiff.writeUInt16LE(value,offset+8);
    }
    assert.deepEqual(readImageHeader(tiff), {width:8000,height:6000,orientation:6});
    tiff.writeUInt32LE(0xffffffff,4);
    assert.equal(readImageHeader(tiff),null);
  });
  it("detects PNG decompression bombs from their header before bitmap allocation", () => {
    const png = Buffer.alloc(24);
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(png);
    png.write("IHDR", 12); png.writeUInt32BE(100000, 16); png.writeUInt32BE(100000, 20);
    const header = readImageHeader(png);
    assert.ok(header);
    assert.throws(() => checkImageDimensions(header.width, header.height), ImageSizeError);
    checkImageDimensions(8000, 6000);
    assert.throws(() => checkImageDimensions(0, 10));
  });
  it("does not throw on truncated or malformed image headers", () => {
    for (let length = 0; length < 40; length++) assert.equal(readImageHeader(Buffer.alloc(length, 255)), null);
    assert.equal(readImageHeader(Buffer.from([255,216,255,225,255,255])), null);
  });
});
