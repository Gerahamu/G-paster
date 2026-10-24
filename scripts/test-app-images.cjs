// Runs the real main process, preload and renderer with controlled clipboard input.
// It uses private temporary data and never reads/writes the user's clipboard.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { readFile, writeFile, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { app, BrowserWindow, clipboard, ClipboardItem, globalShortcut, nativeImage } = require('electron');
const root = process.env.GPASTER_TEST_APP_PATH || resolve(__dirname, '..');
const directory = fs.mkdtempSync(join(tmpdir(), 'gpaster-app-images-'));
const screenshots = join(directory, 'screenshots');
fs.mkdirSync(screenshots);
app.setPath('userData', join(directory, 'data'));
app.setPath('desktop', screenshots);
app.getAppPath = () => root;
BrowserWindow.prototype.show = function () {};
BrowserWindow.prototype.focus = function () {};
globalShortcut.register = () => true;
const childProcess = require('node:child_process');
const originalExecFileSync = childProcess.execFileSync;
childProcess.execFileSync = (file, args, options) => file === 'defaults' && args?.[1] === 'com.apple.screencapture'
  ? screenshots : originalExecFileSync(file, args, options);
let items = [], text = '';
clipboard.read = async () => items;
clipboard.has = async type => items.some(item => item.types.includes(type));
clipboard.readText = async () => text;
clipboard.write = async (next) => { items = next; text = ''; };
clipboard.writeText = async (next) => { text = next; items = []; };
app.whenReady().then(() => {
  const startup = nativeImage.createFromBitmap(Buffer.from([0,0,255,255,0,255,0,255]), {width:2,height:1}).toPNG();
  items = [new ClipboardItem({'image/png':new Blob([new Uint8Array(startup)])})];
});
let dragged;
require(join(root, 'dist-electron/electron/main.js'));

async function waitFor(check, label) {
  const deadline = Date.now() + 15000;
  let lastError;
  while (Date.now() < deadline) {
    try { if (await check()) return; } catch (error) { lastError = error; }
    await delay(100);
  }
  throw new Error(`Timeout: ${label}${lastError ? ` (${lastError.message})` : ''}`);
}
app.whenReady().then(async () => {
  app.dock?.hide();
  let window;
  await waitFor(async () => {
    window = BrowserWindow.getAllWindows()[0];
    return window && !window.webContents.isLoading() && await window.webContents.executeJavaScript('Boolean(window.gpaster && document.querySelector(".module-tabs"))');
  }, 'actual renderer and preload');
  const evaluate = (code) => window.webContents.executeJavaScript(code);
  window.webContents.startDrag = options => { dragged = options; };
  const { translate } = require(join(root, 'dist-electron/src/shared/i18n.js'));
  const list = () => evaluate('window.gpaster.listHistory()');
  await waitFor(async () => (await list()).some(entry => entry.kind === 'image' && entry.width === 2), 'clipboard image present at application startup');
  items = []; await evaluate('window.gpaster.clearHistory()');
  assert.equal((await list()).length, 0);
  console.log('PASS startup does not suppress the current clipboard image or wait for image decoding before opening');
  const pixels = Buffer.alloc(20 * 12 * 4, 120);
  for (let i = 3; i < pixels.length; i += 4) pixels[i] = 255;
  const png = nativeImage.createFromBitmap(pixels, { width: 20, height: 12 }).toPNG();
  const fixture = join(directory, 'fixture.png');
  const tiffFile = join(directory, 'fixture.tiff');
  await writeFile(fixture, png);
  await promisify(execFile)('/usr/bin/sips', ['-s', 'format', 'tiff', fixture, '--out', tiffFile]);
  const tiff = await readFile(tiffFile);
  const legacyTiff = 'electron application/osclipboard;format="NeXT TIFF v4.0 pasteboard type"';
  items = [{types:['image/png', legacyTiff],getType:async type => new Blob([type === 'image/png' ? new Uint8Array() : new Uint8Array(tiff)])}];
  await waitFor(async () => (await list()).some(entry => entry.kind === 'image'), 'TIFF automatic capture');
  const captured = (await list()).find(entry => entry.kind === 'image');
  assert.equal(captured.width, 20);
  assert.deepEqual(nativeImage.createFromDataURL(captured.previewDataUrl).getSize(), { width: 20, height: 12 });
  assert.deepEqual(captured.sources, ['clipboard']);
  await waitFor(() => evaluate('document.querySelectorAll(".history-thumb").length === 1 && document.querySelector(".module-tab .tab-count").textContent === "1"'), 'copied photo shown in clipboard');
  assert.equal(await evaluate('document.querySelectorAll(".module-tab .tab-count")[2].textContent'), '0');
  await evaluate('document.querySelectorAll(".module-tab")[2].click()');
  assert.equal(await evaluate('document.querySelectorAll(".image-card").length'), 0);
  await evaluate('document.querySelectorAll(".module-tab")[0].click()');
  const preview = await evaluate(`window.gpaster.previewImage(${JSON.stringify(captured.id)})`);
  assert.ok(preview.startsWith('data:image/png;base64,'));
  console.log('PASS unavailable PNG → Apple legacy TIFF fallback → PNG store → secure IPC → real renderer gallery thumbnail/preview');
  items = [];
  await evaluate('document.querySelector(".history-thumb-button").dispatchEvent(new MouseEvent("contextmenu", {bubbles:true,cancelable:true,button:2}))');
  await waitFor(() => evaluate('Boolean(document.querySelector(".image-dialog"))'), 'clipboard photo right-click details');
  assert.equal(items.length, 0);
  await evaluate('document.querySelector(".image-dialog .dialog-heading button").click()');
  let clipboardHideCalls = 0;
  const hideBeforeClipboardCopy = window.hide.bind(window);
  window.hide = () => { clipboardHideCalls++; hideBeforeClipboardCopy(); };
  await evaluate('document.querySelector(".history-thumb-button").click()');
  await waitFor(() => evaluate('Boolean(document.querySelector(".image-dialog"))'), 'clipboard thumbnail click opens preview');
  assert.equal(await evaluate('document.querySelector(".large-image-wrap img").src'), preview);
  assert.equal(clipboardHideCalls, 0);
  assert.equal(items.length, 0);
  await evaluate('document.querySelector(".image-dialog .dialog-heading button").click(); document.querySelector(".history-item .entry-content").click()');
  await waitFor(() => evaluate('Boolean(document.querySelector(".image-dialog"))'), 'clipboard image content click opens preview');
  assert.equal(await evaluate('document.querySelector(".large-image-wrap img").src'), preview);
  await evaluate('document.querySelector(".image-dialog .dialog-heading button").click()');
  for (const selector of ['.history-thumb-button', '.history-item .entry-content']) {
    dragged = undefined;
    await evaluate(`{
      const target = document.querySelector(${JSON.stringify(selector)});
      if (!target.draggable) throw new Error('Image target must be draggable');
      target.dispatchEvent(new PointerEvent('pointerdown', {bubbles:true}));
      target.dispatchEvent(new Event('dragstart', {bubbles:true,cancelable:true}));
      target.dispatchEvent(new MouseEvent('click', {bubbles:true,detail:1}));
    }`);
    await waitFor(() => dragged?.file, 'clipboard image native-file request');
    assert.equal(dragged.files, undefined, 'single image uses the original file payload');
    assert.deepEqual(await readFile(dragged.file), Buffer.from(preview.split(',')[1], 'base64'));
    assert.equal(await evaluate('Boolean(document.querySelector(".image-dialog"))'), false, 'drag cannot trigger preview');
    assert.equal(clipboardHideCalls, 0, 'drag cannot trigger copy/hide');
    assert.equal(items.length, 0);
  }
  assert.equal(await evaluate('document.querySelector(".history-thumb").draggable'), false);
  await evaluate('document.querySelector(".history-item .copy-button").click()');
  await waitFor(() => clipboardHideCalls > 0 && items.some(item => item.types.includes('image/png')), 'dedicated copy button writes image and hides');
  window.hide = hideBeforeClipboardCopy;
  assert.ok(items[0].types.includes('image/png'));
  const returned = await items[0].getType('image/png');
  assert.equal(nativeImage.createFromBuffer(Buffer.from(await returned.arrayBuffer())).isEmpty(), false);
  await delay(500);
  assert.equal((await list()).filter(e => e.kind === 'image').length, 1);
  console.log('PASS re-copy emits image payload and does not create duplicate history');
  pixels[0] = 55;
  const screenshotPng = nativeImage.createFromBitmap(pixels, { width: 20, height: 12 }).toPNG();
  const screenshot = join(screenshots, '截屏2026-10-12 20.30.00.png');
  await writeFile(screenshot, screenshotPng);
  await waitFor(async () => (await list()).filter(e => e.kind === 'image').length === 2, 'Chinese screenshot automatic import');
  assert.deepEqual(await readFile(screenshot), screenshotPng);
  await waitFor(() => evaluate('document.querySelector(".module-tab .tab-count").textContent === "1" && document.querySelectorAll(".history-item").length === 1'), 'directory screenshot excluded from clipboard tab');
  const importedScreenshot = (await list()).find(entry => entry.kind === 'image' && entry.id !== captured.id);
  assert.deepEqual(importedScreenshot.sources, ['screenshot']);
  assert.equal(await evaluate('document.querySelectorAll(".module-tab .tab-count")[2].textContent'), '1');
  await evaluate('document.querySelectorAll(".module-tab")[2].click()');
  await waitFor(() => evaluate('document.querySelectorAll(".image-card").length === 1'), 'screenshot pool footer');
  assert.match(await evaluate('document.querySelector(".screenshot-footer .toolbar-caption").textContent'), /图片池|image pool/);
  await evaluate('document.querySelectorAll(".module-tab")[0].click()');
  console.log('PASS copied photo stays in Clipboard; directory screenshot appears only in Screenshots; original file unchanged');
  items = [new ClipboardItem({ 'image/png': new Blob(['invalid image']) })];
  text = 'text still captured while an image fails';
  await waitFor(async () => (await list()).some(e => e.content === text), 'independent text capture');
  await waitFor(async () => (await evaluate('window.gpaster.listCaptureIssues()')).some(i => i.source === 'clipboard-image'), 'capture issue IPC');
  await waitFor(() => evaluate('document.querySelectorAll(".history-item").length === 2 && document.querySelector(".module-tab .tab-count").textContent === "2"'), 'mixed text and copied photo count excludes directory screenshot');
  const setQuery = query => evaluate(`{ const input = document.querySelector('.search-wrap input'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(query)}); input.dispatchEvent(new Event('input', { bubbles: true })); }`);
  await setQuery('20');
  await waitFor(() => evaluate('document.querySelectorAll(".history-item").length === 1 && document.querySelectorAll(".history-thumb").length === 1'), 'clipboard search returns copied photo only');
  await setQuery('');
  await waitFor(() => evaluate('document.querySelectorAll(".history-item").length === 2'), 'clipboard text and photo restored after search');
  const issue = (await evaluate('window.gpaster.listCaptureIssues()')).find(i => i.source === 'clipboard-image');
  const settings = await evaluate('window.gpaster.getSystemSettings()');
  const issueText = translate(settings.language, issue.message);
  await waitFor(() => evaluate(`Array.from(document.querySelectorAll("[role=status]")).some(e => e.textContent.includes(${JSON.stringify(issueText)}))`), 'localized capture issue UI');
  items = [new ClipboardItem({ 'image/png': new Blob([new Uint8Array(png)]) })]; text = '';
  await waitFor(async () => (await evaluate('window.gpaster.listCaptureIssues()')).length === 0, 'capture issue recovery');
  console.log('PASS failure visible in renderer, text unaffected, recovery clears status');
  pixels[0] = 66;
  await writeFile(fixture, nativeImage.createFromBitmap(pixels, {width:20,height:12}).toPNG());
  const nativeFileUrl = 'electron application/osclipboard;format="public.file-url"';
  const {pathToFileURL} = require('node:url');
  const beforeFile = new Set((await list()).map(entry => entry.id));
  items = [{types:[nativeFileUrl],getType:async () => new Blob([pathToFileURL(fixture).href])}];
  await waitFor(async () => (await list()).some(entry => entry.kind === 'file' && !beforeFile.has(entry.id)), 'native file URL recorded as file reference');
  assert.equal((await list()).some(entry => entry.kind === 'image' && !beforeFile.has(entry.id)), false);
  console.log('PASS native image file URL is a file reference, not a duplicate image capture');
  const secondPixels = Buffer.from(pixels); secondPixels[0] = 201;
  items = [new ClipboardItem({ 'image/png': new Blob([new Uint8Array(nativeImage.createFromBitmap(secondPixels, { width: 20, height: 12 }).toPNG())]) })];
  await waitFor(async () => (await list()).filter(entry => entry.kind === 'image' && entry.sources.includes('clipboard')).length === 2, 'second copied image captured');
  items = [];
  // Force the older preview to finish last: it must not replace the latest request.
  const { ImageStore } = require(join(root, 'dist-electron/electron/image-store.js'));
  const originalImageRead = ImageStore.prototype.read;
  let releasePreview, previewEntered = false;
  const previewGate = new Promise(resolveGate => { releasePreview = resolveGate; });
  ImageStore.prototype.read = async function (id) {
    if (id === captured.id) { previewEntered = true; await previewGate; }
    return originalImageRead.call(this, id);
  };
  try {
    await waitFor(() => evaluate('document.querySelectorAll("li[data-kind=image] .history-thumb-button").length === 2'), 'two clipboard preview targets');
    await evaluate('document.querySelectorAll("li[data-kind=image] .history-thumb-button")[1].click()');
    await waitFor(() => previewEntered, 'older preview read held');
    await evaluate('document.querySelectorAll("li[data-kind=image] .history-thumb-button")[0].click()');
    await waitFor(() => evaluate('Boolean(document.querySelector(".large-image-wrap img"))'), 'latest preview completes independently');
    const latestPreview = await evaluate('document.querySelector(".large-image-wrap img").src');
    assert.notEqual(latestPreview, preview);
    releasePreview();
    await delay(200);
    assert.equal(await evaluate('document.querySelector(".large-image-wrap img").src'), latestPreview);
    dragged = undefined;
    await evaluate('document.querySelector(".large-image-wrap").dispatchEvent(new Event("dragstart", {bubbles:true,cancelable:true}))');
    await waitFor(() => dragged?.file, 'preview exports its full image file');
    assert.deepEqual(await readFile(dragged.file), Buffer.from(latestPreview.split(',')[1], 'base64'));
    await evaluate('document.querySelector(".image-dialog .dialog-heading button").click()');
  } finally {
    releasePreview();
    ImageStore.prototype.read = originalImageRead;
  }
  console.log('PASS clipboard thumbnail/content preview and drag, native PNG payload, no drag-click copy, and out-of-order preview protection');
  const galleryPixels = Buffer.from(pixels); galleryPixels[0] = 202;
  await writeFile(join(screenshots, 'Screenshot 2026-10-20 12.00.00.png'), nativeImage.createFromBitmap(galleryPixels, {width:20,height:12}).toPNG());
  items = [];
  await waitFor(async () => (await list()).filter(entry => entry.kind === 'image' && entry.sources.includes('screenshot')).length === 2, 'second screenshot imported');
  await evaluate('document.querySelectorAll(".module-tab")[2].click()');
  await waitFor(() => evaluate('document.querySelectorAll(".image-selection").length >= 2'), 'image selection controls');
  await evaluate('document.querySelectorAll(".image-selection")[0].click(); document.querySelectorAll(".image-selection")[1].click()');
  assert.equal(await evaluate('document.querySelectorAll(".image-card.selected").length'), 2);
  assert.equal(await evaluate(`Array.from(document.querySelectorAll('.image-card')).every(card => {
    const frame = card.getBoundingClientRect(), button = card.querySelector('.image-preview-button').getBoundingClientRect();
    const img = card.querySelector('.image-preview-button img'); const bounds = img.getBoundingClientRect();
    return getComputedStyle(img).objectFit === 'contain' && bounds.top >= frame.top && bounds.left >= frame.left &&
      bounds.right <= frame.right && bounds.bottom <= Math.min(frame.bottom, button.bottom);
  })`), true, 'whole image viewport fits inside visible card and preview button');
  await delay(200);
  await writeFile(join(root, 'work', 'image-multiselect-preview.png'), (await window.webContents.capturePage(undefined, { stayHidden: true })).toPNG());
  await evaluate('document.querySelector(".image-preview-button").dispatchEvent(new Event("dragstart", { bubbles: true, cancelable: true }))');
  await waitFor(() => dragged?.files?.length === 2, 'two native file drag paths');
  assert.equal(new Set(dragged.files).size, 2);
  assert.ok(dragged.files.every(path => fs.existsSync(path)));
  dragged = undefined;
  assert.equal(await evaluate(`window.gpaster.startImageDrag([${JSON.stringify(captured.id)}, "missing-id"])`), false);
  assert.equal(dragged, undefined);
  assert.equal(await evaluate('window.gpaster.startImageDrag([])'), false);
  await evaluate('document.querySelector(".screenshot-footer .settings-link").click()');
  assert.equal(await evaluate('document.querySelectorAll(".image-card.selected").length'), 0);
  assert.equal(await evaluate(`window.gpaster.startImageDrag(${JSON.stringify(captured.id)})`), true);
  assert.ok(dragged.file);
  assert.equal(dragged.files, undefined);
  await evaluate('document.querySelectorAll(".module-tab")[0].click()');
  console.log('PASS image selection → real preload/IPC → native drag arguments (OS drop verified separately); invalid groups rejected, clear and single drag preserved');
  await evaluate('document.querySelectorAll(".module-tab")[2].click()');
  await waitFor(() => evaluate('Boolean(document.querySelector(".image-preview-button"))'), 'screenshot interactions ready');
  const targetImage = (await list()).find(entry => entry.kind === 'image' && entry.sources.includes('screenshot'));
  const expectedImage = await evaluate(`window.gpaster.previewImage(${JSON.stringify(targetImage.id)})`);
  items = [];
  assert.equal(await evaluate('document.querySelector(".image-preview-button").dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, button: 2 }))'), false);
  await waitFor(() => evaluate('Boolean(document.querySelector(".image-dialog .large-image-wrap img"))'), 'right-click opens details');
  assert.equal(await evaluate('document.querySelector(".large-image-wrap img").src'), expectedImage);
  assert.equal(items.length, 0, 'right-click does not copy');
  await evaluate('document.querySelector(".image-dialog .dialog-heading button").click()');
  // A plain click must copy only its target, even when other images are selected.
  await evaluate('document.querySelectorAll(".image-selection")[0].click(); document.querySelectorAll(".image-selection")[1].click()');
  let hideCalls = 0;
  const originalHide = window.hide.bind(window);
  window.hide = () => { hideCalls++; originalHide(); };
  await evaluate('document.querySelector(".image-preview-button").click()');
  await waitFor(() => hideCalls > 0 && items.some(item => item.types.includes('image/png')), 'single click copies then hides panel');
  const clickedBlob = await items[0].getType('image/png');
  assert.deepEqual(Buffer.from(await clickedBlob.arrayBuffer()), Buffer.from(expectedImage.split(',')[1], 'base64'));
  assert.equal(await evaluate('Boolean(document.querySelector(".image-dialog"))'), false);
  window.hide = originalHide;
  await evaluate('document.querySelectorAll(".module-tab")[0].click()');
  assert.deepEqual((await list()).find(entry => entry.id === targetImage.id).sources.sort(), ['clipboard', 'screenshot']);
  await waitFor(() => evaluate('document.querySelectorAll(".history-thumb").length >= 3'), 'actively copied screenshot also becomes clipboard history');
  console.log('PASS screenshot right-click details, single click copy/hide, and actual copy adds clipboard provenance without losing screenshot');

  // Delay one conversion to reproduce clearing history while decoding is in flight.
  pixels[0] = 87;
  await writeFile(fixture, nativeImage.createFromBitmap(pixels, { width: 20, height: 12 }).toPNG());
  await promisify(execFile)('/usr/bin/sips', ['-s', 'format', 'tiff', fixture, '--out', tiffFile]);
  const nextTiff = await readFile(tiffFile);
  const codec = require(join(root, 'dist-electron/electron/image-codec.js'));
  const originalDecode = codec.decodeImageBuffer;
  let holdFirst = true, entered = false, release;
  let gate = new Promise(resolveGate => { release = resolveGate; });
  codec.decodeImageBuffer = async (source) => {
    if (holdFirst) { holdFirst = false; entered = true; await gate; }
    return originalDecode(source);
  };
  items = [new ClipboardItem({ 'image/tiff': new Blob([new Uint8Array(nextTiff)]) })];
  await waitFor(() => entered, 'in-flight image conversion');
  const beforeCopy = (await list()).filter(entry => entry.kind === 'image').length;
  assert.equal(await evaluate(`window.gpaster.copyHistory(${JSON.stringify(captured.id)})`), true);
  release(); await delay(600);
  assert.equal((await list()).filter(entry => entry.kind === 'image').length, beforeCopy);
  assert.equal((await evaluate('window.gpaster.listCaptureIssues()')).length, 0);
  console.log('PASS re-copy during slow decode cancels stale image results without duplicates');
  holdFirst = true; entered = false;
  gate = new Promise(resolveGate => { release = resolveGate; });
  items = [new ClipboardItem({'image/png':new Blob(['broken data'])})];
  await waitFor(() => entered, 'in-flight invalid image');
  assert.equal(await evaluate(`window.gpaster.copyHistory(${JSON.stringify(captured.id)})`), true);
  release(); await delay(600);
  assert.equal((await evaluate('window.gpaster.listCaptureIssues()')).length, 0);
  console.log('PASS stale conversion error cannot reappear after a successful re-copy');
  holdFirst = true; entered = false;
  gate = new Promise(resolveGate => { release = resolveGate; });
  items = [new ClipboardItem({'image/tiff':new Blob([new Uint8Array(nextTiff)])})];
  await waitFor(() => entered, 'in-flight image conversion before clear');
  await evaluate('window.gpaster.clearHistory()');
  release();
  await delay(600);
  assert.equal((await list()).length, 0);
  console.log('PASS clear during conversion does not resurrect deleted history');
  holdFirst = true; entered = false;
  gate = new Promise(resolveGate => { release = resolveGate; });
  await writeFile(join(screenshots, '截屏2026-10-12 20.31.00.png'), png);
  await waitFor(() => entered, 'in-flight screenshot conversion');
  await evaluate('window.gpaster.clearHistory()');
  release();
  await delay(600);
  assert.equal((await list()).length, 0);
  console.log('PASS clear during screenshot import does not resurrect deleted history');

  console.log(`PASS application integration (isPackaged=${app.isPackaged}); user clipboard untouched`);
}).catch(error => {
  console.error(error);
  process.exitCode = 1;
}).finally(async () => {
  // Stop capture and close Chromium before removing its still-active cache directory.
  app.emit('before-quit');
  for (const window of BrowserWindow.getAllWindows()) window.destroy();
  await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}).then(() => app.exit(process.exitCode || 0)).catch(error => {
  console.error(error);
  app.exit(1);
});
