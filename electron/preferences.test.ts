import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Preferences } from "./preferences";
import { displayShortcut, normalizeShortcut, shortcutFromKey } from "../src/shared/shortcuts";

function registry() {
  const bindings = new Map<string, () => void>();
  return { bindings,
    register(key: string, callback: () => void) { if (bindings.has(key) || key === "Control+X") return false; bindings.set(key, callback); return true; },
    unregister(key: string) { bindings.delete(key); },
    isRegistered(key: string) { return bindings.has(key); }
  };
}

test("shortcut parsing rejects plain, duplicate, unsupported and platform-incompatible bindings", () => {
  for (const key of ["C", "Shift+C", "Control+Control+C", "Control+Escape", "Control+F25", "Control++", "Meta+C", {}, null]) {
    assert.equal(normalizeShortcut(key, "darwin"), null);
  }
  assert.equal(normalizeShortcut("Command+Shift+Control+c", "darwin"), "Control+Shift+Command+C");
  assert.equal(normalizeShortcut("Command+C", "win32"), null);
  assert.equal(normalizeShortcut("Alt+F12", "win32"), "Alt+F12");
  assert.equal(shortcutFromKey({ code: "KeyG", ctrlKey: true, altKey: false, shiftKey: true, metaKey: false }, "darwin"), "Control+Shift+G");
  assert.equal(displayShortcut("Control+Shift+G", "darwin"), "⌃ ⇧ G");
});

test("preferences preserve old shortcut on conflict, serialize updates, persist and restore default", async () => {
  const directory = await mkdtemp(join(tmpdir(), "gpaster-preferences-"));
  try {
    const path = join(directory, "preferences.json"), native = registry();
    let toggles = 0;
    const preferences = new Preferences(path, "Control+C", "darwin", native, () => toggles++);
    await preferences.load(); assert.equal(preferences.shortcut, "Control+C");
    assert.equal(preferences.register(), true);
    assert.equal(await preferences.setShortcut("Control+X"), "shortcut-conflict");
    assert.equal(preferences.shortcut, "Control+C"); assert.equal(native.isRegistered("Control+C"), true);
    native.bindings.get("Control+C")!(); assert.equal(toggles, 1);
    assert.equal(await preferences.setShortcut("C"), "shortcut-invalid");
    assert.deepEqual(await Promise.all([preferences.setShortcut("Control+G"), preferences.setShortcut("Alt+G")]), [null, null]);
    assert.deepEqual([...native.bindings.keys()], ["Alt+G"]);
    const reloaded = new Preferences(path, "Control+C", "darwin", registry(), () => {});
    await reloaded.load(); assert.equal(reloaded.shortcut, "Alt+G");
    await preferences.setShortcut("Control+C");
    assert.deepEqual(JSON.parse(await readFile(path, "utf8")), [{ shortcut: "Control+C" }]);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("failed preference write keeps the old live binding", async () => {
  const directory = await mkdtemp(join(tmpdir(), "gpaster-preferences-"));
  try {
    const blocked = join(directory, "file"); await writeFile(blocked, "not a directory");
    const native = registry(), preferences = new Preferences(join(blocked, "preferences.json"), "Control+C", "darwin", native, () => {});
    preferences.register();
    assert.equal(await preferences.setShortcut("Alt+G"), "settings-save-failed");
    assert.equal(preferences.shortcut, "Control+C");
    assert.deepEqual([...native.bindings.keys()], ["Control+C"]);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("preference backup recovery preserves a saved binding", async () => {
  const directory = await mkdtemp(join(tmpdir(), "gpaster-preferences-"));
  try {
    const path = join(directory, "preferences.json");
    await writeFile(path, "broken JSON");
    await writeFile(path + ".bak", JSON.stringify([{ shortcut: "Alt+Space" }]));
    const preferences = new Preferences(path, "Control+C", "darwin", registry(), () => {});
    await preferences.load(); assert.equal(preferences.shortcut, "Alt+Space");
    assert.deepEqual(JSON.parse(await readFile(path, "utf8")), [{ shortcut: "Alt+Space" }]);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
