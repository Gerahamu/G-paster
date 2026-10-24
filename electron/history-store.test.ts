import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { HistoryStore, classifyContent } from "./history-store";

describe("HistoryStore", () => {
  let directory: string;
  let filePath: string;
  let store: HistoryStore;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "gpaster-history-"));
    filePath = join(directory, "history.json");
    store = new HistoryStore(filePath);
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it("classifies web addresses as links and other content as text", () => {
    assert.equal(classifyContent("https://example.com/path"), "link");
    assert.equal(classifyContent("ftp://example.com/file"), "text");
    assert.equal(classifyContent("plain text"), "text");
  });

  it("deduplicates exact content and moves a repeated item to the top", async () => {
    await store.recordClipboardText("first", 10);
    const original = await store.recordClipboardText("second", 20);
    const repeated = await store.recordClipboardText("first", 30);

    const entries = await store.list();
    assert.equal(entries.length, 2);
    assert.equal(entries[0].content, "first");
    assert.equal(entries[0].id, repeated?.id);
    assert.equal(entries[0].createdAt, 10);
    assert.equal(entries[0].copiedAt, 30);
    assert.equal(entries[1].id, original?.id);
    assert.equal(entries[1].content, "second");
  });

  it("persists deletion and clearing across store instances", async () => {
    const first = await store.recordClipboardText("keep", 10);
    await store.recordClipboardText("remove", 20);
    assert.equal(await store.delete("missing-id"), false);
    assert.equal(await store.delete(first!.id), true);

    let reloaded = new HistoryStore(filePath);
    assert.deepEqual((await reloaded.list()).map((entry) => entry.content), ["remove"]);
    await reloaded.clear();
    reloaded = new HistoryStore(filePath);
    assert.deepEqual(await reloaded.list(), []);
    assert.equal(await readFile(filePath, "utf8"), "[]");
  });

  it("ignores whitespace-only clipboard updates", async () => {
    assert.equal(await store.recordClipboardText(" \n\t", 10), null);
    assert.deepEqual(await store.list(), []);
  });

  it("serializes concurrent first writes without losing records", async () => {
    await Promise.all(Array.from({ length: 12 }, (_, index) => store.recordClipboardText(`item-${index}`, index)));
    assert.equal((await store.list()).length, 12);
    assert.equal((await new HistoryStore(filePath).list()).length, 12);
  });

  it("does not expose a failed disk update in memory", async () => {
    await store.recordClipboardText("safe", 1);
    await rename(filePath, filePath + ".bak");
    await mkdir(filePath);
    await assert.rejects(store.recordClipboardText("would-disappear", 2));
    assert.deepEqual((await store.list()).map((entry) => entry.content), ["safe"]);
    await rm(filePath, { recursive: true });
    await rename(filePath + ".bak", filePath);
  });

  it("keeps the newest text entries within the byte budget", async () => {
    const bounded = new HistoryStore(filePath, 10, 10);
    await bounded.recordClipboardText("12345678", 1);
    await bounded.recordClipboardText("abcdefghi", 2);
    assert.deepEqual((await bounded.list()).map(entry => entry.content), ["abcdefghi"]);
  });

  it("drops persisted entries whose timestamps are outside the Date range", async () => {
    await writeFile(filePath, JSON.stringify([{ id: "bad", content: "bad", kind: "text", createdAt: 1e300, copiedAt: 1e300 }]));
    assert.deepEqual(await new HistoryStore(filePath).list(), []);
  });

  it("recovers a damaged primary file from the last complete backup", async () => {
    await store.recordClipboardText("recover-me", 1);
    await writeFile(filePath, "{truncated", "utf8");
    const recovered = new HistoryStore(filePath);
    assert.deepEqual((await recovered.list()).map((entry) => entry.content), ["recover-me"]);
    assert.equal(JSON.parse(await readFile(filePath, "utf8")).length, 1);
  });
});
