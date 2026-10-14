// Controlled OS API inputs and per-process theme overrides; never changes macOS settings.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { mkdtempSync } = fs;
const { readFile, rm, writeFile, mkdir } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { dirname, join, resolve } = require('node:path');
const { createHash } = require('node:crypto');
const { setTimeout: delay } = require('node:timers/promises');
const { app, BrowserWindow, clipboard, globalShortcut, nativeTheme, Tray } = require('electron');
const root = process.env.GPASTER_TEST_APP_PATH || resolve(__dirname, '..');
const directory = mkdtempSync(join(tmpdir(), 'gpaster-system-mode-'));
const data = join(directory, 'data'), screenshots = join(directory, 'screenshots');
const captures = resolve(process.env.GPASTER_TEST_CAPTURES || 'work/system-mode/previews');
fs.mkdirSync(join(data, 'images'), { recursive: true }); fs.mkdirSync(screenshots);
app.setPath('userData', data); app.setPath('desktop', screenshots); app.getAppPath = () => root;
let preferred = ['en-US'], locale = 'en-US', menu;
app.getPreferredSystemLanguages = () => preferred;
app.getSystemLocale = () => locale;
BrowserWindow.prototype.show = function () {};
BrowserWindow.prototype.focus = function () {};
globalShortcut.register = () => true;
clipboard.read = async () => []; clipboard.readText = async () => '';
clipboard.writeText = async () => undefined;
const childProcess = require('node:child_process'), originalExec = childProcess.execFileSync;
childProcess.execFileSync = (file, args, options) => file === 'defaults' && args?.[1] === 'com.apple.screencapture' ? screenshots : originalExec(file, args, options);
const originalMenu = Tray.prototype.setContextMenu;
Tray.prototype.setContextMenu = function (next) { menu = next; return originalMenu.call(this, next); };
const now = Date.now();
const history = [
  { id: 'text-1', content: 'Quick ideas, ready when you need them.', kind: 'text', createdAt: now, copiedAt: now },
  { id: 'link-1', content: 'https://example.com', kind: 'link', createdAt: now - 1000, copiedAt: now - 1000 },
  { id: 'text-2', content: '保存', kind: 'text', createdAt: now - 2000, copiedAt: now - 2000 }
];
const phrases = [
  { id: 'phrase-1', text: 'Thanks — received.', category: '未分类', createdAt: now, updatedAt: now },
  { id: 'phrase-2', text: '收到，谢谢。', category: '工作', createdAt: now, updatedAt: now }
];
fs.writeFileSync(join(data, 'history.json'), JSON.stringify(history));
fs.writeFileSync(join(data, 'phrases.json'), JSON.stringify(phrases));
const png = fs.readFileSync(join(root, 'assets/G-paster-brand.png'));
fs.writeFileSync(join(data, 'images/theme-image.png'), png);
fs.writeFileSync(join(data, 'image-history.json'), JSON.stringify([{ id: 'image-1', hash: createHash('sha256').update(png).digest('hex'), fileName: 'theme-image.png', width: 128, height: 128, createdAt: now - 3000, copiedAt: now - 3000, isFavorite: true }]));
require(join(root, 'dist-electron/electron/main.js'));
async function waitFor(check, label) {
  const deadline = Date.now() + 12000;
  while (Date.now() < deadline) { if (await check()) return; await delay(60); }
  throw new Error('Timeout: ' + label);
}
app.whenReady().then(async () => {
  app.dock?.hide(); await mkdir(captures, { recursive: true });
  let window;
  await waitFor(async () => { window = BrowserWindow.getAllWindows()[0]; return window && !window.webContents.isLoading() && await window.webContents.executeJavaScript('Boolean(window.gpaster && document.querySelector(".module-tabs"))'); }, 'renderer');
  const evaluate = code => window.webContents.executeJavaScript(code);
  window.webContents.backgroundThrottling = false;
  const snapshot = async (name) => {
    await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    await delay(180); // Existing 120 ms color transitions must finish before visual QA.
    await writeFile(join(captures, name), (await window.webContents.capturePage(undefined, { stayHidden: true })).toPNG());
  };
  assert.equal(nativeTheme.themeSource, 'system');
  assert.equal(await evaluate('window.gpaster.initialSystemSettings.language'), 'en');
  assert.equal((await evaluate('window.gpaster.getPreferences()')).language, 'system');
  assert.equal((await evaluate('window.gpaster.getPreferences()')).appearance, 'system');
  console.log('PASS default system-follow startup and English initial snapshot');
  const setLanguage = async lang => {
    preferred = lang === 'zh' ? ['zh-Hans-CN'] : ['en-US']; locale = lang === 'zh' ? 'zh-CN' : 'en-US';
    await evaluate('window.gpaster.getSystemSettings()');
    await waitFor(() => evaluate(`document.documentElement.lang === ${JSON.stringify(lang === 'zh' ? 'zh-CN' : 'en')}`), 'language update');
  };
  for (const lang of ['en', 'zh']) for (const theme of ['light', 'dark']) {
    await setLanguage(lang); nativeTheme.themeSource = theme;
    const dark = theme === 'dark';
    const background = dark ? 'rgb(23, 26, 31)' : 'rgb(230, 235, 242)';
    await waitFor(() => evaluate(`getComputedStyle(document.documentElement).backgroundColor === ${JSON.stringify(background)} && matchMedia('(prefers-color-scheme: dark)').matches === ${dark}`), 'system theme update');
    await waitFor(() => window.getBackgroundColor().toLowerCase().endsWith(dark ? '171a1f' : 'e6ebf2'), 'native window background');
    const labels = await evaluate('Array.from(document.querySelectorAll(".module-tab > span:first-of-type")).map(e => e.textContent)');
    assert.deepEqual(labels, lang === 'en' ? ['Clipboard', 'Phrases', 'Screenshots'] : ['剪贴板', '常用语', '截图']);
    assert.equal(menu.items[0].label, lang === 'en' ? 'Open G-paster' : '打开 G-paster');
    assert.equal(menu.items[1].label, lang === 'en' ? 'Settings' : '设置');
    assert.equal(menu.items[3].label, lang === 'en' ? 'Quit G-paster' : '退出 G-paster');
    assert.equal(await evaluate('Array.from(document.querySelectorAll(".entry-preview")).some(e => e.textContent === "保存")'), true);
    assert.equal(await evaluate('Array.from(document.querySelectorAll(".module-tab")).every(b => Array.from(b.children).every(c => c.getBoundingClientRect().right <= b.getBoundingClientRect().right + 1))'), true);
    assert.equal(await evaluate('getComputedStyle(document.querySelector(".gpaster-brand-image")).filter'), dark ? 'brightness(0) invert(1)' : 'none');
    assert.equal(await evaluate('getComputedStyle(document.querySelector(".history-thumb")).filter'), 'none');
    await snapshot(`${lang}-${theme}-history.png`);
    assert.equal(await evaluate('getComputedStyle(document.querySelector(".module-tab.active")).backgroundColor'), dark ? 'rgb(32, 35, 43)' : 'rgb(255, 255, 255)');
    console.log(`PASS ${lang}/${theme}: labels, tray, native background, brand contrast, layout and original content`);
  }
  await setLanguage('en'); nativeTheme.themeSource = 'dark';
  const search = async query => {
    await evaluate(`{ const input = document.querySelector('.search-wrap input'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(query)}); input.dispatchEvent(new Event('input', {bubbles:true})); }`);
  };
  await search('图片');
  await waitFor(() => evaluate('document.querySelectorAll(".history-thumb").length === 1 && document.querySelectorAll(".entry-preview").length === 1'), 'original image keyword search');
  await search('Image');
  await waitFor(() => evaluate('document.querySelectorAll(".history-thumb").length === 1 && document.querySelectorAll(".entry-preview").length === 1'), 'localized image keyword search');
  await search('');
  await evaluate('document.querySelectorAll(".module-tab")[1].click()');
  await waitFor(() => evaluate('Boolean(document.querySelector(".phrase-list"))'), 'phrases');
  assert.equal(await evaluate('document.querySelector(".phrase-meta").textContent'), 'Uncategorized');
  assert.equal(await evaluate('Array.from(document.querySelectorAll(".phrase-meta")).some(e => e.textContent === "工作")'), true);
  await search('未分类');
  await waitFor(() => evaluate('document.querySelectorAll(".phrase-meta").length === 1 && document.querySelector(".phrase-meta").textContent === "Uncategorized"'), 'original category keyword search');
  await search('Uncategorized');
  await waitFor(() => evaluate('document.querySelectorAll(".phrase-meta").length === 1 && document.querySelector(".phrase-meta").textContent === "Uncategorized"'), 'localized category keyword search');
  await search('');
  console.log('PASS English UI search matches original and localized image/category labels');
  await snapshot('en-dark-phrases.png');
  await evaluate('document.querySelector(".module-toolbar .primary-button").click()');
  await waitFor(() => evaluate('Boolean(document.querySelector(".phrase-dialog"))'), 'phrase editor');
  assert.equal(await evaluate('document.querySelector("#phrase-category").value'), 'Uncategorized');
  await evaluate(`const input = document.querySelector('#phrase-content'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(input, 'Draft stays intact.'); input.dispatchEvent(new Event('input', {bubbles:true}));`);
  await snapshot('en-dark-editor.png');
  await setLanguage('zh'); nativeTheme.themeSource = 'light';
  assert.equal(await evaluate('document.querySelector("#phrase-content").value'), 'Draft stays intact.');
  assert.equal(await evaluate('document.querySelector("#phrase-category").value'), '未分类');
  await evaluate('document.querySelector(".phrase-dialog").requestSubmit()');
  await waitFor(() => evaluate('!document.querySelector(".phrase-dialog")'), 'phrase save');
  const saved = await evaluate('window.gpaster.listPhrases()');
  assert.equal(saved.find(p => p.text === 'Draft stays intact.').category, '未分类');
  assert.deepEqual(saved.filter(p => p.id.startsWith('phrase-')), phrases);
  console.log('PASS live language/theme change preserves draft and stored custom categories');
  await setLanguage('en'); nativeTheme.themeSource = 'dark';
  await evaluate('document.querySelectorAll(".module-tab")[2].click()');
  await waitFor(() => evaluate('Boolean(document.querySelector(".image-grid"))'), 'screenshot grid');
  await search('图片');
  await waitFor(() => evaluate('document.querySelectorAll(".image-preview-button").length === 1'), 'screenshot original keyword search');
  await search('');
  await snapshot('en-dark-screenshots.png');
  await evaluate('document.querySelector(".image-preview-button").click()');
  await waitFor(() => evaluate('Boolean(document.querySelector(".image-dialog"))'), 'image preview');
  assert.equal(await evaluate('document.querySelector(".image-dialog").getAttribute("aria-label")'), 'Image preview');
  assert.equal(await evaluate('getComputedStyle(document.querySelector(".image-dialog")).backgroundColor'), 'rgba(27, 30, 31, 0.96)');
  await snapshot('en-dark-preview.png');
  assert.equal(await evaluate('Array.from(document.querySelectorAll("button")).some(b => /[\\u4e00-\\u9fff]/.test(b.textContent))'), false);
  console.log('PASS dark image preview and controls fully localized');
  assert.deepEqual(JSON.parse(await readFile(join(data, 'history.json'), 'utf8')), history);
  nativeTheme.themeSource = 'system';
  console.log(`PASS system appearance/language application tests (isPackaged=${app.isPackaged})`);
}).finally(async () => { await rm(directory, { recursive: true, force: true }); }).then(() => app.quit()).catch(error => { console.error(error); app.exit(1); });
