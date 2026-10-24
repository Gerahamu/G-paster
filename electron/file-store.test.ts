import assert from "node:assert/strict";
import { mkdtemp, mkdir, open, readFile, readdir, rm, stat, symlink, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "node:test";
import { FileStore, FILE_COPY_BATCH_BYTES, FILE_COPY_TOTAL_BYTES } from "./file-store";
import { fileReferenceKey, fileUriList, imageFileReferenceKey, NATIVE_FILE_URL, readFileItems } from "./clipboard-files";

const item = (data: Record<string, string>) => ({ types: Object.keys(data), getType: async (type: string) => new Blob([data[type]]) });

test("file clipboard parsing preserves ordered batches and prefers the native file representation over image/text", async () => {
  const paths = ["/tmp/中文 report #1.pdf", "/tmp/folder", "/tmp/second.jpg"];
  const payload = fileUriList(paths);
  const result = await readFileItems([item({ "image/png": "not image data", "text/plain": paths.join("\n"), "text/uri-list": payload, [NATIVE_FILE_URL]: pathToFileURL(paths[0]).href })]);
  assert.deepEqual(result, { paths, key: fileReferenceKey(paths) });
  assert.deepEqual((await readFileItems(paths.map(path => item({ [NATIVE_FILE_URL]: pathToFileURL(path).href }))))?.paths, paths);
  assert.notEqual(fileReferenceKey(paths), fileReferenceKey([...paths].reverse()));
  assert.equal(await readFileItems([item({ "text/plain": "/tmp/report.pdf" })]), null);
  assert.equal(await readFileItems([item({ "text/uri-list": "https://example.com/report.pdf\r\n# comment" })]), null);
  await assert.rejects(readFileItems([item({ [NATIVE_FILE_URL]: "file:///tmp/%invalid" })]), /无法读取/);
  await assert.rejects(readFileItems([item({ "text/uri-list": Array.from({ length: 1001 }, (_, i) => `file:///tmp/${i}`).join("\r\n") })]), /1000/);
});

test("image file reference identity changes when content at the same path is replaced", async () => {
  const directory = await mkdtemp(join(tmpdir(), "gpaster-image-file-key-"));
  try {
    const path = join(directory, "image.png");
    await writeFile(path, "first image");
    const reference = fileReferenceKey([path]);
    const first = await imageFileReferenceKey(path, reference);
    assert.equal(await imageFileReferenceKey(path, reference), first);
    await writeFile(path, "other image");
    await utimes(path, new Date(1_700_000_001_000), new Date(1_700_000_001_000));
    assert.notEqual(await imageFileReferenceKey(path, reference), first);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("file references deduplicate as whole selections, persist across restart, and never copy or delete originals", async () => {
  const directory = await mkdtemp(join(tmpdir(), "gpaster-files-"));
  try {
    const source = join(directory, "report.pdf"), folder = join(directory, "folder"), path = join(directory, "data", "file-history.json");
    await writeFile(source, "original PDF"); await mkdir(folder);
    const store = new FileStore(path);
    const first = await store.record([source, folder], false, 10);
    const repeat = await store.record([source, folder], false, 20);
    assert.equal(first.id, repeat.id); assert.equal((await store.list()).length, 1);
    assert.equal(repeat.createdAt, 10); assert.equal(repeat.copiedAt, 20);
    assert.deepEqual(await store.resolvePaths(first.id), [source, folder]);
    await assert.rejects(stat(join(directory, "data", "managed-files")), { code: "ENOENT" });
    const reversed = await store.record([folder, source], false, 30); assert.notEqual(reversed.id, first.id);
    const restored = new FileStore(path);
    assert.deepEqual((await restored.list()).map(entry => entry.id), [reversed.id, first.id]);
    assert.equal((await restored.listHistory())[0].files[0].isDirectory, true);
    await rm(source);
    assert.equal(await restored.resolvePaths(first.id), null);
    assert.equal((await restored.listHistory()).find(entry => entry.id === first.id)?.available, false);
    await restored.deleteMany([first.id]); await restored.clear();
    assert.equal((await restored.list()).length, 0); assert.equal((await stat(folder)).isDirectory(), true);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("saved copies preserve directory structure and duplicate names, restore without originals, and clean only owned copies", async () => {
  const directory = await mkdtemp(join(tmpdir(), "gpaster-copies-"));
  try {
    const folder = join(directory, "source", "bundle"), second = join(directory, "other", "report.txt");
    await mkdir(join(folder, "nested"), { recursive: true }); await mkdir(dirname(second));
    await writeFile(join(folder, "nested", "report.txt"), "nested original"); await writeFile(second, "second original");
    const path = join(directory, "data", "file-history.json"), store = new FileStore(path);
    const entry = await store.record([folder, second], true);
    assert.equal(entry.copyState, "pending");
    assert.equal((await store.saveCopies(entry.id))?.copyState, "saved");
    const copies = await store.resolvePaths(entry.id); assert.ok(copies);
    assert.equal(await readFile(join(copies[0], "nested", "report.txt"), "utf8"), "nested original");
    assert.equal(await readFile(copies[1], "utf8"), "second original");
    assert.equal(await readFile(second, "utf8"), "second original");
    await rm(folder, { recursive: true }); await rm(second);
    const restored = new FileStore(path), resolved = await restored.resolvePaths(entry.id); assert.deepEqual(resolved, copies);
    assert.equal((await restored.record(copies, false)).id, entry.id);
    assert.equal((await restored.list()).length, 1);
    assert.equal((await restored.listHistory())[0].available, true);
    await restored.deleteMany([entry.id]);
    for (const copy of copies) await assert.rejects(stat(copy), { code: "ENOENT" });
    assert.deepEqual(await readdir(join(directory, "data", "managed-files")), []);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("clearing while a reference capture is queued does not resurrect its metadata", async () => {
  const directory = await mkdtemp(join(tmpdir(), "gpaster-file-clear-"));
  try {
    const source = join(directory, "source.txt"); await writeFile(source, "keep");
    const store = new FileStore(join(directory, "data", "file-history.json"));
    const record = store.record([source], false); const clear = store.clear();
    await Promise.all([record, clear]); assert.deepEqual(await store.list(), []);
    assert.equal(await readFile(source, "utf8"), "keep");
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("copy protection rejects oversized files without reading their body or losing the original reference", async () => {
  const directory = await mkdtemp(join(tmpdir(), "gpaster-copy-limit-"));
  try {
    const source = join(directory, "large.zip"), handle = await open(source, "w");
    await handle.truncate(FILE_COPY_BATCH_BYTES + 1); await handle.close();
    const store = new FileStore(join(directory, "data", "file-history.json"));
    const entry = await store.record([source], true);
    assert.equal((await store.saveCopies(entry.id))?.copyState, "limit");
    assert.deepEqual(await store.resolvePaths(entry.id), [source]);
    assert.equal((await stat(source)).size, FILE_COPY_BATCH_BYTES + 1);
    assert.deepEqual(await readdir(join(directory, "data", "managed-files")), []);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("total copy capacity, missing sources, and deletion during background copying fail safely", async () => {
  const directory = await mkdtemp(join(tmpdir(), "gpaster-copy-failure-"));
  try {
    const path = join(directory, "data", "file-history.json"), store = new FileStore(path), source = join(directory, "source.txt");
    await writeFile(source, "keep original"); const entry = await store.record([source], true);
    const root = join(directory, "data", "managed-files", "snapshot-00000000-0000-0000-0000-000000000000");
    await mkdir(root, { recursive: true }); const capacity = await open(join(root, "capacity"), "w");
    await capacity.truncate(FILE_COPY_TOTAL_BYTES); await capacity.close();
    assert.equal((await store.saveCopies(entry.id))?.copyState, "limit");
    await rm(root, { recursive: true });
    const missing = await store.record([join(directory, "missing.docx")], true);
    assert.equal((await store.saveCopies(missing.id))?.copyState, "failed");
    const pending = await store.record([source], true); const copy = store.saveCopies(pending.id);
    await store.clear(); await copy;
    assert.deepEqual(await store.list(), []); assert.equal(await readFile(source, "utf8"), "keep original");
    assert.deepEqual(await readdir(join(directory, "data", "managed-files")), []);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("startup removes interrupted owned staging directories, keeps other files, and resumes persisted pending copies", async () => {
  const directory = await mkdtemp(join(tmpdir(), "gpaster-copy-recovery-"));
  try {
    const path = join(directory, "data", "file-history.json"), source = join(directory, "report.docx");
    await writeFile(source, "document"); const first = new FileStore(path); const pending = await first.record([source], true);
    const managed = join(directory, "data", "managed-files");
    await mkdir(join(managed, "stage-00000000-0000-0000-0000-000000000000"), { recursive: true });
    await mkdir(join(managed, "user-folder"));
    const restored = new FileStore(path); assert.equal((await restored.list())[0].copyState, "pending");
    assert.deepEqual(await readdir(managed), ["user-folder"]);
    assert.equal((await restored.saveCopies(pending.id))?.copyState, "saved");
    await restored.clear(); assert.equal((await stat(join(managed, "user-folder"))).isDirectory(), true);
    assert.equal(await readFile(source, "utf8"), "document");
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("copy metadata failures leave originals and reference history intact and do not leak a snapshot", async () => {
  const directory = await mkdtemp(join(tmpdir(), "gpaster-copy-persist-"));
  try {
    const source = join(directory, "source.pdf"), path = join(directory, "data", "file-history.json");
    await writeFile(source, "original"); const store = new FileStore(path); const entry = await store.record([source], true);
    await mkdir(path + ".tmp");
    await assert.rejects(store.saveCopies(entry.id));
    assert.equal((await store.get(entry.id))?.copyState, "pending");
    assert.equal(await readFile(source, "utf8"), "original");
    assert.deepEqual(await readdir(join(directory, "data", "managed-files")), []);
    await rm(path + ".tmp", { recursive: true });
    await writeFile(path, "corrupt primary");
    const restored = new FileStore(path);
    assert.equal((await restored.list()).length, 1);
    // A valid .bak may describe the interrupted copy; a missing owned copy falls back to the original.
    assert.deepEqual(await restored.resolvePaths(entry.id), [source]);
    assert.equal((await restored.listHistory())[0].copyState, "failed");
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("standalone symbolic links remain references instead of producing a broken permanent snapshot", { skip: process.platform === "win32" }, async () => {
  const directory = await mkdtemp(join(tmpdir(), "gpaster-file-link-"));
  try {
    const source = join(directory, "source.txt"), link = join(directory, "link.txt");
    await writeFile(source, "original"); await symlink("source.txt", link);
    const store = new FileStore(join(directory, "data", "file-history.json")), entry = await store.record([link], true);
    assert.equal((await store.saveCopies(entry.id))?.copyState, "failed");
    assert.deepEqual(await store.resolvePaths(entry.id), [link]);
    await store.clear(); assert.equal(await readFile(source, "utf8"), "original");
  } finally { await rm(directory, { recursive: true, force: true }); }
});
