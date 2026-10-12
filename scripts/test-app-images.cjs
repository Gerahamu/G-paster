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
clipboard.readText = async () => text;
clipboard.write = async (next) => { items = next; text = ''; };
clipboard.writeText = async (next) => { text = next; items = []; };
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
  const { translate } = require(join(root, 'dist-electron/src/shared/i18n.js'));
  const list = () => evaluate('window.gpaster.listHistory()');
  const pixels = Buffer.alloc(20 * 12 * 4, 120);
  for (let i = 3; i < pixels.length; i += 4) pixels[i] = 255;
  const png = nativeImage.createFromBitmap(pixels, { width: 20, height: 12 }).toPNG();
  const fixture = join(directory, 'fixture.png');
  const tiffFile = join(directory, 'fixture.tiff');
  await writeFile(fixture, png);
  await promisify(execFile)('/usr/bin/sips', ['-s', 'format', 'tiff', fixture, '--out', tiffFile]);
  const tiff = await readFile(tiffFile);
  items = [new ClipboardItem({ 'image/tiff': new Blob([new Uint8Array(tiff)], { type: 'image/tiff' }) })];
  await waitFor(async () => (await list()).some(entry => entry.kind === 'image'), 'TIFF automatic capture');
  const captured = (await list()).find(entry => entry.kind === 'image');
  assert.equal(captured.width, 20);
  await waitFor(() => evaluate('Array.from(document.querySelectorAll("img.history-thumb")).some(i => i.complete && i.naturalWidth > 0)'), 'visible history thumbnail');
  const preview = await evaluate(`window.gpaster.previewImage(${JSON.stringify(captured.id)})`);
  assert.ok(preview.startsWith('data:image/png;base64,'));
  console.log('PASS main poll → PNG store → secure IPC → real renderer thumbnail/preview');
  assert.equal(await evaluate(`window.gpaster.copyHistory(${JSON.stringify(captured.id)})`), true);
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
  console.log('PASS real screenshot monitor → history update; original file unchanged');
  items = [new ClipboardItem({ 'image/png': new Blob(['invalid image']) })];
  text = 'text still captured while an image fails';
  await waitFor(async () => (await list()).some(e => e.content === text), 'independent text capture');
  await waitFor(async () => (await evaluate('window.gpaster.listCaptureIssues()')).some(i => i.source === 'clipboard-image'), 'capture issue IPC');
  const issue = (await evaluate('window.gpaster.listCaptureIssues()')).find(i => i.source === 'clipboard-image');
  const settings = await evaluate('window.gpaster.getSystemSettings()');
  const issueText = translate(settings.language, issue.message);
  await waitFor(() => evaluate(`Array.from(document.querySelectorAll("[role=status]")).some(e => e.textContent.includes(${JSON.stringify(issueText)}))`), 'localized capture issue UI');
  items = [new ClipboardItem({ 'image/png': new Blob([new Uint8Array(png)]) })]; text = '';
  await waitFor(async () => (await evaluate('window.gpaster.listCaptureIssues()')).length === 0, 'capture issue recovery');
  console.log('PASS failure visible in renderer, text unaffected, recovery clears status');
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
}).finally(async () => { await rm(directory, { recursive: true, force: true }); }).then(() => app.quit()).catch(error => {
  console.error(error);
  app.exit(1);
});
