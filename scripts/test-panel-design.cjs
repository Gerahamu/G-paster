// Visual acceptance uses generated browser-like fixtures, isolated storage and controlled OS APIs.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { join, resolve } = require('node:path');
const { tmpdir } = require('node:os');
const { createHash } = require('node:crypto');
const { setTimeout: delay } = require('node:timers/promises');
const { app, BrowserWindow, clipboard, globalShortcut, nativeTheme, nativeImage } = require('electron');
const root = process.env.GPASTER_TEST_APP_PATH || resolve(__dirname, '..');
const directory = fs.mkdtempSync(join(tmpdir(), 'gpaster-panel-design-'));
const data = join(directory, 'data'), screenshots = join(directory, 'screenshots');
const captures = resolve(process.env.GPASTER_TEST_CAPTURES || 'work/redesign/previews');
for (const path of [join(data, 'images'), screenshots, captures]) fs.mkdirSync(path, { recursive: true });
app.setPath('userData', data); app.setPath('desktop', screenshots); app.getAppPath = () => root;
app.on('window-all-closed', () => {});
app.getVersion = () => JSON.parse(fs.readFileSync(join(root, 'package.json'), 'utf8')).version;
app.getPreferredSystemLanguages = () => ['zh-Hans-CN']; app.getSystemLocale = () => 'zh-CN';
clipboard.read = async () => []; clipboard.readText = async () => '';
globalShortcut.register = () => true; globalShortcut.isRegistered = () => true;
BrowserWindow.prototype.show = function () {}; BrowserWindow.prototype.focus = function () {};
const childProcess = require('node:child_process'), originalExec = childProcess.execFileSync;
childProcess.execFileSync = (file, args, options) => file === 'defaults' && args?.[1] === 'com.apple.screencapture' ? screenshots : originalExec(file, args, options);

async function waitFor(check, label) {
  const deadline = Date.now() + 12000;
  while (Date.now() < deadline) { if (await check()) return; await delay(60); }
  throw new Error('Timeout: ' + label);
}

app.whenReady().then(async () => {
  app.dock?.hide();
  const fixtureWindow = new BrowserWindow({ width: 1400, height: 900, show: false, webPreferences: { sandbox: true, nodeIntegration: false, backgroundThrottling: false } });
  await fixtureWindow.loadURL('data:text/html,<canvas id="fixture" width="1400" height="900"></canvas>');
  const titles = ['Ideas & notes', 'Project workspace', 'Conversation', 'Design library', 'Weekly overview', 'Local files', 'Reading list', 'G-paster', 'Quick phrases', 'Screenshot collection'];
  const records = [];
  for (let i = 0; i < 10; i++) {
    const url = await fixtureWindow.webContents.executeJavaScript(`(() => {
      const canvas = document.querySelector('canvas'), c = canvas.getContext('2d');
      c.fillStyle = '#f7f9fc'; c.fillRect(0,0,1400,900);
      c.fillStyle = ${JSON.stringify(i % 2 ? '#306e95' : '#557545')}; c.fillRect(0,0,1400,24);
      c.fillStyle = '#fff'; c.font = '12px sans-serif'; c.fillText('Finder     File     Edit     View     Window', 18,17);
      c.fillStyle = '#e9edf4'; c.fillRect(0,24,1400,40);
      for (const [x, color] of [[20,'#ff6259'],[40,'#fcbc30'],[60,'#34c749']]) { c.fillStyle=color; c.beginPath(); c.arc(x,44,6,0,Math.PI*2);c.fill(); }
      c.fillStyle = '#fff'; c.fillRect(92,31,290,30);
      c.fillStyle = '#56657b'; c.font='14px sans-serif'; c.fillText(${JSON.stringify(titles[i])},110,51);
      c.fillStyle = '#fff'; c.fillRect(0,64,1400,42); c.fillStyle='#eef1f6';c.fillRect(110,72,1150,26);
      c.fillStyle='#758398'; c.font='13px sans-serif'; c.fillText('⌕   local workspace / preview',130,90);
      c.fillStyle='#fff';c.fillRect(0,107,1400,793);c.fillStyle='#edf2f7';c.fillRect(0,107,200,793);
      c.fillStyle='#344459'; c.font='bold 19px sans-serif';c.fillText(${JSON.stringify(titles[i])},225,149);
      c.fillStyle='#8a99aa';c.font='15px sans-serif';c.fillText('Generated sample content for visual testing',225,181);
      for(let row=0;row<7;row++){ c.fillStyle='#cdd8e5';c.fillRect(20,135+row*40,130-(row%3)*16,9); c.fillStyle=row%2?'#f2f5fa':'#eaf0f7';c.fillRect(225,214+row*67,930,49);c.fillStyle='#b3c1d1';c.fillRect(246,231+row*67,310+row*25,8); }
      return canvas.toDataURL('image/png');
    })()`);
    const bytes = Buffer.from(url.split(',')[1], 'base64'), id = `fixture-${i}`;
    fs.writeFileSync(join(data, 'images', `${id}.png`), bytes);
    records.push({ id, hash: createHash('sha256').update(bytes).digest('hex'), fileName: `${id}.png`, width: 1400, height: 900, createdAt: Date.now()-i*1000, copiedAt: Date.now()-i*1000, isFavorite: false });
  }
  fixtureWindow.destroy();
  fs.writeFileSync(join(data,'image-history.json'), JSON.stringify(records));
  fs.writeFileSync(join(data,'history.json'), JSON.stringify(Array.from({length:28}, (_,i) => ({ id:`text-${i}`,content:i===0?'把刚刚的灵感留在这里。':i===1?'https://example.com':`项目记录 ${i+1}`,kind:i===1?'link':'text',createdAt:Date.now()-i*1000,copiedAt:Date.now()-i*1000 }))));
  fs.writeFileSync(join(data,'phrases.json'), JSON.stringify([{id:'phrase-1',text:'收到，谢谢。我稍后回复你。',category:'回复',createdAt:Date.now(),updatedAt:Date.now()}]));
  require(join(root,'dist-electron/electron/main.js'));
  let window;
  await waitFor(async()=>{window=BrowserWindow.getAllWindows()[0];return window&&!window.webContents.isLoading()&&await window.webContents.executeJavaScript('document.querySelectorAll(".module-tab").length===3');},'product renderer');
  const evaluate = code => window.webContents.executeJavaScript(code);
  window.webContents.backgroundThrottling = false;
  // Hidden-window captures freeze some animation timelines; compare settled design states.
  await window.webContents.insertCSS('*, *::before, *::after { transition: none !important; animation: none !important; }');
  const snapshot = async name => { await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');await delay(180);fs.writeFileSync(join(captures,name),(await window.webContents.capturePage(undefined,{stayHidden:true})).toPNG()); };
  await evaluate('document.querySelectorAll(".module-tab")[2].click()');
  await evaluate('document.querySelector(".search-wrap input").blur()');
  await waitFor(()=>evaluate('document.querySelectorAll(".image-card").length===10'),'ten screenshot cards');
  assert.deepEqual(window.getSize(), [840,500]);
  const geometry=await evaluate(`(() => {const r=s=>document.querySelector(s).getBoundingClientRect();return {header:r('.app-header').height,searchParent:document.querySelector('.search-wrap').parentElement.className,nav:r('.module-tabs').height,card:r('.image-card').height,columns:getComputedStyle(document.querySelector('.image-grid')).gridTemplateColumns.split(' ').length,scroll:document.querySelector('.image-grid').scrollHeight>document.querySelector('.image-grid').clientHeight};})()`);
  assert.deepEqual(geometry,{header:64,searchParent:'app-header',nav:52,card:70,columns:2,scroll:true});
  assert.equal(await evaluate('document.querySelectorAll(".module-tab.active").length'),1);
  const entry=(await evaluate('window.gpaster.listHistory()')).find(entry=>entry.kind==='image');
  const thumbnail=nativeImage.createFromDataURL(entry.previewDataUrl).getSize();
  assert.ok(Math.abs(thumbnail.width/thumbnail.height-1400/900)<.01);
  nativeTheme.themeSource='light';await snapshot('screenshots-light.png');
  nativeTheme.themeSource='dark';await snapshot('screenshots-dark.png');
  await evaluate('document.querySelector(".image-preview-button").focus()');
  await waitFor(()=>evaluate('getComputedStyle(document.querySelector(".image-card-footer")).opacity==="1"'),'keyboard action visibility');
  await snapshot('screenshots-keyboard-actions.png');
  await evaluate('document.querySelector(".image-preview-button").click()');
  await waitFor(()=>evaluate('Boolean(document.querySelector(".image-dialog"))'),'full preview');
  assert.equal(await evaluate('document.querySelector(".large-image-wrap img").naturalWidth'),1400);
  await snapshot('full-preview.png');
  await evaluate('document.querySelector(".image-dialog .dialog-heading button").click()');
  nativeTheme.themeSource='light';await evaluate('document.querySelectorAll(".module-tab")[0].click()');await snapshot('clipboard-light.png');
  await evaluate('document.querySelectorAll(".module-tab")[1].click()');await snapshot('phrases-light.png');
  await evaluate('document.querySelector(".settings-entry").click()');
  await waitFor(()=>evaluate('Boolean(document.querySelector("#language-choice"))'),'editable settings');await snapshot('settings-light.png');
  window.setSize(600,500);await snapshot('settings-narrow.png');
  assert.equal(await evaluate('document.documentElement.scrollWidth>window.innerWidth'),false);
  await evaluate('document.querySelector(".settings-back").click()');
  await evaluate('document.querySelectorAll(".module-tab")[2].click()');await snapshot('screenshots-narrow.png');
  assert.equal(await evaluate('Array.from(document.querySelectorAll(".module-tab")).every(e=>e.scrollWidth<=e.clientWidth+1)'),true);
  window.setSize(840,500);
  await evaluate('window.gpaster.clearHistory()');
  await waitFor(()=>window.getSize()[1]===340,'empty panel compact height');
  assert.equal(await evaluate('Boolean(document.querySelector(".app-header .search-wrap") && document.querySelector(".empty-state"))'),true);
  await snapshot('empty-panel.png');
  console.log(`PASS reference geometry, aspect-preserving thumbnails, 10-card scrolling, keyboard actions, full preview, compact empty state and 600 px responsive layout (isPackaged=${app.isPackaged})`);
}).then(async()=>{for(const window of BrowserWindow.getAllWindows())window.destroy();await delay(100);fs.rmSync(directory,{recursive:true,force:true});app.quit();}).catch(error=>{console.error(error);fs.rmSync(directory,{recursive:true,force:true});app.exit(1);});
