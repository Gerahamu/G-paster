// Exercises text capture with a synthetic clipboard and isolated app data.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const { join, resolve } = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');
const { performance } = require('node:perf_hooks');
const { app, BrowserWindow, clipboard, globalShortcut } = require('electron');

const root = resolve(__dirname, '..');
const directory = fs.mkdtempSync(join(require('node:os').tmpdir(), 'gpaster-text-'));
const screenshots = join(directory, 'screenshots');
fs.mkdirSync(screenshots);
app.setPath('userData', join(directory, 'data'));
app.setPath('desktop', screenshots);
app.getAppPath = () => root;
BrowserWindow.prototype.show = function () {};
BrowserWindow.prototype.focus = function () {};
globalShortcut.register = () => true;
let text = '';
let items = [];
let readHook = null;
let textReadCalls = 0;
clipboard.readText = async () => {
  textReadCalls += 1;
  if (readHook) { const hook = readHook; readHook = null; return hook(); }
  return text;
};
clipboard.read = async () => items;
clipboard.has = async type => items.some(item => item.types.includes(type));
clipboard.writeText = async value => { text = value; items = []; };
clipboard.write = async value => { items = value; text = ''; };
let failTextWrites = false;
const originalWriteFile = fsp.writeFile;
fsp.writeFile = async (path, ...args) => {
  if (failTextWrites && String(path).startsWith(join(directory, 'data', 'history.json'))) {
    throw Object.assign(new Error('Synthetic storage unavailable'), { code: 'ENOSPC' });
  }
  return originalWriteFile(path, ...args);
};

const windows = [];
app.on('browser-window-created', (_event, window) => windows.push(window));
require(join(root, 'dist-electron/electron/main.js'));

async function wait(check, label, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try { if (await check()) return; }
    catch (error) { lastError = error; }
    await delay(20);
  }
  throw new Error(`Timed out waiting for ${label}${lastError ? ` (${lastError.message})` : ''}`);
}

app.whenReady().then(async () => {
  try {
    let window;
    await wait(async () => {
      window = windows[0];
      return window && !window.webContents.isLoading() &&
        await window.webContents.executeJavaScript('Boolean(window.gpaster && document.querySelector(".module-tabs"))');
    }, 'renderer and preload');
    const evaluate = code => window.webContents.executeJavaScript(code);
    const invoke = (method, ...args) => evaluate(`window.gpaster.${method}(...${JSON.stringify(args)})`);
    const list = () => invoke('listHistory');
    const translateMessage = require(join(root, 'dist-electron/src/shared/i18n.js')).translateMessage;
    const hasVisibleIssue = async source => {
      const issue = (await invoke('listCaptureIssues')).find(item => item.source === source);
      if (!issue) return false;
      const language = (await invoke('getSystemSettings')).language;
      const message = translateMessage(language, issue.message);
      return evaluate(`Array.from(document.querySelectorAll('.error-message[role="status"]')).some(node => node.textContent.includes(${JSON.stringify(message)}))`);
    };

    const idleReads = textReadCalls;
    const idleStart = performance.now();
    const idleCpu = process.cpuUsage();
    await delay(5_000);
    const idleElapsed = performance.now() - idleStart;
    const idleUsed = process.cpuUsage(idleCpu);
    console.log(`MEASURE isolated Electron main idle CPU=${((idleUsed.user + idleUsed.system) / (idleElapsed * 10)).toFixed(3)}% over ${Math.round(idleElapsed)}ms; readText calls=${textReadCalls - idleReads}.`);

    // The 180 ms production sampler should see each synthetic change spaced 220 ms apart.
    await invoke('clearHistory');
    const startIds = new Set((await list()).map(entry => entry.id));
    for (let index = 0; index < 20; index += 1) {
      text = `synthetic-burst-${index}`;
      await delay(220);
    }
    await wait(async () => (await list()).filter(entry => entry.content.startsWith('synthetic-burst-')).length === 20,
      'all 20 rapid clipboard values', 5_000);
    assert.equal((await list()).filter(entry => entry.content.startsWith('synthetic-burst-')).length, 20);
    assert.equal((await list()).some(entry => startIds.has(entry.id)), false);
    console.log('PASS 20/20 synthetic clipboard values at 220 ms intervals.');

    // A pre-clear read is released after clear and must fail the generation check.
    await invoke('clearHistory');
    text = '';
    let releaseRead;
    let readEntered = false;
    readHook = () => { readEntered = true; return new Promise(resolveRead => { releaseRead = resolveRead; }); };
    await wait(() => readEntered, 'in-flight text read');
    text = 'synthetic-current-at-clear';
    await invoke('clearHistory');
    releaseRead('synthetic-stale-before-clear');
    await delay(300);
    assert.equal((await list()).length, 0);
    console.log('PASS a pre-clear text read cannot restore an entry after clear.');

    // Oversized text gets a bounded, localized status and is not persisted.
    text = 'x'.repeat(2_000_001);
    await wait(async () => (await invoke('listCaptureIssues')).some(issue => issue.source === 'clipboard-text'),
      'oversize text status');
    await wait(() => hasVisibleIssue('clipboard-text'), 'visible oversize text status');
    assert.equal((await list()).some(entry => entry.content.length > 2_000_000), false);
    console.log('PASS oversized text is skipped with a visible capture issue.');

    // Storage errors are visible, throttled, and retried when storage recovers.
    await invoke('clearHistory');
    text = '';
    failTextWrites = true;
    text = 'synthetic-storage-failure';
    await wait(async () => (await invoke('listCaptureIssues')).some(issue => issue.source === 'clipboard-text'),
      'storage failure status');
    await wait(() => hasVisibleIssue('clipboard-text'), 'visible storage failure status');
    failTextWrites = false;
    await wait(async () => (await list()).some(entry => entry.content === 'synthetic-storage-failure'),
      'capture after storage recovery', 5_000);
    console.log('PASS storage failure is visible and capture recovers after storage is available.');

    // A stalled asynchronous provider is bounded; later clipboard values can still be sampled.
    await invoke('clearHistory');
    text = '';
    let stalledReadEntered = false;
    readHook = () => { stalledReadEntered = true; return new Promise(() => {}); };
    await wait(() => stalledReadEntered, 'stalled text provider');
    text = 'synthetic-after-stalled-read';
    await wait(async () => (await list()).some(entry => entry.content === text), 'text capture after read timeout', 5_000);
    console.log('PASS a stalled text provider times out and later clipboard changes remain capturable.');

    // A non-file URI list that contains an HTTP URL must not suppress its text entry.
    await invoke('clearHistory');
    const url = 'https://example.invalid/synthetic';
    text = url;
    items = [{ types: ['text/uri-list'], getType: async () => new Blob([url]) }];
    await wait(async () => (await list()).some(entry => entry.content === url), 'HTTP URI-list text');
    assert.equal((await list()).find(entry => entry.content === url)?.kind, 'link');
    console.log('PASS an HTTP URI-list with text/plain is retained as a link.');
    items = [];
    text = '';

    // Renderer recovery is bounded and reloads the same window after a forced test crash.
    let rendererGone = false;
    let rendererReloaded = false;
    window.webContents.once('render-process-gone', () => { rendererGone = true; });
    window.webContents.once('did-finish-load', () => { rendererReloaded = true; });
    window.webContents.forcefullyCrashRenderer();
    await wait(() => rendererGone, 'renderer process exit');
    await wait(() => rendererReloaded, 'renderer recovery', 10_000);
    assert.equal(window.webContents.isCrashed(), false);
    assert.equal(await evaluate('Boolean(window.gpaster)'), true);
    console.log('PASS a renderer crash reloads the window once without restarting the main process.');

  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    app.emit('before-quit');
    for (const window of BrowserWindow.getAllWindows()) window.destroy();
    await fsp.rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    app.quit();
  }
});
