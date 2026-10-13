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
    for (const [format, mime] of [["tiff", "image/tiff"], ["heic", "image/heic"], ["bmp", "image/bmp"], ["gif", "image/gif"], ["jp2", "image/jp2"]]) {
      const path = join(directory, `fixture.${format}`);
      await promisify(execFile)("/usr/bin/sips", ["-s", "format", format, pngPath, "--out", path]);
      formats[mime] = await readFile(path);
    }
  }
  for (const type of ['electron application/osclipboard;format="NeXT TIFF v4.0 pasteboard type"', 'electron application/osclipboard;format="Apple JPEG pasteboard type"']) {
    const bytes = type.includes('TIFF') ? formats['image/tiff'] : formats['image/jpeg'];
    if (!bytes) continue;
    const result = await readImageItems([{types:['image/png',type],getType:async key => new Blob([key === 'image/png' ? new Uint8Array() : new Uint8Array(bytes)])}], '', decodeImageBuffer);
    assert.equal(result?.width, 16);
    console.log(`PASS unreadable PNG falls back to actual Apple ${type.includes('TIFF') ? 'TIFF' : 'JPEG'} bytes`);
  }
  const nativeReference = 'electron application/osclipboard;format="public.file-url"';
  assert.ok((await readImageItems([{types:[nativeReference],getType:async () => new Blob([pathToFileURL(pngPath).href])}], '', decodeImageBuffer))?.buffer);
  console.log('PASS native Apple file URL fallback → bounded file read → real PNG decode');
  // All eight EXIF directions, including mirrored camera images, must survive normalization.
  if (process.platform === 'darwin') {
    const cameraPixels = Buffer.alloc(8 * 5 * 4);
    for (let y=0;y<5;y++) for(let x=0;x<8;x++) {
      const offset=(y*8+x)*4;
      cameraPixels[offset]=x*25; cameraPixels[offset+1]=y*45; cameraPixels[offset+2]=x*10+y*5; cameraPixels[offset+3]=255;
    }
    const jpeg = nativeImage.createFromBitmap(cameraPixels,{width:8,height:5}).toJPEG(100);
    const reference = nativeImage.createFromBuffer(jpeg).toBitmap();
    for (let orientation=1;orientation<=8;orientation++) {
      const exif=Buffer.alloc(32); exif.write('Exif\0\0',0,'ascii'); exif.write('II',6,'ascii'); exif.writeUInt16LE(42,8); exif.writeUInt32LE(8,10); exif.writeUInt16LE(1,14);
      exif.writeUInt16LE(0x112,16);exif.writeUInt16LE(3,18);exif.writeUInt32LE(1,20);exif.writeUInt16LE(orientation,24);
      const segment=Buffer.alloc(4); segment[0]=255;segment[1]=225;segment.writeUInt16BE(exif.length+2,2);
      const result=await decodeImageBuffer(Buffer.concat([jpeg.subarray(0,2),segment,exif,jpeg.subarray(2)]));
      const width=orientation>=5?5:8, height=orientation>=5?8:5;
      assert.equal(result?.width,width,`orientation ${orientation} width`); assert.equal(result?.height,height,`orientation ${orientation} height`);
      const bitmap=nativeImage.createFromBuffer(result.buffer).toBitmap();
      for(let y=0;y<height;y++) for(let x=0;x<width;x++) {
        const [sx,sy] = {1:[x,y],2:[7-x,y],3:[7-x,4-y],4:[x,4-y],5:[y,x],6:[y,4-x],7:[7-y,4-x],8:[7-y,x]}[orientation];
        for(let channel=0;channel<3;channel++) assert.ok(Math.abs(bitmap[(y*width+x)*4+channel]-reference[(sy*8+sx)*4+channel])<15,`orientation ${orientation} pixel ${x},${y} channel ${channel}`);
      }
    }
    console.log('PASS all 8 JPEG EXIF orientations, including mirrored photos, preserve visible pixels');
  }
  const bomb=Buffer.alloc(24); Buffer.from([137,80,78,71,13,10,26,10]).copy(bomb); bomb.write('IHDR',12);bomb.writeUInt32BE(100000,16);bomb.writeUInt32BE(100000,20);
  await assert.rejects(decodeImageBuffer(bomb),/5000 万像素/);
  console.log('PASS huge PNG header rejected before native bitmap allocation');
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
