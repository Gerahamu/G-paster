// Exercises startup, clear, slow-provider fallback and shutdown on the real main process.
// Native clipboard access is completely replaced; user data is isolated.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const { performance } = require('node:perf_hooks');
const { setTimeout: delay } = require('node:timers/promises');
const { app, BrowserWindow, clipboard, globalShortcut, ipcMain, nativeImage } = require('electron');
const root = resolve(__dirname, '..');
const directory = fs.mkdtempSync(join(tmpdir(), 'gpaster-monitor-'));
const screenshots = join(directory, 'screenshots'); fs.mkdirSync(screenshots);
app.setPath('userData', join(directory, 'data')); app.setPath('desktop', screenshots);
app.getAppPath = () => root;
BrowserWindow.prototype.show = function () {};
BrowserWindow.prototype.focus = function () {};
globalShortcut.register = () => true;
const cp = require('node:child_process'), originalExec = cp.execFileSync;
cp.execFileSync = (file, args, options) => file === 'defaults' && args?.[1] === 'com.apple.screencapture'
  ? screenshots : originalExec(file, args, options);
const timers = new Set(), originalSetInterval = global.setInterval, originalClearInterval = global.clearInterval;
global.setInterval = (callback, ms, ...args) => {
  const timer = originalSetInterval(callback, ms, ...args);
  if (ms === 180) timers.add(timer);
  return timer;
};
global.clearInterval = timer => { timers.delete(timer); return originalClearInterval(timer); };
const originalHandle = ipcMain.handle.bind(ipcMain);
let phase = '', firstTextRead = true, hangClear = false, releaseStartup, releaseClear;
ipcMain.handle = (channel, handler) => originalHandle(channel, async (...args) => {
  if (channel !== 'history:clear') return handler(...args);
  phase = 'clear';
  try { return await handler(...args); } finally { phase = ''; }
});
let text = '', items = [], holdEnumeration = false;
const enumerationGates = [], captured = new Set(), counts = { read: 0, readText: 0, has: 0 };
clipboard.readText = async () => {
  counts.readText++;
  if (firstTextRead) {
    firstTextRead = false;
    return new Promise(resolve => { releaseStartup = resolve; });
  }
  if (phase === 'clear' && hangClear) {
    hangClear = false;
    return new Promise(resolve => { releaseClear = resolve; });
  }
  return text;
};
clipboard.read = async () => {
  counts.read++;
  if (holdEnumeration) return new Promise(resolve => enumerationGates.push(resolve));
  return items;
};
clipboard.has = async type => { counts.has++; return items.some(item => item.types.includes(type)); };
clipboard.writeText = async value => { text = value; items = []; };
clipboard.write = async value => { items = value; text = ''; };
const windows = [];
app.on('browser-window-created', (_event, window) => {
  windows.push(window);
  const send = window.webContents.send.bind(window.webContents);
  window.webContents.send = (channel, ...args) => {
    if (channel === 'history:changed') for (const entry of args[0]) if (entry.kind === 'text') captured.add(entry.content);
    return send(channel, ...args);
  };
});
const started = performance.now();
require(join(root, 'dist-electron/electron/main.js'));
async function wait(check, label, timeout = 8000) {
  const deadline = performance.now() + timeout;
  while (performance.now() < deadline) { if (await check()) return; await delay(10); }
  throw new Error('Timeout: ' + label);
}
app.whenReady().then(async () => {
  app.dock?.hide();
  if (process.env.GPASTER_MONITOR_QUIT_DURING_STARTUP === '1') {
    await wait(() => typeof releaseStartup === 'function', 'startup baseline entered');
    app.emit('before-quit');
    const stopped = { ...counts };
    releaseStartup('late-startup-after-quit');
    await delay(150);
    assert.equal(windows.length, 0);
    assert.equal(timers.size, 0);
    assert.deepEqual(counts, stopped);
    console.log('PASS quitting during startup prevents late window/timer creation and further clipboard reads');
    return;
  }
  await wait(async () => windows[0] && !windows[0].webContents.isLoading() &&
    await windows[0].webContents.executeJavaScript('Boolean(window.gpaster)'), 'startup recovers from stalled baseline');
  assert.ok(performance.now() - started >= 1400);
  assert.equal(timers.size, 1);
  const evaluate = code => windows[0].webContents.executeJavaScript(code);
  const list = () => evaluate('window.gpaster.listHistory()');
  text = 'after-startup';
  await wait(() => captured.has(text), 'text after startup timeout');
  const startupEntry = (await list()).find(entry => entry.content === text);
  releaseStartup('late-startup-result'); await delay(100);
  assert.equal((await list()).find(entry => entry.id === startupEntry.id).copiedAt, startupEntry.copiedAt);
  console.log('PASS startup baseline timeout allows UI and capture; late provider result does not reset baseline');
  hangClear = true;
  const clearStarted = performance.now();
  await evaluate('window.gpaster.clearHistory()');
  assert.ok(performance.now() - clearStarted >= 1400);
  assert.deepEqual(await list(), []);
  text = 'after-clear';
  await wait(() => captured.has(text), 'capture resumes after clear baseline timeout');
  const clearEntry = (await list()).find(entry => entry.content === text);
  releaseClear('late-clear-result'); await delay(100);
  assert.equal((await list()).find(entry => entry.id === clearEntry.id).copiedAt, clearEntry.copiedAt);
  console.log('PASS clear timeout releases capture pause; late baseline result is ignored');
  holdEnumeration = true;
  await wait(() => enumerationGates.length > 0, 'image-side enumeration held');
  const rapid = [];
  for (let i = 0; i < 20; i++) { text = `slow-enumeration-${i}`; rapid.push(text); await delay(220); }
  await wait(() => rapid.every(value => captured.has(value)), 'text retains 20/20 capture while enumeration is stalled');
  assert.ok(counts.has > 0);
  holdEnumeration = false;
  for (const release of enumerationGates.splice(0)) release([]);
  await delay(100);
  console.log('PASS slow shared enumeration falls back and captures 20/20 texts at 220 ms');
  let releasePayload, payloadEntered = false;
  const png = nativeImage.createFromBitmap(Buffer.alloc(16 * 4 * 4, 255), { width: 16, height: 4 }).toPNG();
  items = [{ types: ['image/png'], getType: async () => {
    payloadEntered = true;
    return new Promise(resolve => { releasePayload = () => resolve(new Blob([new Uint8Array(png)])); });
  } }];
  await wait(() => payloadEntered, 'image payload held');
  const more = [];
  for (let i = 0; i < 20; i++) { text = `slow-image-${i}`; more.push(text); await delay(220); }
  await wait(() => more.every(value => captured.has(value)), 'text retains 20/20 capture while image payload is stalled');
  items = []; releasePayload(); await delay(100);
  console.log('PASS slow image payload does not serialize or suppress text capture');
  holdEnumeration = true;
  await wait(() => enumerationGates.length > 0, 'in-flight enumeration before disposal');
  app.emit('before-quit');
  assert.equal(timers.size, 0);
  const stoppedCounts = { ...counts };
  const stoppedPng = nativeImage.createFromBitmap(Buffer.alloc(7 * 3 * 4, 120), { width: 7, height: 3 }).toPNG();
  for (const release of enumerationGates.splice(0)) release([{ types: ['image/png'], getType: async () => new Blob([new Uint8Array(stoppedPng)]) }]);
  await delay(150);
  assert.deepEqual(counts, stoppedCounts);
  assert.equal((await list()).some(entry => entry.kind === 'image' && entry.width === 7), false);
  console.log('PASS disposal clears the only polling timer, stops native API calls and drops in-flight capture');
}).finally(async () => {
  app.emit('before-quit');
  for (const window of windows) if (!window.isDestroyed()) window.destroy();
  await fsp.rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}).then(() => app.quit()).catch(error => { console.error(error); app.exit(1); });
