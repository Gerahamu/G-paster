// Exercises the real main process, preload and renderer with temporary app data.
// The system clipboard is mocked and no user files or clipboard contents are read.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { mkdtemp, readFile, rm, writeFile } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');
const { app, BrowserWindow, ClipboardItem, clipboard, dialog, globalShortcut, nativeImage } = require('electron');

const root = resolve(__dirname, '..');
const directory = fs.mkdtempSync(join(tmpdir(), 'gpaster-phrase-image-app-'));
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

let items = [];
let text = '';
clipboard.read = async () => items;
clipboard.has = async (type) => items.some(item => item.types.includes(type));
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
  }, 'real renderer and preload');
  const evaluate = code => window.webContents.executeJavaScript(code);

  const pixels = Buffer.alloc(24 * 16 * 4, 170);
  for (let index = 3; index < pixels.length; index += 4) pixels[index] = 255;
  const sourcePng = nativeImage.createFromBitmap(pixels, { width: 24, height: 16 }).toPNG();
  const sourcePath = join(screenshots, 'Screenshot 2026-10-21 15.00.00.png');
  await writeFile(sourcePath, sourcePng);
  await waitFor(async () => (await evaluate('window.gpaster.listHistory()')).some(entry => entry.kind === 'image' && entry.sources.includes('screenshot')), 'screenshot captured into local history');

  await evaluate('document.querySelectorAll(".module-tabs .module-tab")[2].click()');
  await waitFor(() => evaluate('Boolean(document.querySelector(".image-card-footer .entry-actions .icon-button"))'), 'save image as phrase action');
  await evaluate('document.querySelector(".image-card-footer .entry-actions .icon-button").click()');
  await waitFor(async () => (await evaluate('window.gpaster.listPhrases()')).some(phrase => phrase.kind === 'image'), 'image phrase stored');
  const phrase = (await evaluate('window.gpaster.listPhrases()')).find(item => item.kind === 'image');
  assert.deepEqual(phrase.image, { width: 24, height: 16 });

  const phraseAssetPath = join(directory, 'data', 'phrase-images', `${phrase.id}.png`);
  assert.deepEqual(await readFile(phraseAssetPath), sourcePng);
  const phrasePreview = await evaluate(`window.gpaster.previewPhraseImage(${JSON.stringify(phrase.id)})`);
  assert.ok(phrasePreview.startsWith('data:image/png;base64,'));
  assert.equal(nativeImage.createFromDataURL(phrasePreview).isEmpty(), false);

  const { PhraseStore } = require(join(root, 'dist-electron/electron/phrase-store.js'));
  const reloaded = new PhraseStore(join(directory, 'data', 'phrases.json'));
  assert.deepEqual(await reloaded.readImage(phrase.id), sourcePng);
  await evaluate('window.gpaster.clearHistory()');
  assert.equal((await evaluate('window.gpaster.listHistory()')).length, 0);
  assert.deepEqual(await readFile(phraseAssetPath), sourcePng, 'clearing history must leave the saved phrase image intact');
  assert.deepEqual(await reloaded.readImage(phrase.id), sourcePng);

  await evaluate('document.querySelectorAll(".module-tabs .module-tab")[1].click()');
  await waitFor(() => evaluate('Boolean(document.querySelector(".phrase-item .phrase-copy-area"))'), 'image phrase appears in the phrase list');
  let hideCalls = 0;
  const originalHide = window.hide.bind(window);
  window.hide = () => { hideCalls++; originalHide(); };
  await evaluate('document.querySelector(".phrase-item .phrase-copy-area").click()');
  await waitFor(() => hideCalls > 0 && items.some(item => item.types.includes('image/png')), 'phrase writes an image to clipboard and closes the window');
  const copied = await items[0].getType('image/png');
  assert.deepEqual(Buffer.from(await copied.arrayBuffer()), sourcePng);
  assert.ok((await evaluate('window.gpaster.listHistory()')).some(entry => entry.kind === 'image' && entry.sources.includes('clipboard')));
  window.hide = originalHide;
  await evaluate('document.querySelectorAll(".module-tabs .module-tab")[1].click()');
  assert.equal(await evaluate('Boolean(document.querySelector(".module-toolbar .phrase-import-image"))'), false);
  await evaluate('document.querySelector(".module-toolbar .primary-button").click()');
  await waitFor(() => evaluate('Boolean(document.querySelector(".phrase-import-image"))'), "phrase import button visible");
  const countBeforeImport = (await evaluate('window.gpaster.listPhrases()')).length;
  dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] });
  await evaluate('document.querySelector(".phrase-import-image").click()');
  await delay(150);
  assert.equal((await evaluate('window.gpaster.listPhrases()')).length, countBeforeImport);
  assert.equal(await evaluate('Boolean(document.querySelector(".phrase-dialog .phrase-import-image"))'), true);
  dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [sourcePath] });
  await evaluate(`{ const el = document.querySelector("#phrase-content"); const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set; set.call(el, "draft text that must survive a cancelled import"); el.dispatchEvent(new Event("input", { bubbles: true })); }`);
  await evaluate('window.confirm = () => false; true');
  await evaluate('document.querySelector(".phrase-import-image").click()');
  await delay(150);
  assert.equal((await evaluate('window.gpaster.listPhrases()')).length, countBeforeImport);
  assert.equal(await evaluate('Boolean(document.querySelector(".phrase-dialog"))'), true);
  await evaluate('window.confirm = () => true; true');
  await evaluate('document.querySelector(".phrase-import-image").click()');
  await waitFor(async () => (await evaluate('window.gpaster.listPhrases()')).length === countBeforeImport + 1 && !await evaluate('Boolean(document.querySelector(".phrase-dialog"))'), 'image import after draft confirmation and dialog dismissal');
  const imported = (await evaluate('window.gpaster.listPhrases()'))[0];
  assert.equal(imported.kind, 'image');
  await rm(sourcePath);
  const importedReloaded = new PhraseStore(join(directory, 'data', 'phrases.json'));
  assert.deepEqual(await importedReloaded.readImage(imported.id), sourcePng);
  console.log('PASS screenshot save, independent storage, reload, PNG copy, creation-dialog import, cancel, and source removal');
}).catch(error => {
  console.error(error);
  process.exitCode = 1;
}).finally(async () => {
  app.emit('before-quit');
  await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  app.exit(process.exitCode || 0);
}).then(() => app.exit(process.exitCode || 0)).catch(error => {
  console.error(error);
  app.exit(1);
});
