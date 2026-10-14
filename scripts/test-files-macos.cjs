// Opt-in native pasteboard test. Run with G-paster closed; restores the previous
// clipboard unless another application/user replaces it during the test.
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { mkdir, readFile, rm, writeFile } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');
const { app, clipboard, ClipboardItem, nativeImage } = require('electron');
const { readFileItems, fileUriList, NATIVE_FILE_URL } = require(join(resolve(__dirname, '..'), 'dist-electron/electron/clipboard-files.js'));
const { FileStore } = require(join(resolve(__dirname, '..'), 'dist-electron/electron/file-store.js'));
const directory = require('node:fs').realpathSync(require('node:fs').mkdtempSync(join(process.platform === 'darwin' ? '/tmp' : tmpdir(), 'gpaster-native-files-')));
app.setPath('userData', join(directory, 'electron-data'));
const jxa = script => execFileSync('/usr/bin/osascript', ['-l', 'JavaScript', '-e', script], { encoding: 'utf8', timeout: 10000 }).trim();
const count = () => Number(jxa('ObjC.import("AppKit"); Number($.NSPasteboard.generalPasteboard.changeCount)'));
const nativeRead = () => JSON.parse(jxa('ObjC.import("AppKit"); const p=$.NSPasteboard.generalPasteboard; const c=$.NSArray.arrayWithObject($.NSURL.class); const o=$.NSMutableDictionary.alloc.init; o.setObjectForKey($.NSNumber.numberWithBool(true),$.NSPasteboardURLReadingFileURLsOnlyKey); const u=p.readObjectsForClassesOptions(c,o); const r=[]; for(let i=0;i<Number(u.count);i++)r.push(ObjC.unwrap(u.objectAtIndex(i).path)); JSON.stringify(r)'));
const nativeWrite = paths => {
  const result = JSON.parse(jxa(`ObjC.import("AppKit"); const p=$.NSPasteboard.generalPasteboard; const a=$.NSMutableArray.alloc.init; ${JSON.stringify(paths)}.forEach(path=>a.addObject($.NSURL.fileURLWithPath(path))); p.clearContents; const success=p.writeObjects(a); const items=[]; for(let i=0;i<Number(p.pasteboardItems.count);i++)items.push(ObjC.unwrap(p.pasteboardItems.objectAtIndex(i).stringForType($.NSPasteboardTypeFileURL))); JSON.stringify({count:Number(p.changeCount),input:Number(a.count),success:Boolean(success),items})`));
  if (result.items.length !== paths.length) console.log('Native write diagnostic:', JSON.stringify(result));
  return result.count;
};
let original, originalText, expectedCount, wrote = false;
let cleanupPromise;
function cleanup() {
  if (!cleanupPromise) cleanupPromise = (async () => {
    try {
      if (wrote && expectedCount === count()) {
        if (original.length) await clipboard.write(original); else clipboard.clear();
        if (await clipboard.readText() !== originalText) throw new Error('Host clipboard restoration could not be verified');
        console.log('Previous host clipboard restored');
      } else if (wrote) console.log('Clipboard changed externally; the newer clipboard was preserved');
    } finally { await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
  })();
  return cleanupPromise;
}
for (const [signal, code] of [['SIGINT', 130], ['SIGTERM', 143]]) process.once(signal, () => {
  void cleanup().then(() => app.exit(code), () => app.exit(1));
});
app.whenReady().then(async () => {
  app.dock?.hide();
  if (process.platform !== 'darwin') { console.log('SKIP native NSPasteboard test requires macOS'); return; }
  try {
    execFileSync('/usr/bin/pgrep', ['-f', '^/Applications/G-paster[.]app/Contents/MacOS/G-paster( |$)'], { stdio: 'ignore' });
    throw new Error('Close the installed G-paster before this opt-in native clipboard test');
  } catch (error) { if (error.status !== 1) throw error; }
  const before = count(), snapshot = await clipboard.read(); let total = 0;
  originalText = await clipboard.readText();
  original = [];
  for (const entry of snapshot) {
    const payload = {};
    for (const type of entry.types) {
      const value = await entry.getType(type);
      if (type === 'electron application/bookmark') payload[type] = value;
      else {
        total += value.size;
        if (total > 100 * 1024 * 1024) throw new Error('Native test skipped: current clipboard is too large to snapshot safely');
        payload[type] = new Blob([await value.arrayBuffer()]);
      }
    }
    original.push(new ClipboardItem(payload));
  }
  if (before !== count()) throw new Error('Native test stopped: clipboard changed during snapshot');
  const source = join(directory, 'Finder copy source'); await mkdir(source);
  const folder = join(source, 'folder'), pdf = join(source, '中文 report.pdf'), png = join(source, 'image.png');
  await mkdir(folder); await writeFile(join(folder, 'nested.txt'), 'nested original'); await writeFile(pdf, 'PDF original');
  await writeFile(png, nativeImage.createFromBitmap(Buffer.from([0,0,255,255]), { width: 1, height: 1 }).toPNG());
  for (const selection of [[pdf], [folder], [pdf, folder, png]]) {
    await clipboard.write([new ClipboardItem({ 'text/uri-list': fileUriList(selection) })]); wrote = true; expectedCount = count();
    assert.deepEqual(nativeRead(), selection);
    assert.deepEqual((await readFileItems(await clipboard.read())).paths, selection);
    expectedCount = nativeWrite(selection);
    assert.deepEqual(nativeRead(), selection);
    assert.equal(await clipboard.has('text/uri-list') || await clipboard.has(NATIVE_FILE_URL), true);
    const nativeItems = await clipboard.read();
    const readback = await readFileItems(nativeItems);
    if (readback?.paths.length !== selection.length) {
      console.log('Native file selection types:', JSON.stringify(nativeItems.map(item => item.types)));
      for (const item of nativeItems) if (item.types.includes('text/uri-list')) console.log('Native URI list:', JSON.stringify(await (await item.getType('text/uri-list')).text()));
    }
    assert.deepEqual(readback?.paths, selection);
  }
  console.log('PASS real Electron ↔ NSPasteboard NSURL round-trip: single file, folder, ordered batch and PNG file');
  if (process.env.GPASTER_TEST_FINDER === '1') {
    const target = join(directory, 'Finder paste target'); await mkdir(target);
    await clipboard.writeText('Gpaster native test: waiting for Finder copy'); expectedCount = count();
    console.log('FINDER_COPY_SOURCE=' + source);
    let captured;
    const copyDeadline = Date.now() + 600000;
    while (Date.now() < copyDeadline) {
      if (count() !== expectedCount) {
        const result = await readFileItems(await clipboard.read());
        if (result && result.paths.length === 3 && result.paths.every(path => [pdf, folder, png].includes(path))) { captured = result.paths; expectedCount = count(); break; }
      }
      await delay(200);
    }
    if (!captured) throw new Error('Actual Finder copy was not completed within 10 minutes');
    assert.deepEqual(nativeRead(), captured);
    const storePath = join(directory, 'file-data', 'file-history.json');
    const store = new FileStore(storePath); const entry = await store.record(captured, false);
    const restarted = new FileStore(storePath); const restored = await restarted.resolvePaths(entry.id);
    assert.deepEqual(restored, captured);
    await clipboard.write([new ClipboardItem({ 'text/uri-list': fileUriList(restored) })]); expectedCount = count();
    console.log('PASS actual Finder copy → ordered file history → restart/read-back → clipboard restore');
    console.log('FINDER_PASTE_TARGET=' + target);
    const deadline = Date.now() + 600000;
    while (Date.now() < deadline) {
      try {
        assert.equal(await readFile(join(target, '中文 report.pdf'), 'utf8'), 'PDF original');
        assert.equal(await readFile(join(target, 'folder', 'nested.txt'), 'utf8'), 'nested original');
        assert.deepEqual(await readFile(join(target, 'image.png')), await readFile(png));
        console.log('PASS actual Finder paste preserves all files, folder structure and bytes'); return;
      } catch { await delay(200); }
    }
    throw new Error('Actual Finder paste was not completed within 10 minutes');
  }
}).finally(cleanup).then(() => app.quit()).catch(error => { console.error(error); app.exit(1); });
