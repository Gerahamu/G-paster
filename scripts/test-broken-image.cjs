// Exercises a persisted image whose backing file is missing. Isolated data only.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { mkdtemp, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');
const { app, BrowserWindow, clipboard, globalShortcut } = require('electron');

const root = resolve(__dirname, '..');
const directory = fs.mkdtempSync(join(tmpdir(), 'gpaster-broken-image-'));
const data = join(directory, 'data');
const screenshots = join(directory, 'screenshots');
fs.mkdirSync(data);
fs.mkdirSync(screenshots);
const now = Date.now();
fs.writeFileSync(join(data, 'image-history.json'), JSON.stringify([{
  id: 'broken-image',
  hash: '0'.repeat(64),
  fileName: 'broken-image.png',
  width: 10,
  height: 10,
  createdAt: now,
  copiedAt: now,
  sources: ['screenshot']
}]));
app.setPath('userData', data);
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
clipboard.has = async type => items.some(item => item.types.includes(type));
clipboard.readText = async () => text;
clipboard.write = async (next) => { items = next; text = ''; };
clipboard.writeText = async (next) => { text = next; items = []; };
require(join(root, 'dist-electron/electron/main.js'));

async function waitFor(check, label) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    try { if (await check()) return; } catch { /* Renderer may still be starting. */ }
    await delay(100);
  }
  throw new Error(`Timeout: ${label}`);
}

app.whenReady().then(async () => {
  let window;
  await waitFor(async () => {
    window = BrowserWindow.getAllWindows()[0];
    return window && !window.webContents.isLoading() &&
      await window.webContents.executeJavaScript('Boolean(window.gpaster && document.querySelector(".module-tabs"))');
  }, 'renderer');
  const evaluate = code => window.webContents.executeJavaScript(code);
  await evaluate('document.querySelectorAll(".module-tab")[2].click()');
  await waitFor(() => evaluate('Boolean(document.querySelector(".image-card.unavailable"))'), 'broken image placeholder');
  const entries = await evaluate('window.gpaster.listHistory()');
  assert.equal(entries.length, 1);
  assert.equal(entries[0].kind, 'image');
  assert.equal(entries[0].unavailable, true);
  assert.ok(entries[0].previewDataUrl.startsWith('data:image/svg+xml'));
  assert.equal(await evaluate('window.gpaster.previewImage("broken-image")'), null);
  assert.equal(await evaluate('window.gpaster.copyHistory("broken-image")'), false);
  assert.equal(await evaluate('window.gpaster.deleteHistory("broken-image")'), true);
  assert.deepEqual(await evaluate('window.gpaster.listHistory()'), []);
  console.log('PASS missing image is visible as unavailable, cannot be copied, and can be deleted');
}).catch(error => {
  console.error(error);
  process.exitCode = 1;
}).finally(async () => {
  app.emit('before-quit');
  for (const window of BrowserWindow.getAllWindows()) window.destroy();
  await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}).then(() => app.exit(process.exitCode || 0)).catch(error => {
  console.error(error);
  app.exit(1);
});
