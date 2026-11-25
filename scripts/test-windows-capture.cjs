const assert = require("node:assert/strict");
const { mkdtemp, mkdir, readFile, writeFile } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const { resolve, join } = require("node:path");
const { setTimeout: delay } = require("node:timers/promises");
const { app, BrowserWindow, clipboard, ClipboardItem, desktopCapturer, dialog, globalShortcut, nativeImage, screen, Tray } = require("electron");

const installed = process.env.GPASTER_CAPTURE_TEST_INSTALLED;
const root = installed ? join(installed, "app.asar") : resolve(__dirname, "..");
if (installed) {
  Object.defineProperty(app, "isPackaged", { get: () => true });
  Object.defineProperty(process, "resourcesPath", { value: installed });
}
const restartProfile = process.env.GPASTER_CAPTURE_TEST_RESTART;
const labels = { capture: "Control+Shift+F9", panel: "Control+Shift+F10", nextCapture: "Control+Shift+F11" };
let contents = [], copied = "", prompts = [], nativeMenu;
const shortcuts = new Map();
const register = globalShortcut.register.bind(globalShortcut);
globalShortcut.register = (key, callback) => {
  const registered = register(key, callback);
  if (registered) shortcuts.set(key, callback);
  return registered;
};
clipboard.read = async () => contents;
clipboard.readText = async () => copied;
clipboard.has = async type => contents.some(item => item.types.includes(type));
clipboard.writeText = async text => { copied = text; contents = []; };
dialog.showMessageBox = async options => { prompts.push(options); return { response: 0 }; };
const setContextMenu = Tray.prototype.setContextMenu;
Tray.prototype.setContextMenu = function (menu) { nativeMenu = menu; return setContextMenu.call(this, menu); };

async function until(check, label, ms = 20000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const value = await check();
    if (value) return value;
    await delay(60);
  }
  throw new Error("Timed out waiting for " + label);
}

async function run() {
  assert.equal(process.platform, "win32");
  const profile = restartProfile || await mkdtemp(join(tmpdir(), "gpaster-win-capture-"));
  const data = join(profile, "data");
  const files = join(profile, "files");
  await mkdir(data, { recursive: true });
  await mkdir(files, { recursive: true });
  if (!restartProfile) {
    await writeFile(join(data, "preferences.json"), JSON.stringify([{ shortcut: labels.panel, language: "en" }]));
  }
  app.setPath("userData", data);
  app.setPath("desktop", files);
  app.setPath("pictures", files);
  app.getAppPath = () => root;
  require(join(root, "dist-electron/electron/main.js"));
  await app.whenReady();
  const panel = await until(async () => {
    const window = BrowserWindow.getAllWindows().find(candidate => candidate.webContents.getURL().includes("/dist/index.html"));
    return window && !window.webContents.isLoading() && await window.webContents.executeJavaScript("Boolean(window.gpaster)") && window;
  }, "real renderer and preload");
  const evaluate = code => panel.webContents.executeJavaScript(code);
  const api = (method, ...args) => evaluate(`window.gpaster[${JSON.stringify(method)}](...${JSON.stringify(args)})`);
  assert.ok(nativeMenu.items.some(item => item.label === "Capture region"));
  assert.ok(globalShortcut.isRegistered(labels.panel));
  if (restartProfile) {
    assert.ok(globalShortcut.isRegistered(labels.nextCapture));
    assert.equal((await api("getPreferences")).captureShortcut, labels.nextCapture);
    await until(async () => Object.values(await api("listImageText")).some(text => text.includes("417")), "cached OCR after restart");
    assert.ok((await api("listHistory")).some(item => item.sources?.includes("screenshot")));
    console.log("PASS screenshot, OCR cache and shortcut across restart");
    return;
  }
  assert.ok(globalShortcut.isRegistered(labels.capture));
  assert.equal((await api("setCaptureShortcut", labels.panel)).error, "shortcut-conflict");
  assert.ok(register(labels.nextCapture, () => {}));
  assert.equal((await api("setCaptureShortcut", labels.nextCapture)).error, "shortcut-conflict");
  assert.ok(globalShortcut.isRegistered(labels.capture));
  globalShortcut.unregister(labels.nextCapture);
  const display = screen.getPrimaryDisplay();
  console.log("Display count %d, primary scale %d, bounds %j", screen.getAllDisplays().length, display.scaleFactor, display.bounds);
  assert.equal(display.id, screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).id, "Place the OS pointer on the primary test display");
  const showPanel = async () => {
    if (!panel.isVisible()) shortcuts.get(labels.panel)();
    await until(() => panel.isVisible(), "application panel visible");
  };
  const select = async index => {
    await evaluate(`document.querySelectorAll(".module-tab")[${index}].click()`);
    await until(() => evaluate(`document.querySelectorAll(".module-tab")[${index}].getAttribute("aria-pressed") === "true"`), "select module");
  };
  const search = query => evaluate(`(() => {
    const input = document.querySelector(".search-wrap input");
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, ${JSON.stringify(query)});
    input.dispatchEvent(new Event("input", { bubbles: true }));
  })()`);
  const oldGetSources = desktopCapturer.getSources.bind(desktopCapturer);
  desktopCapturer.getSources = async () => { throw Object.assign(new Error("fixture denied"), { code: "EACCES" }); };
  shortcuts.get(labels.capture)();
  await until(() => prompts.length === 1, "access failure feedback");
  assert.match(prompts[0].detail, /denied access/i);
  desktopCapturer.getSources = oldGetSources;
  const bounds = display.workArea;
  const fixture = new BrowserWindow({ ...bounds, frame: false, alwaysOnTop: true, show: false, skipTaskbar: true });
  await fixture.loadURL("data:text/html," + encodeURIComponent('<body style="margin:0;background:white;color:black;font: bold 64px Arial"><div style="padding:32px">WINDOWS OCR 417</div></body>'));
  fixture.setAlwaysOnTop(true, "screen-saver");
  fixture.show();
  fixture.setBounds(bounds);
  fixture.moveTop();
  await delay(850);
  const actual = fixture.getContentBounds();
  const overlay = async () => {
    fixture.moveTop();
    await delay(250);
    shortcuts.get(labels.capture)();
    return until(async () => {
      const window = BrowserWindow.getAllWindows().find(candidate => candidate.webContents.getURL().includes("region-capture.html"));
      return window?.isVisible() && await window.webContents.executeJavaScript("document.querySelector('#backdrop').naturalWidth > 0") && window;
    }, "native desktop overlay with frozen capture");
  };
  const finish = (window, action, rect) => {
    const request = `window.regionCapture.finish(${JSON.stringify(action)}, ${JSON.stringify(rect ?? null)})`;
    return window.webContents.executeJavaScript(request).catch(error => { if (!window.isDestroyed()) throw error; });
  };
  const rectFor = (window, y, height) => {
    const viewport = window.getContentBounds();
    return { x: actual.x - viewport.x + 12, y: actual.y - viewport.y + y, width: 790, height };
  };
  const feedback = async text => until(async () => {
    const match = BrowserWindow.getAllWindows().find(candidate =>
      candidate.isVisible() && candidate.webContents.getURL().includes(encodeURIComponent(text)));
    return match;
  }, "feedback: " + text);
  let selection = await overlay();
  await finish(selection, "cancel");
  await until(() => selection.isDestroyed(), "close selection");
  assert.equal((await api("listHistory")).length, 0);

  selection = await overlay();
  await finish(selection, "save", rectFor(selection, 12, 138));
  const savedToast = await feedback("Screenshot saved");
  const saved = await until(async () => (await api("listHistory")).find(item => item.sources?.includes("screenshot")), "saved screenshot");
  await until(async () => (await api("listImageText"))["image:" + saved.id]?.includes("417"), "background OCR");
  panel.webContents.backgroundThrottling = false;
  await showPanel();
  await select(2);
  await until(() => evaluate('Boolean(document.querySelector(".image-card .entry-actions button"))'), "saved screenshot card");
  await evaluate('document.querySelector(".image-card .entry-actions button").click()');
  const phrase = await until(async () => (await api("listPhrases"))[0], "image phrase saved by renderer");
  await until(() => evaluate('Boolean(document.querySelector(".notice-message"))'), "image phrase save notice");
  await until(async () => (await api("listImageText"))["phrase:" + phrase.id]?.includes("417"), "image phrase OCR");
  await search("WINDOWS OCR 417");
  await until(() => evaluate('document.querySelectorAll(".image-card").length === 1'), "screenshot search matches OCR text");
  await search("DOESNOTEXIST");
  await until(() => evaluate('document.querySelectorAll(".image-card").length === 0'), "screenshot search excludes non-matches");
  await select(1);
  await search("WINDOWS OCR 417");
  await until(() => evaluate('document.querySelectorAll(".phrase-list li").length === 1'), "phrase search matches OCR text");
  await until(() => savedToast.isDestroyed(), "three-second capture success feedback", 4500);
  await until(() => evaluate('!document.querySelector(".notice-message")'), "three-second phrase success feedback", 4500);
  await select(2);
  await evaluate('document.querySelector(".image-card .entry-actions button").click()');
  await until(() => evaluate('Boolean(document.querySelector(".notice-message"))'), "second phrase save notice");
  panel.close();
  shortcuts.get(labels.panel)();
  await until(() => evaluate('!document.querySelector(".notice-message")'), "phrase success feedback cleared by hiding panel");
  panel.close();

  selection = await overlay();
  await finish(selection, "text", rectFor(selection, 12, 138));
  await feedback("Text copied");
  assert.match(copied, /WINDOWS OCR 417/i);

  selection = await overlay();
  await finish(selection, "text", rectFor(selection, 190, 110));
  await feedback("No text recognized");
  assert.match(copied, /WINDOWS OCR 417/i, "empty OCR leaves the clipboard alone");
  fixture.destroy();
  const png = await readFile(join(data, "images", saved.id + ".png"));
  contents = [new ClipboardItem({ "image/png": new Blob([png], { type: "image/png" }) })];
  await until(async () => (await api("listHistory")).some(item => item.id === saved.id && item.sources.includes("clipboard")), "isolated clipboard image capture");
  await showPanel();
  await select(0);
  await search("WINDOWS OCR 417");
  await until(() => evaluate('document.querySelectorAll(".history-thumb-button").length === 1'), "clipboard image search matches OCR text");
  await search("");
  await select(2);
  nativeMenu.items[1].click();
  await until(() => evaluate('Boolean(document.querySelector(".settings-panel"))'), "open settings from tray");
  panel.close();
  shortcuts.get(labels.panel)();
  await until(() => evaluate('document.querySelectorAll(".module-tab")[2]?.getAttribute("aria-pressed") === "true"'), "remember screenshot module after settings");
  await api("updatePreferences", { rememberPage: false });
  nativeMenu.items[1].click();
  await until(() => evaluate('Boolean(document.querySelector(".settings-panel"))'), "reopen settings");
  panel.close();
  shortcuts.get(labels.panel)();
  await until(() => evaluate('document.querySelectorAll(".module-tab")[0]?.getAttribute("aria-pressed") === "true"'), "default module after settings with remember disabled");
  console.log("PASS image-text search in all three modules, phrase notice expiry/hide and settings page restoration");
  assert.equal(await api("deletePhrase", phrase.id), true);
  await until(async () => !("phrase:" + phrase.id in await api("listImageText")), "deleted phrase OCR cleanup");
  assert.equal((await api("setCaptureShortcut", labels.nextCapture)).error, null);
  assert.ok(globalShortcut.isRegistered(labels.nextCapture));
  assert.equal(globalShortcut.isRegistered(labels.capture), false);
  console.log("PASS native capture, crop, save, OCR copy, empty OCR, cancel, access retry, clipboard image, phrase index and OS shortcut conflicts");
  const persisted = join(data, "image-text-index.json");
  await until(async () => (await readFile(persisted, "utf8").catch(() => "")).includes("417"), "OCR cache persisted");
  console.log("CAPTURE_TEST_PROFILE=" + profile);
}

run().then(() => app.quit(), error => {
  console.error(error);
  app.exit(1);
});
