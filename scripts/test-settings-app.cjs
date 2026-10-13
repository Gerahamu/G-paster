// Isolated data and controlled OS registration/login APIs; never alters host login items or clipboard.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { mkdtempSync } = fs;
const { readFile, rm, writeFile, mkdir } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');
const { app, BrowserWindow, clipboard, globalShortcut, nativeTheme, Tray, shell } = require('electron');
const root = process.env.GPASTER_TEST_APP_PATH || resolve(__dirname, '..');
const directory = mkdtempSync(join(tmpdir(), 'gpaster-settings-'));
const data = join(directory, 'data'), screenshots = join(directory, 'screenshots');
const captures = resolve(process.env.GPASTER_TEST_CAPTURES || 'work/settings/previews');
fs.mkdirSync(data); fs.mkdirSync(screenshots);
app.setPath('userData', data); app.setPath('desktop', screenshots); app.getAppPath = () => root;
app.getVersion = () => JSON.parse(fs.readFileSync(join(root, 'package.json'), 'utf8')).version;
let preferred = ['zh-Hans-CN'], text = '', menu, suspended = false;
app.getPreferredSystemLanguages = () => preferred;
app.getSystemLocale = () => 'en-US';
BrowserWindow.prototype.show = function () { this.showInactive(); };
BrowserWindow.prototype.focus = function () {};
const bindings = new Map();
globalShortcut.register = (key, callback) => {
  if (key === 'Control+X' || bindings.has(key) || suspended) return false;
  bindings.set(key, callback); return true;
};
globalShortcut.isRegistered = key => bindings.has(key);
globalShortcut.unregister = key => bindings.delete(key);
globalShortcut.unregisterAll = () => bindings.clear();
globalShortcut.setSuspended = value => { suspended = value; };
clipboard.read = async () => []; clipboard.readText = async () => text;
clipboard.writeText = async value => { text = value; };
let login = { openAtLogin: false, wasOpenedAtLogin: process.env.GPASTER_TEST_LOGIN_LAUNCH === '1', status: 'not-registered' }, loginFailure = false, approval = false;
app.getLoginItemSettings = () => login;
app.setLoginItemSettings = settings => {
  if (loginFailure) throw new Error('simulated native failure');
  login = { openAtLogin: settings.openAtLogin && !approval, wasOpenedAtLogin: false, status: settings.openAtLogin ? approval ? 'requires-approval' : 'enabled' : 'not-registered' };
};
let openedPath;
shell.openPath = async path => { openedPath = path; return ''; };
const childProcess = require('node:child_process'), originalExec = childProcess.execFileSync;
childProcess.execFileSync = (file, args, options) => file === 'defaults' && args?.[1] === 'com.apple.screencapture' ? screenshots : originalExec(file, args, options);
const originalMenu = Tray.prototype.setContextMenu;
Tray.prototype.setContextMenu = function (next) { menu = next; return originalMenu.call(this, next); };
require(join(root, 'dist-electron/electron/main.js'));
async function waitFor(check, label) {
  const deadline = Date.now() + 12000;
  while (Date.now() < deadline) { if (await check()) return; await delay(60); }
  throw new Error('Timeout: ' + label);
}
app.whenReady().then(async () => {
  app.dock?.hide(); await mkdir(captures, { recursive: true });
  let window;
  await waitFor(async () => { window = BrowserWindow.getAllWindows()[0]; return window && !window.webContents.isLoading() && await window.webContents.executeJavaScript('Boolean(window.gpaster && document.querySelector(".settings-entry"))'); }, 'renderer');
  const evaluate = code => window.webContents.executeJavaScript(code);
  window.webContents.backgroundThrottling = false;
  const snapshot = async name => { await delay(250); await writeFile(join(captures, name), (await window.webContents.capturePage(undefined, { stayHidden: true })).toPNG()); };
  const toggle = () => { assert.equal(suspended, false); const prefs = [...bindings.keys()][0]; bindings.get(prefs)(); };
  if (app.isPackaged && process.env.GPASTER_TEST_LOGIN_LAUNCH === '1') {
    assert.equal(window.isVisible(), false);
    console.log('PASS packaged login launch keeps the panel hidden until requested');
  }
  if (window.isVisible()) toggle();
  for (let i = 0; i < 4; i++) { toggle(); assert.equal(window.isVisible(), true); toggle(); assert.equal(window.isVisible(), false); }
  text = 'Capture continues with the window hidden.';
  await waitFor(async () => (await evaluate('window.gpaster.listHistory()')).some(item => item.content === text), 'hidden background capture');
  console.log('PASS registered callback toggles native window 8 times; clipboard listener remains active while hidden');
  toggle();
  await evaluate('document.querySelector(".settings-entry").click()');
  await waitFor(() => evaluate('Boolean(document.querySelector(".settings-switch"))'), 'settings loaded');
  await waitFor(() => window.getSize()[1] === 460, 'settings normal height');
  assert.equal(await evaluate('document.querySelectorAll(".settings-section").length'), 3);
  assert.equal(await evaluate('document.querySelector(".settings-switch").disabled'), !app.isPackaged);
  assert.equal(await evaluate('Object.keys(window.gpaster).some(k => /^set(Language|Theme|Appearance)$/.test(k))'), false);

  async function record(key, modifiers) {
    await evaluate('document.querySelector(".shortcut-control .settings-action").click()');
    await waitFor(() => suspended && evaluate('document.activeElement === document.querySelector(".recording")'), 'recording ready and focused');
    window.webContents.sendInputEvent({ type: 'keyDown', keyCode: key, modifiers });
    window.webContents.sendInputEvent({ type: 'keyUp', keyCode: key, modifiers });
    await waitFor(() => !suspended && evaluate('!document.querySelector(".recording")'), 'recording complete');
  }
  await record('X', ['control']);
  assert.equal((await evaluate('window.gpaster.getPreferences()')).shortcut, 'Control+C');
  assert.equal(bindings.has('Control+C'), true);
  await waitFor(() => evaluate('document.querySelector("[role=alert]")?.textContent.includes("已被占用")'), 'conflict feedback');
  await record('G', ['control', 'shift']);
  await waitFor(async () => (await evaluate('window.gpaster.getPreferences()')).shortcut === 'Control+Shift+G', 'new shortcut');
  assert.equal(bindings.has('Control+C'), false); assert.equal(bindings.has('Control+Shift+G'), true);
  assert.deepEqual(JSON.parse(await readFile(join(data, 'preferences.json'), 'utf8')), [{ shortcut: 'Control+Shift+G' }]);
  toggle(); assert.equal(window.isVisible(), false); toggle(); assert.equal(window.isVisible(), true);
  await waitFor(() => evaluate('Boolean(document.querySelector(".module-tabs"))'), 'normal panel on reopen');
  menu.items[1].click();
  await waitFor(() => evaluate('Boolean(document.querySelector(".settings-switch"))'), 'tray settings entry');
  await evaluate('document.querySelector(".settings-link").click()');
  await waitFor(async () => (await evaluate('window.gpaster.getPreferences()')).shortcut === 'Control+C', 'default reset');
  console.log('PASS secure IPC, real renderer shortcut capture, conflict rollback, persistence, reset, tray settings entry');

  await evaluate('document.querySelector(".shortcut-control .settings-action").click()');
  await waitFor(() => suspended && evaluate('document.activeElement === document.querySelector(".recording")'), 'recording ready and focused');
  window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
  window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
  await waitFor(() => !suspended && evaluate('!document.querySelector(".recording") && Boolean(document.querySelector(".settings-panel"))'), 'Escape cancels recording');
  await evaluate('document.querySelector(".shortcut-control .settings-action").click()');
  await waitFor(() => suspended && evaluate('document.activeElement === document.querySelector(".recording")'), 'recording again and focused');
  window.emit('blur'); assert.equal(window.isVisible(), false); assert.equal(suspended, false);
  toggle(); assert.equal(window.isVisible(), true);
  console.log('PASS Esc cancellation and blur hiding restore shortcut handling');
  menu.items[1].click();
  await waitFor(() => evaluate('Boolean(document.querySelector(".settings-switch"))'), 'settings again');
  if (app.isPackaged) {
    await evaluate('document.querySelector(".settings-switch").click()');
    await waitFor(() => evaluate('document.querySelector(".settings-switch").getAttribute("aria-checked") === "true" && !document.querySelector(".settings-switch").disabled'), 'login enable');
    assert.equal(login.openAtLogin, true);
    await evaluate('document.querySelector(".settings-switch").click()');
    await waitFor(() => !login.openAtLogin && evaluate('!document.querySelector(".settings-switch").disabled'), 'login disable');
    approval = true;
    await evaluate('document.querySelector(".settings-switch").click()');
    await waitFor(() => evaluate('document.querySelector(".settings-copy").closest(".settings-group").textContent.includes("系统登录项")'), 'approval feedback');
    await evaluate('document.querySelector(".settings-switch").click()');
    await waitFor(() => login.status === 'not-registered' && evaluate('!document.querySelector(".settings-switch").disabled'), 'approval cancel');
    approval = false; loginFailure = true;
    await evaluate('document.querySelector(".settings-switch").click()');
    await waitFor(() => evaluate('Boolean(document.querySelector("[role=alert]"))'), 'native login failure');
    assert.equal(login.openAtLogin, false); loginFailure = false;
    console.log('PASS packaged login UI controlled native API: enable/disable, system approval and failure readback');
  } else {
    assert.equal((await evaluate('window.gpaster.setOpenAtLogin(true)')).error, 'login-unavailable');
    assert.equal(login.openAtLogin, false);
    console.log('PASS development mode cannot register Electron itself as a login item');
  }
  assert.equal(await evaluate('window.gpaster.openDataDirectory()'), true); assert.equal(openedPath, data);
  assert.equal((await evaluate('window.gpaster.getPreferences()')).imageLimit, 10);
  assert.equal((await evaluate('window.gpaster.getPreferences()')).textLimit, 300);
  await evaluate('window.dispatchEvent(new Event("focus"))');
  await waitFor(() => evaluate('!document.querySelector("[role=alert]")'), 'settings refresh clears resolved errors');
  // Captures exercise the same settings UI across both languages and appearances.
  for (const lang of ['zh', 'en']) for (const theme of ['light', 'dark']) {
    preferred = lang === 'zh' ? ['zh-Hans-CN'] : ['en-US'];
    await evaluate('window.gpaster.getSystemSettings()'); nativeTheme.themeSource = theme;
    await waitFor(() => evaluate(`document.querySelector('.settings-heading h1').textContent === ${JSON.stringify(lang === 'zh' ? '设置' : 'Settings')}`), 'localized settings');
    assert.equal(await evaluate('Array.from(document.querySelectorAll(".settings-row > *")).every(e => e.getBoundingClientRect().right <= document.querySelector(".settings-scroll").getBoundingClientRect().right + 1)'), true);
    await snapshot(`${lang}-${theme}.png`);
    await evaluate('document.querySelector(".settings-scroll").scrollTop = document.querySelector(".settings-scroll").scrollHeight');
    await snapshot(`${lang}-${theme}-storage.png`);
    await evaluate('document.querySelector(".settings-scroll").scrollTop = 0');
  }
  await evaluate('document.querySelector(".settings-back").click()');
  await waitFor(() => evaluate('Boolean(document.querySelector(".module-tabs"))'), 'return to history');
  assert.equal((await evaluate('window.gpaster.listHistory()')).some(item => item.content === text), true);
  nativeTheme.themeSource = 'system';
  console.log(`PASS settings language/theme/layout, fixed data folder and preserved history (isPackaged=${app.isPackaged})`);
}).finally(async () => { await rm(directory, { recursive: true, force: true }); }).then(() => app.quit()).catch(error => { console.error(error); app.exit(1); });
