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
let finishGesture;
const originalExecFile = childProcess.execFile;
childProcess.execFile = (file, args, options, callback) => {
  if (file === '/usr/bin/osascript' && args?.includes('JavaScript')) {
    finishGesture = callback;
    return { kill() {} };
  }
  return originalExecFile(file, args, options, callback);
};
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
  }, 'gallery renderer');
  const evaluate = code => window.webContents.executeJavaScript(code);
  const list = () => evaluate('window.gpaster.listHistory()');
  // Gallery regression: synthetic aspect ratios, Retina previews, and no source upscaling.
  const shapes = [[1200, 900], [300, 1800], [2400, 300], [20, 12]];
  for (const [index, [width, height]] of shapes.entries()) {
    const bitmap = Buffer.alloc(width * height * 4, 200);
    for (let i = 3; i < bitmap.length; i += 4) bitmap[i] = 255;
    await writeFile(join(screenshots, `Screenshot 2026-10-24 12.00.0${index}.png`), nativeImage.createFromBitmap(bitmap, {width, height}).toPNG());
  }
  await waitFor(async () => (await list()).filter(item => item.kind === 'image').length === 4, 'gallery aspect fixtures');
  await evaluate('document.querySelectorAll(".module-tab")[2].click()');
  await waitFor(() => evaluate('document.querySelectorAll(".image-card").length === 4 && Array.from(document.querySelectorAll(".image-preview-button img")).every(img => img.complete && img.naturalWidth > 0)'), 'gallery fixtures rendered');
  for (const item of (await list()).filter(item => item.kind === 'image')) {
    const size = nativeImage.createFromDataURL(item.previewDataUrl).getSize();
    const scale = Math.min(1, 360 / item.width, 270 / item.height);
    assert.equal(size.width, Math.round(item.width * scale));
    assert.equal(size.height, Math.round(item.height * scale));
  }
  assert.equal(await evaluate(`Array.from(document.querySelectorAll('.image-card')).every(card => {
    const button = card.querySelector('.image-preview-button').getBoundingClientRect();
    const img = card.querySelector('img'), bounds = img.getBoundingClientRect();
    return Math.abs(button.width / button.height - 16 / 10) < .02 && button.height > 100 &&
      bounds.width <= parseFloat(img.style.maxWidth) + 1 && bounds.height <= parseFloat(img.style.maxHeight) + 1 &&
      getComputedStyle(img).objectFit === 'contain' && getComputedStyle(card.querySelector('.image-card-footer')).opacity === '0';
  })`), true, '16:10 cards, uncropped previews, no low-resolution upscaling, hidden metadata');
  assert.equal(await evaluate(`getComputedStyle(document.querySelector('.image-grid')).gridTemplateColumns.split(' ').length`), 2);
  await writeFile(resolve(__dirname, '..', 'work', 'screenshot-gallery.png'), (await window.webContents.capturePage(undefined, { stayHidden: true })).toPNG());
  console.log('PASS gallery landscape/portrait/ultrawide/small fixtures, 360x270 cache, 16:10 two-column layout');

  await evaluate('document.querySelectorAll(".image-selection")[0].click(); document.querySelectorAll(".image-selection")[1].click()');
  assert.equal(await evaluate('document.querySelectorAll(".image-card.selected").length'), 2);
  await evaluate('document.querySelector(".image-card .icon-button").focus()');
  await delay(200);
  assert.equal(await evaluate('getComputedStyle(document.querySelector(".image-card-footer")).opacity'), '1');
  await evaluate('document.querySelector(".screenshot-footer .settings-link").click()');
  assert.equal(await evaluate('document.querySelectorAll(".image-card.selected").length'), 0);
  console.log('PASS multi-selection, cancel selection, and keyboard-accessible hover actions; user clipboard untouched');
  const nativeDrags = [];
  window.webContents.startDrag = payload => nativeDrags.push(payload);
  let hideCalls = 0;
  const originalHide = window.hide.bind(window);
  window.hide = () => { hideCalls++; originalHide(); };
  const beginDrag = () => evaluate('document.querySelector(".image-preview-button").dispatchEvent(new Event("dragstart", { bubbles: true, cancelable: true }))');
  await evaluate('document.querySelectorAll(".image-selection")[0].click(); document.querySelectorAll(".image-selection")[1].click()');
  await beginDrag();
  await waitFor(() => Boolean(finishGesture), 'multi-drag waiting for physical release');
  assert.equal(nativeDrags.at(-1).files.length, 2);
  assert.equal(hideCalls, 0, 'do not dismiss during native drag');
  assert.equal(await evaluate('document.querySelectorAll(".image-card.selected").length'), 2);
  finishGesture(new Error('simulated gesture monitor failure')); finishGesture = undefined;
  await delay(200);
  assert.equal(hideCalls, 0);
  assert.equal(await evaluate('document.querySelectorAll(".image-card.selected").length'), 2, 'failed drag preserves selection');
  await beginDrag();
  await waitFor(() => Boolean(finishGesture), 'retry gesture monitor');
  finishGesture(null); finishGesture = undefined;
  await waitFor(() => hideCalls === 1, 'multi-drag dismisses window after release');
  await waitFor(() => evaluate('document.querySelectorAll(".image-card.selected").length === 0'), 'multi-drag clears selection');
  for (const [index, selectFirst] of [false, true].entries()) {
    if (selectFirst) await evaluate('document.querySelectorAll(".image-selection")[0].click()');
    assert.equal(await evaluate('document.querySelectorAll(".image-card.selected").length'), selectFirst ? 1 : 0);
    await beginDrag();
    await waitFor(() => Boolean(finishGesture), 'single drag waits for physical release');
    assert.equal(nativeDrags.at(-1).files, undefined, 'single image retains single-file native payload');
    assert.equal(hideCalls, 1 + index, 'single drag must not hide before release');
    finishGesture(null); finishGesture = undefined;
    await waitFor(() => hideCalls === 2 + index, 'single drag hides after release');
    await waitFor(() => evaluate('document.querySelectorAll(".image-card.selected").length === 0'), 'single drag clears selection');
  }
  const existing = (await list()).find(item => item.kind === 'image');
  assert.equal(await evaluate(`window.gpaster.startImageDrag(${JSON.stringify(existing.id)})`), true);
  assert.equal(finishGesture, undefined, 'callers without auto-dismiss retain original behavior');
  assert.equal(hideCalls, 3);
  const before = nativeDrags.length;
  assert.equal(await evaluate('window.gpaster.startImageDrag(["missing-a", "missing-b"], true)'), false);
  assert.equal(nativeDrags.length, before);
  assert.equal(hideCalls, 3);
  window.hide = originalHide;
  console.log('PASS multi-image, direct single-image and checked single-image drags hide and clear after release; invalid and non-dismiss calls preserved');
  for (const action of ['close', 'blur', 'reopen']) {
    await evaluate('document.querySelectorAll(".image-selection")[1].click()');
    await waitFor(() => evaluate('document.querySelectorAll(".image-card.selected").length > 0'), 'selection before lifecycle action');
    if (action === 'close') window.close();
    else if (action === 'blur') window.emit('blur');
    else window.webContents.send('window:shown');
    await waitFor(() => evaluate('document.querySelectorAll(".image-card.selected").length === 0'), `${action} clears screenshot selection`);
    assert.equal(window.isDestroyed(), false, 'panel close keeps background app alive');
    await evaluate('document.querySelectorAll(".module-tab")[2].click()');
    assert.equal(await evaluate('document.querySelectorAll(".image-selection:checked").length'), 0, 'selection remains empty when returning to screenshots');
  }
  console.log('PASS close, blur/hide and reopen all clear screenshot multi-selection through real preload/IPC');


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
