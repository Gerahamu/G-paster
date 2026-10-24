const assert = require('node:assert/strict');
const { test } = require('node:test');
const { ClipboardFormatRead, ClipboardPollingTimer } = require('../dist-electron/electron/clipboard-monitor.js');
const { NATIVE_FILE_URL } = require('../dist-electron/electron/clipboard-files.js');

test('shares the current format enumeration without fetching any payload', async () => {
  let reads = 0;
  const read = new ClipboardFormatRead(async () => {
    reads++;
    return [{ types: ['text/uri-list', NATIVE_FILE_URL], getType: () => { throw new Error('Unexpected payload read'); } }];
  });
  assert.deepEqual(await read.fileFormats(async () => { throw new Error('Unexpected fallback'); }), [true, true]);
  assert.equal((await read.items).length, 1);
  assert.equal(reads, 1);
});

test('a later polling turn gets new types instead of reusing an old format result', async () => {
  const first = new ClipboardFormatRead(async () => [{ types: ['text/uri-list'] }]);
  assert.deepEqual(await first.fileFormats(async () => [false, false]), [true, false]);
  const second = new ClipboardFormatRead(async () => [{ types: ['image/png'] }]);
  assert.deepEqual(await second.fileFormats(async () => [true, true]), [false, false]);
});

test('slow enumeration falls back promptly and does not wait for its timeout', async () => {
  let release;
  const read = new ClipboardFormatRead(() => new Promise(resolve => { release = resolve; }));
  let fallbackCalls = 0;
  assert.deepEqual(await read.fileFormats(async () => { fallbackCalls++; return [false, true]; }), [false, true]);
  assert.equal(fallbackCalls, 1);
  release([]);
  await read.items;
});

test('failed enumeration still permits the independent original format checks', async () => {
  const read = new ClipboardFormatRead(async () => { throw new Error('Synthetic enumeration failure'); });
  const imageFailure = assert.rejects(read.items, /Synthetic enumeration failure/);
  assert.deepEqual(await read.fileFormats(async () => [true, false]), [true, false]);
  await imageFailure;
});

test('format matching retains exact URI/native semantics', async () => {
  const read = new ClipboardFormatRead(async () => [{ types: ['public.file-url', 'TEXT/URI-LIST'] }]);
  assert.deepEqual(await read.fileFormats(async () => [true, true]), [false, false]);
});

test('start is idempotent, stop invalidates queued ticks, and disposal prevents restarting', t => {
  const callbacks = [];
  t.mock.method(global, 'setInterval', callback => {
    callbacks.push(callback);
    return { id: callbacks.length };
  });
  t.mock.method(global, 'clearInterval', () => undefined);
  let polls = 0;
  const timer = new ClipboardPollingTimer(180, () => { polls++; });
  timer.start(); timer.start();
  assert.equal(callbacks.length, 1);
  callbacks[0](); assert.equal(polls, 1);
  timer.stop(); callbacks[0](); assert.equal(polls, 1);
  timer.start(); assert.equal(callbacks.length, 2);
  callbacks[0](); assert.equal(polls, 1);
  callbacks[1](); assert.equal(polls, 2);
  timer.dispose(); callbacks[1](); timer.start();
  assert.equal(polls, 2); assert.equal(callbacks.length, 2);
});
