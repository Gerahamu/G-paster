// Interactive OS drag verification. All images, clipboard APIs and storage are isolated.
// Run with Electron, open the printed localhost URL, then drag using the real mouse.
const fs = require('node:fs');
const { join, resolve } = require('node:path');
const { tmpdir } = require('node:os');
const { createHash } = require('node:crypto');
const http = require('node:http');
const { app, BrowserWindow, clipboard, globalShortcut, nativeImage } = require('electron');
const root = resolve(__dirname, '..');
const directory = fs.mkdtempSync(join(tmpdir(), 'gpaster-native-drag-'));
const data = join(directory, 'data');
const screenshots = join(directory, 'screenshots');
fs.mkdirSync(join(data, 'images'), { recursive: true });
fs.mkdirSync(screenshots);
app.setPath('userData', data);
app.setPath('desktop', screenshots);
app.getAppPath = () => root;
const originalRegisterShortcut = globalShortcut.register.bind(globalShortcut);
let receiver;
let creatingReceiver = false;
globalShortcut.register = (_shortcut, callback) => originalRegisterShortcut('Control+Alt+Shift+V', () => {
  receiver?.showInactive();
  callback();
});
clipboard.read = async () => [];
clipboard.has = async () => false;
clipboard.readText = async () => '';
clipboard.write = async () => {};
clipboard.writeText = async () => {};
const cp = require('node:child_process');
const originalExecFileSync = cp.execFileSync;
cp.execFileSync = (file, args, options) => file === 'defaults' && args?.[1] === 'com.apple.screencapture'
  ? screenshots : originalExecFileSync(file, args, options);
const events = [];
const expected = [];
app.whenReady().then(() => {
  const entries = [0, 1, 2].map(index => {
    const pixels = Buffer.alloc(256 * 160 * 4);
    for (let i = 0; i < pixels.length; i += 4) {
      pixels[i] = 40 + index * 65; pixels[i + 1] = 120; pixels[i + 2] = 210;
      pixels[i + 3] = 255;
    }
    const png = nativeImage.createFromBitmap(pixels, { width: 256, height: 160 }).toPNG();
    const id = `11111111-1111-4111-8111-${String(index + 1).padStart(12, '0')}`;
    const fileName = `${id}.png`;
    const hash = createHash('sha256').update(png).digest('hex');
    fs.writeFileSync(join(data, 'images', fileName), png);
    expected.push({ name: fileName, hash, size: png.length });
    return { id, fileName, hash, width: 256, height: 160, createdAt: Date.now() - index,
      copiedAt: Date.now() - index, sources: [index === 0 ? 'clipboard' : 'screenshot'] };
  });
  fs.writeFileSync(join(data, 'image-history.json'), JSON.stringify(entries));
});
const page = `<!doctype html><meta charset="utf-8"><title>Gpaster native drag QA</title>
<style>body{font:20px system-ui;margin:24px;background:#f5f7fa}#drop{border:3px dashed #687a90;border-radius:16px;padding:30px;min-height:120px;background:white}#editor{border:2px solid #687a90;padding:20px;margin-top:20px;min-height:100px;background:white}pre{font-size:15px;white-space:pre-wrap}</style>
<h2>Gpaster native drag QA — synthetic images only</h2><button onclick="fetch('/show-source',{method:'POST'})">Show source window</button><div id="drop">Drop PNG files here<input type="file" multiple accept="image/*"></div><div id="editor" contenteditable="true">Image-capable message input: drop a PNG here</div><pre id="result">Waiting for a real OS drop.</pre>
<script>
for (const id of ['drop','editor']) {
 const el=document.getElementById(id);
 el.addEventListener('dragover',e=>{e.preventDefault();e.dataTransfer.dropEffect='copy'});
 el.addEventListener('drop',async e=>{
  e.preventDefault();
  const files=await Promise.all([...e.dataTransfer.files].map(async f=>{
   const buffer=await f.arrayBuffer(); const digest=await crypto.subtle.digest('SHA-256',buffer);
   return {name:f.name,type:f.type,size:f.size,hash:[...new Uint8Array(digest)].map(n=>n.toString(16).padStart(2,'0')).join('')};
  }));
  const result={target:id,types:[...e.dataTransfer.types],files};
  document.getElementById('result').textContent=JSON.stringify(result,null,2);
  await fetch('/result',{method:'POST',body:JSON.stringify(result)});
 });
}
</script>`;
const server = http.createServer((req, res) => {
  if (req.url === '/show-source' && req.method === 'POST') {
    const source = BrowserWindow.getAllWindows().find(window => window !== receiver);
    source?.show(); source?.focus(); res.end('ok');
  } else if (req.url === '/result' && req.method === 'POST') {
    let body = ''; req.on('data', chunk => { body += chunk; });
    req.on('end', () => { events.push(JSON.parse(body)); console.log('NATIVE_DROP', body); res.end('ok'); });
  } else if (req.url === '/status') {
    res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ directory, expected, events,
      windows: BrowserWindow.getAllWindows().map(window => ({title:window.getTitle(),id:window.getMediaSourceId(),visible:window.isVisible(),bounds:window.getBounds()})) }));
  } else { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(page); }
});
server.listen(Number(process.env.GPASTER_QA_PORT) || 0, '127.0.0.1', () => console.log(`QA_URL http://127.0.0.1:${server.address().port}; show test window: Control+Alt+Shift+V`));
app.on('browser-window-created', (_event, window) => {
  if (creatingReceiver) return;
  const originalDrag = window.webContents.startDrag.bind(window.webContents);
  window.webContents.startDrag = options => {
    console.log('NATIVE_START', JSON.stringify({ files: options.files || [options.file], visible: window.isVisible() }));
    return originalDrag(options);
  };
  window.on('blur', () => console.log('WINDOW_BLUR'));
  window.on('hide', () => console.log('WINDOW_HIDE'));
  window.webContents.on('console-message', event => console.log('RENDERER', event.message));
  window.webContents.on('did-finish-load', () => window.webContents.executeJavaScript(`
    for (const type of ['dragstart','dragend','pointerup']) document.addEventListener(type, e => console.log('QA_GESTURE', type, e.target.className), true);
  `));
  window.once('ready-to-show', () => {
    creatingReceiver = true;
    receiver = new BrowserWindow({x:500,y:120,width:700,height:600,title:'Gpaster isolated drop receiver',webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});
    creatingReceiver = false;
    receiver.webContents.setWindowOpenHandler(() => ({action:'deny'}));
    receiver.loadURL(`http://127.0.0.1:${server.address().port}`);
    receiver.webContents.on('did-finish-load', () => { window.setPosition(50, 140); window.show(); window.focus(); });
  });
});
app.on('before-quit', () => { server.close(); });
require(join(root, 'dist-electron/electron/main.js'));
