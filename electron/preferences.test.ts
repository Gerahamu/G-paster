import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Preferences } from "./preferences";
import { displayShortcut, normalizeShortcut, shortcutFromKey } from "../src/shared/shortcuts";
import { DEFAULT_PREFERENCES, preferencePatch } from "../src/shared/preferences";
import { ImageStore } from "./image-store";
import { HistoryStore } from "./history-store";

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
    assert.deepEqual(JSON.parse(await readFile(path, "utf8")), [{ shortcut: "Control+C", ...DEFAULT_PREFERENCES }]);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("editable preferences validate types and persist without overwriting concurrent shortcut updates", async () => {
  for (const patch of [{ imageLimit: 0 }, { textLimit: 1001 }, { imageLimit: 1.5 }, { textLimit: "3" }, { language: ["en"] }, { appearance: "blue" }, { saveFileCopies: "true" }, { path: "/tmp" }, []]) {
    assert.equal(preferencePatch(patch), null);
  }
  const directory = await mkdtemp(join(tmpdir(), "gpaster-preferences-"));
  try {
    const path = join(directory, "preferences.json"), prefs = new Preferences(path, "Control+C", "darwin", registry(), () => {});
    prefs.register();
    assert.deepEqual(await Promise.all([prefs.update({ language: "en", appearance: "dark", textLimit: 6, imageLimit: 2 }), prefs.setShortcut("Alt+G")]), [null, null]);
    const restored = new Preferences(path, "Control+C", "darwin", registry(), () => {});
    await restored.load();
    assert.equal(restored.shortcut, "Alt+G");
    assert.deepEqual(restored.options, { language: "en", appearance: "dark", textLimit: 6, imageLimit: 2, saveFileCopies: false });
    assert.equal(await restored.update({ saveFileCopies: true }), null);
    const copyPreferences = new Preferences(path, "Control+C", "darwin", registry(), () => {});
    await copyPreferences.load(); assert.equal(copyPreferences.options.saveFileCopies, true);
    assert.equal(await restored.update({ imageLimit: 0 }), "preferences-invalid");
    assert.equal(restored.options.imageLimit, 2);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("configured retention limits affect capture, keep recent records and remove evicted image files", async () => {
  const directory = await mkdtemp(join(tmpdir(), "gpaster-policy-"));
  try {
    const historyPath = join(directory, "history.json"), imagePath = join(directory, "image-history.json");
    const text = new HistoryStore(historyPath, 4), images = new ImageStore(imagePath, 4);
    let oldestImage;
    for (let i = 1; i <= 4; i++) {
      await text.recordClipboardText(String(i), i);
      const image = await images.record(Buffer.from(String(i)), 1, 1, i);
      if (i === 1) oldestImage = image;
    }
    text.configureLimit(2); images.configureLimit(2);
    assert.equal((await text.list()).length, 4); assert.equal((await images.list()).length, 4);
    await text.recordClipboardText("next", 5); await images.record(Buffer.from("next"), 1, 1, 5);
    assert.deepEqual((await text.list()).map(entry => entry.content), ["next", "4"]);
    assert.equal((await images.list()).length, 2);
    assert.equal(await images.get(oldestImage!.id), undefined);
    await assert.rejects(readFile(join(directory, "images", oldestImage!.fileName)), { code: "ENOENT" });
    assert.equal((await new ImageStore(imagePath, 2).list()).length, 2);
    assert.equal((await new HistoryStore(historyPath, 2).list()).length, 2);
    images.configureLimit(5);
    for (let i = 6; i <= 8; i++) await images.record(Buffer.from(String(i)), 1, 1, i);
    assert.equal((await images.list()).length, 5);
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
