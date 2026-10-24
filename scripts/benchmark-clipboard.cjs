// Real main/preload/renderer; synthetic clipboard and private temporary storage.
// CPU/RSS belong to this main process, not the whole Electron app or native pasteboard.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const { join, resolve } = require('node:path');
const { pathToFileURL } = require('node:url');
const { performance } = require('node:perf_hooks');
const { setTimeout: delay } = require('node:timers/promises');
const { app, BrowserWindow, clipboard, globalShortcut, nativeImage } = require('electron');
const root = resolve(__dirname, '..');
const directory = fs.mkdtempSync(join(os.tmpdir(), 'gpaster-clipboard-bench-'));
const screenshots = join(directory, 'screenshots');
fs.mkdirSync(screenshots);
app.setPath('userData', join(directory, 'data'));
app.setPath('desktop', screenshots);
app.getAppPath = () => root;
BrowserWindow.prototype.show = function () {};
BrowserWindow.prototype.focus = function () {};
globalShortcut.register = () => true;
const childProcess = require('node:child_process');
const originalExec = childProcess.execFileSync;
childProcess.execFileSync = (file, args, options) => file === 'defaults' && args?.[1] === 'com.apple.screencapture'
  ? screenshots : originalExec(file, args, options);
let text = '', items = [], entries = [], pending = null;
const capturedText = new Set();
const calls = { readText: 0, read: 0, has: 0, getType: 0, arrayBuffer: 0, payloadBytes: 0 };
clipboard.readText = async () => { calls.readText++; return text; };
clipboard.read = async () => { calls.read++; return items; };
clipboard.has = async type => { calls.has++; return items.some(item => item.types.includes(type)); };
clipboard.writeText = async value => { text = value; items = []; };
clipboard.write = async value => { items = value; text = ''; };
function item(type, bytes) {
  const blob = new Blob([new Uint8Array(bytes)]);
  return { types: [type], getType: async () => {
    calls.getType++;
    return { size: blob.size, arrayBuffer: async () => {
      calls.arrayBuffer++; calls.payloadBytes += blob.size;
      return blob.arrayBuffer();
    } };
  } };
}
const windows = [];
app.on('browser-window-created', (_event, window) => {
  windows.push(window);
  const originalSend = window.webContents.send.bind(window.webContents);
  window.webContents.send = (channel, ...args) => {
    if (channel === 'history:changed') {
      entries = args[0];
      for (const entry of entries) if (entry.kind === 'text') capturedText.add(entry.content);
      if (pending && entries.some(pending.matches)) {
        const completed = pending; pending = null;
        completed.resolve(performance.now() - completed.started);
      }
    }
    return originalSend(channel, ...args);
  };
});
const mainPath = process.env.GPASTER_BENCH_MAIN || join(root, 'dist-electron/electron/main.js');
require(mainPath);
async function wait(check, label, timeout = 12000) {
  const deadline = performance.now() + timeout;
  while (performance.now() < deadline) {
    if (await check()) return;
    await delay(10);
  }
  throw new Error('Timeout: ' + label);
}
function png(width, height, seed) {
  const pixels = Buffer.alloc(width * height * 4);
  let state = seed;
  for (let offset = 0; offset < pixels.length; offset += 4) {
    state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
    pixels[offset] = state & 255; pixels[offset + 1] = state >>> 8 & 255;
    pixels[offset + 2] = state >>> 16 & 255; pixels[offset + 3] = 255;
  }
  return nativeImage.createFromBitmap(pixels, { width, height }).toPNG();
}
async function capture(change, matches) {
  assert.equal(pending, null);
  const result = new Promise(resolve => { pending = { resolve, matches, started: performance.now() }; });
  change();
  await wait(() => pending === null, 'capture persisted and published');
  return result;
}
function summary(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return { count: values.length, meanMs: values.reduce((a, b) => a + b, 0) / values.length,
    p50Ms: sorted[Math.floor((sorted.length - 1) * .5)], p95Ms: sorted[Math.ceil(sorted.length * .95) - 1],
    maxMs: sorted.at(-1) };
}
async function measure(label, milliseconds) {
  const beforeCalls = { ...calls }, rss = [process.memoryUsage().rss];
  const sampler = setInterval(() => rss.push(process.memoryUsage().rss), 200);
  const cpu = process.cpuUsage(), started = performance.now();
  await delay(milliseconds);
  const elapsedMs = performance.now() - started, used = process.cpuUsage(cpu);
  clearInterval(sampler); rss.push(process.memoryUsage().rss);
  const result = { label, elapsedMs, cpuPercentOneCore: (used.user + used.system) / (elapsedMs * 10),
    rssMeanMiB: rss.reduce((a, b) => a + b, 0) / rss.length / 1048576,
    rssPeakMiB: Math.max(...rss) / 1048576,
    heapUsedMiB: process.memoryUsage().heapUsed / 1048576,
    api: Object.fromEntries(Object.keys(calls).map(key => [key, calls[key] - beforeCalls[key]])) };
  console.log('SAMPLE', JSON.stringify(result));
  return result;
}
app.whenReady().then(async () => {
  app.dock?.hide();
  await wait(async () => windows[0] && !windows[0].webContents.isLoading() &&
    await windows[0].webContents.executeJavaScript('Boolean(window.gpaster)'), 'renderer');
  const duration = Number(process.env.GPASTER_BENCH_MS || 10000);
  await delay(1500);
  const idle = await measure('idle-empty', duration);
  const resident = png(1280, 720, 0x12345678);
  await capture(() => { items = [item('image/png', resident)]; text = ''; },
    entry => entry.kind === 'image' && entry.width === 1280);
  await delay(1500);
  const image = await measure('resident-1280x720-png', duration);
  items = []; text = ''; await delay(100);
  const latency = { text: [], image: [], file: [] };
  for (let index = 0; index < 20; index++) {
    const value = `bench-latency-text-${index}`;
    latency.text.push(await capture(() => { text = value; items = []; }, entry => entry.kind === 'text' && entry.content === value));
  }
  for (let index = 0; index < 20; index++) {
    const bytes = png(128 + index, 96, index + 1);
    latency.image.push(await capture(() => { text = ''; items = [item('image/png', bytes)]; },
      entry => entry.kind === 'image' && entry.width === 128 + index && entry.height === 96));
  }
  for (let index = 0; index < 20; index++) {
    const file = join(directory, `fixture-${index}.txt`);
    await fsp.writeFile(file, 'synthetic file');
    const uri = Buffer.from(pathToFileURL(file).href);
    latency.file.push(await capture(() => { text = file; items = [item('text/uri-list', uri)]; },
      entry => entry.kind === 'file' && entry.files[0].originalPath === file));
  }
  const rapid = [], spacings = [];
  let previousStart;
  for (let index = 0; index < 100; index++) {
    const now = performance.now();
    if (previousStart !== undefined) spacings.push(now - previousStart);
    previousStart = now;
    const value = `bench-rapid-${index}`; rapid.push(value);
    items = []; text = value;
    await delay(240);
  }
  await delay(500);
  const output = {
    conditions: { syntheticClipboard: true, realMainPreloadRenderer: true, mainPath,
      electron: process.versions.electron, node: process.versions.node, platform: process.platform, arch: process.arch,
      osRelease: os.release(), cpu: os.cpus()[0].model, logicalCpus: os.cpus().length,
      durationMs: duration, residentPngBytes: resident.length, rendererHidden: true,
      latencySamplesPerType: 20, rapidRequestedIntervalMs: 240 },
    idle, residentImage: image,
    latency: Object.fromEntries(Object.entries(latency).map(([type, values]) => [type, summary(values)])),
    rapid: { total: rapid.length, captured: rapid.filter(value => capturedText.has(value)).length,
      actualSpacing: summary(spacings) }
  };
  if (process.env.GPASTER_BENCH_OUTPUT) await fsp.writeFile(process.env.GPASTER_BENCH_OUTPUT, JSON.stringify(output, null, 2));
  console.log('RESULT', JSON.stringify(output));
}).finally(async () => {
  app.emit('before-quit');
  for (const window of windows) if (!window.isDestroyed()) window.destroy();
  await fsp.rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}).then(() => app.quit()).catch(error => { console.error(error); app.exit(1); });
