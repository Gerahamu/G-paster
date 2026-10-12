// Uses generated fixtures and an isolated store, never the user's clipboard or data.
const assert = require("node:assert/strict");
const { execFile } = require("node:child_process");
const { mkdtemp, readFile, rm, writeFile } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const { join, resolve } = require("node:path");
const { pathToFileURL } = require("node:url");
const { promisify } = require("node:util");
const { setTimeout: delay } = require("node:timers/promises");
const { app, ClipboardItem, nativeImage } = require("electron");

const root = process.argv[2] ? resolve(process.argv[2]) : resolve(__dirname, "..");
const { decodeImageBuffer } = require(join(root, "dist-electron/electron/image-codec.js"));
const { readImageItems } = require(join(root, "dist-electron/electron/clipboard-images.js"));
const { ImageStore } = require(join(root, "dist-electron/electron/image-store.js"));
const { ScreenshotMonitor } = require(join(root, "dist-electron/electron/screenshot-monitor.js"));
let directory;

app.setName("G-paster image regression");
app.whenReady().then(async () => {
  app.dock?.hide();
  directory = await mkdtemp(join(tmpdir(), "gpaster-runtime-images-"));
  const pixels = Buffer.alloc(16 * 10 * 4, 180);
  for (let i = 3; i < pixels.length; i += 4) pixels[i] = 255;
  const fixture = nativeImage.createFromBitmap(pixels, { width: 16, height: 10 });
  const png = fixture.toPNG();
  const pngPath = join(directory, "fixture.png");
  await writeFile(pngPath, png);
  const formats = { "image/png": png, "image/jpeg": fixture.toJPEG(90) };
  if (process.platform === "darwin") {
    for (const [format, mime] of [["tiff", "image/tiff"], ["heic", "image/heic"]]) {
      const path = join(directory, `fixture.${format}`);
      await promisify(execFile)("/usr/bin/sips", ["-s", "format", format, pngPath, "--out", path]);
      formats[mime] = await readFile(path);
    }
  }
  const store = new ImageStore(join(directory, "image-history.json"));
  for (const [type, bytes] of Object.entries(formats)) {
    const result = await readImageItems([new ClipboardItem({ [type]: new Blob([new Uint8Array(bytes)], { type }) })], "", decodeImageBuffer);
    assert.ok(result?.buffer, type);
    assert.equal(result.width, 16);
    assert.equal(result.height, 10);
    const entry = await store.record(result.buffer, result.width, result.height);
    const saved = await store.read(entry.id);
    assert.ok(saved);
    const preview = nativeImage.createFromBuffer(saved).resize({ width: 180, height: 110 });
    assert.equal(preview.isEmpty(), false);
    assert.ok(preview.toDataURL().startsWith("data:image/png;base64,"));
    console.log(`PASS ${type}: real Electron decode → PNG persistence → thumbnail`);
  }
  const copiedFile = await readImageItems([new ClipboardItem({ "text/uri-list": pathToFileURL(pngPath).href })], "", decodeImageBuffer);
  assert.ok(copiedFile?.buffer);
  console.log("PASS copied local image file representation");
  if (process.platform === "darwin") {
    // Preserve alpha so the generated TIFF actually carries four full channels.
    const largePixels = Buffer.alloc(3840 * 2160 * 4, 128);
    const largePng = nativeImage.createFromBitmap(largePixels, { width: 3840, height: 2160 }).toPNG();
    const input = join(directory, "4k.png"), output = join(directory, "4k.tiff");
    await writeFile(input, largePng);
    await promisify(execFile)("/usr/bin/sips", ["-s", "format", "tiff", input, "--out", output]);
    const largeTiff = await readFile(output);
    assert.ok(largeTiff.length > 25 * 1024 * 1024);
    const result = await readImageItems([new ClipboardItem({ "image/tiff": new Blob([new Uint8Array(largeTiff)]) })], "", decodeImageBuffer);
    assert.equal(result?.width, 3840);
    assert.ok(result.buffer.length < 25 * 1024 * 1024);
    console.log("PASS real 4K TIFF above 25 MB normalizes into an accepted PNG");
  }
  assert.equal(await decodeImageBuffer(Buffer.from("not an image")), null);
  const reloaded = new ImageStore(join(directory, "image-history.json"));
  for (const entry of await reloaded.list()) assert.ok(await reloaded.read(entry.id));
  console.log("PASS persisted images reload without corruption");
  for (let n = 0; n < 12; n++) {
    pixels[0] = n;
    const img = nativeImage.createFromBitmap(pixels, { width: 16, height: 10 });
    await store.record(img.toPNG(), 16, 10);
  }
  assert.equal((await store.list()).length, 10);
  console.log("PASS latest 10 real images retained");
  let imports = 0;
  const monitor = new ScreenshotMonitor([directory], async (path) => {
    const decoded = await decodeImageBuffer(await readFile(path));
    assert.ok(decoded);
    await store.record(decoded.buffer, decoded.width, decoded.height);
    imports++;
  });
  await monitor.scanNow();
  const screenshot = join(directory, "截屏2026-10-12.png");
  await writeFile(screenshot, png);
  await monitor.scanNow();
  await delay(650);
  await monitor.scanNow();
  assert.equal(imports, 1);
  assert.deepEqual(await readFile(screenshot), png);
  console.log("PASS Chinese screenshot collected; original file preserved");
}).finally(async () => {
  if (directory) await rm(directory, { recursive: true, force: true });
}).then(() => app.quit()).catch((error) => {
  console.error(error);
  app.exit(1);
});
