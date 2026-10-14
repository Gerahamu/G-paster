// macOS native-window regression. Uses isolated data and a controlled clipboard,
// but keeps BrowserWindow.show/focus and OS shortcut registration unmodified.
// Requires Python 3 for a read-only active-Space probe; never changes OS settings.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');
const { app, BrowserWindow, clipboard, globalShortcut } = require('electron');

if (process.platform !== 'darwin') {
  console.log('SKIP native Spaces regression requires macOS.');
  app.quit();
} else {
  const root = process.env.GPASTER_TEST_APP_PATH || resolve(__dirname, '..');
  const interactive = process.env.GPASTER_TEST_SPACES_INTERACTIVE === '1';
  const statePath = process.env.GPASTER_TEST_SPACES_STATE;
  const directory = fs.mkdtempSync(join(tmpdir(), 'gpaster-spaces-'));
  const data = join(directory, 'data'), screenshots = join(directory, 'screenshots');
  fs.mkdirSync(data); fs.mkdirSync(screenshots);
  fs.writeFileSync(join(data, 'preferences.json'), JSON.stringify([{ shortcut: 'Control+Alt+Shift+G' }]));
  app.setPath('userData', data); app.setPath('desktop', screenshots); app.getAppPath = () => root;
  let text = '', registeredCallback, window;
  clipboard.readText = async () => text;
  clipboard.read = async () => [];
  clipboard.has = async () => false;
  const childProcess = require('node:child_process');
  childProcess.execFileSync = (file, args, options) => file === 'defaults' && args?.[1] === 'com.apple.screencapture'
    ? screenshots : execFileSync(file, args, options);

  function osState() {
    const activeSpace = Number(execFileSync('python3', ['-c',
      'import ctypes; s=ctypes.CDLL("/System/Library/PrivateFrameworks/SkyLight.framework/SkyLight"); s.CGSMainConnectionID.restype=ctypes.c_uint32; s.CGSGetActiveSpace.argtypes=[ctypes.c_uint32]; s.CGSGetActiveSpace.restype=ctypes.c_uint64; print(s.CGSGetActiveSpace(s.CGSMainConnectionID()))'
    ], { encoding: 'utf8' }).trim());
    assert.ok(activeSpace > 0, 'The read-only active-Space probe must return a valid Space.');
    const foreground = JSON.parse(execFileSync('/usr/bin/osascript', ['-l', 'JavaScript', '-e',
      'ObjC.import("AppKit"); const a=$.NSWorkspace.sharedWorkspace.frontmostApplication; JSON.stringify({pid:a.processIdentifier,bundle:ObjC.unwrap(a.bundleIdentifier)})'
    ], { encoding: 'utf8' }));
    return { activeSpace, foreground };
  }

  function assertStaysHere(before, after) {
    assert.equal(after.activeSpace, before.activeSpace, 'Showing the panel must not switch Spaces.');
    assert.equal(after.foreground.pid, before.foreground.pid, 'Showing the panel must not activate the whole application.');
  }

  const initial = osState();
  assert.notEqual(initial.foreground.pid, process.pid, 'Start the test with another application in the foreground.');
  const evidence = { initial, phase: 'starting', shortcuts: [], shownSpaces: [], blurCount: 0 };
  function publish() {
    if (statePath) fs.writeFileSync(statePath, JSON.stringify({ ...evidence,
      visible: !!window && !window.isDestroyed() && window.isVisible(),
      focused: !!window && !window.isDestroyed() && window.isFocused()
    }, null, 2));
  }
  let shortcutQueue = Promise.resolve();
  const nativeRegister = globalShortcut.register.bind(globalShortcut);
  globalShortcut.register = (key, callback) => {
    registeredCallback = callback;
    return nativeRegister(key, () => {
      shortcutQueue = shortcutQueue.then(async () => {
        const before = osState(), wasVisible = window.isVisible();
        callback();
        await delay(300);
        const after = osState();
        assertStaysHere(before, after);
        assert.equal(window.isVisible(), !wasVisible);
        if (!wasVisible) {
          assert.equal(window.isFocused(), true);
          await waitFor(() => evaluate('document.activeElement === document.querySelector(".search-wrap input")'), 'search focus after OS shortcut');
          if (!evidence.shownSpaces.includes(before.activeSpace)) evidence.shownSpaces.push(before.activeSpace);
        }
        evidence.shortcuts.push({ before, after, visible: !wasVisible });
        publish();
      }).catch(fail);
    });
  };

  async function waitFor(check, label) {
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) { if (await check()) return; await delay(60); }
    throw new Error('Timeout: ' + label);
  }
  const evaluate = code => window.webContents.executeJavaScript(code);
  function fail(error) { evidence.phase = 'failed'; evidence.error = String(error); publish(); console.error(error); fs.rmSync(directory, { recursive: true, force: true }); app.exit(1); }
  process.on('SIGTERM', () => { evidence.phase = 'interrupted'; publish(); app.quit(); });
  app.on('will-quit', () => fs.rmSync(directory, { recursive: true, force: true }));
  require(join(root, 'dist-electron/electron/main.js'));

  app.whenReady().then(async () => {
    await waitFor(() => { window = BrowserWindow.getAllWindows()[0]; return window && !window.webContents.isLoading(); }, 'real native window');
    await waitFor(() => evaluate('Boolean(window.gpaster && document.querySelector(".module-tabs"))'), 'renderer');
    assert.equal(globalShortcut.isRegistered('Control+Alt+Shift+G'), true);
    assertStaysHere(initial, osState());
    assert.equal(window.isVisibleOnAllWorkspaces(), true);
    assert.equal(window.isFocused(), true);

    for (let i = 0; i < 4; i++) {
      registeredCallback(); await delay(80); assert.equal(window.isVisible(), false);
      const before = osState();
      registeredCallback(); await delay(120);
      assertStaysHere(before, osState());
      assert.equal(window.isVisible(), true); assert.equal(window.isFocused(), true);
    }
    await waitFor(() => evaluate('document.activeElement === document.querySelector(".search-wrap input")'), 'native panel search focus');
    window.webContents.sendInputEvent({ type: 'char', keyCode: 'g' });
    await waitFor(() => evaluate('document.querySelector(".search-wrap input")?.value === "g"'), 'keyboard input');
    window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
    window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
    await waitFor(() => evaluate('document.querySelector(".search-wrap input")?.value === ""'), 'Escape clears search');
    assert.equal(window.isVisible(), true);
    window.close();
    assert.equal(window.isDestroyed(), false); assert.equal(window.isVisible(), false);
    // The next OS key event arrives after macOS delivers close/hide focus loss.
    await delay(120);
    registeredCallback(); await delay(100);
    assert.equal(window.isVisible(), true);
    assert.equal(window.isFocused(), true);

    const other = new BrowserWindow({ type: 'panel', show: false, width: 100, height: 100 });
    other.show();
    await waitFor(() => !window.isVisible(), 'real native focus loss hides panel');
    other.destroy();
    text = 'Background capture survives native panel hiding.';
    await waitFor(async () => (await evaluate('window.gpaster.listHistory()')).some(item => item.content === text), 'isolated background clipboard capture');
    window.on('blur', () => { evidence.blurCount++; publish(); });
    window.on('hide', publish);
    evidence.phase = interactive ? 'interactive' : 'passed';
    publish();
    console.log('PASS real native show/focus: no app activation or Space jump; 8 toggles, search typing/clearing, close/reopen, native blur and hidden clipboard capture.');

    if (!interactive) { app.quit(); return; }
    const finishRegistered = nativeRegister('Control+Alt+Shift+F', () => {
      void shortcutQueue.then(() => {
        assert.ok(evidence.shownSpaces.length >= 2, 'Visit at least two real Spaces and use the OS shortcut in each.');
        assert.ok(evidence.shortcuts.length >= 4, 'Exercise both showing and hiding using the registered OS shortcut.');
        assert.ok(evidence.blurCount > 0, 'Click outside the panel to verify real native blur.');
        evidence.phase = 'passed'; publish();
        console.log(`PASS actual OS shortcuts in ${evidence.shownSpaces.length} Spaces; outside-click hiding; unchanged foreground app and active Space.`);
        app.quit();
      }).catch(fail);
    });
    assert.equal(finishRegistered, true, 'Finish shortcut must register.');
    console.log('Interactive: Control+Alt+Shift+G toggles; visit another Space and repeat; click outside; Control+Alt+Shift+F finishes.');
    setTimeout(() => fail(new Error('Interactive Spaces validation timed out.')), 600000).unref();
  }).catch(fail);
}
