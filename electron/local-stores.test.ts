import assert from "node:assert/strict";
import { mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { ImageStore, MAX_CLIPBOARD_IMAGES } from "./image-store";
import { PhraseStore } from "./phrase-store";

describe("ImageStore", () => {
  let directory: string;
  let store: ImageStore;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "gpaster-images-"));
    store = new ImageStore(join(directory, "image-history.json"));
  });

  afterEach(async () => rm(directory, { recursive: true, force: true }));

  it("deduplicates repeated images, keeps the newest 10 and persists favorites", async () => {
    const first = await store.record(Buffer.from("image-0"), 10, 10, 1);
    const duplicate = await store.record(Buffer.from("image-0"), 20, 10, 12);
    assert.equal(duplicate.id, first.id);
    assert.equal(duplicate.createdAt, 1);
    assert.equal(duplicate.copiedAt, 12);
    for (let index = 1; index < 12; index += 1) {
      await store.record(Buffer.from(`image-${index}`), 10, 10, index + 12);
    }
    assert.equal((await store.list()).length, MAX_CLIPBOARD_IMAGES);
    assert.equal((await store.get(first.id)), undefined);

    const newest = (await store.list())[0];
    assert.equal(await store.toggleFavorite(newest.id), true);
    const reloaded = new ImageStore(join(directory, "image-history.json"));
    assert.equal((await reloaded.get(newest.id))?.isFavorite, true);
  });

  it("reads and deletes image files by opaque id", async () => {
    const bytes = Buffer.from("test-png-bytes");
    const image = await store.record(bytes, 3, 4, 10);
    assert.deepEqual(await store.read(image.id), bytes);
    assert.equal(await store.delete(image.id), true);
    assert.equal(await store.read(image.id), null);
  });

  it("rejects a damaged image file instead of returning corrupted clipboard data", async () => {
    const image = await store.record(Buffer.from("original-bytes"), 3, 4, 10);
    await writeFile(join(directory, "images", image.fileName), Buffer.from("damaged"));
    assert.equal(await store.read(image.id), null);
    const repeated = await store.record(Buffer.from("original-bytes"), 3, 4, 11);
    assert.equal(repeated.id, image.id);
    assert.deepEqual(await store.read(image.id), Buffer.from("original-bytes"));
  });

  it("serializes concurrent writes so a repeated image still has one record", async () => {
    const bytes = Buffer.from("same-image");
    const [first, repeated] = await Promise.all([
      store.record(bytes, 10, 10, 10),
      store.record(bytes, 10, 10, 20)
    ]);
    assert.equal(first.id, repeated.id);
    assert.equal((await store.list()).length, 1);
    assert.equal((await store.list())[0].copiedAt, 20);
  });

  it("keeps image metadata unchanged when persistence fails", async () => {
    const first = await store.record(Buffer.from("first"), 2, 2, 1);
    const metadata = join(directory, "image-history.json");
    await rename(metadata, metadata + ".bak");
    await mkdir(metadata);
    await assert.rejects(store.toggleFavorite(first.id));
    assert.equal((await store.get(first.id))?.isFavorite, false);
    await assert.rejects(store.record(Buffer.from("second"), 2, 2, 2));
    assert.equal((await store.list()).length, 1);
    await rm(metadata, { recursive: true });
    await rename(metadata + ".bak", metadata);
  });
});

describe("PhraseStore", () => {
  let directory: string;
  let store: PhraseStore;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "gpaster-phrases-"));
    store = new PhraseStore(join(directory, "phrases.json"));
  });

  afterEach(async () => rm(directory, { recursive: true, force: true }));

  it("creates, updates, categorizes and deletes phrases with persistence", async () => {
    const phrase = await store.create({ text: "  谢谢  ", category: "工作" }, 10);
    assert.equal(phrase.text, "谢谢");
    assert.equal(phrase.createdAt, 10);
    const updated = await store.update({ id: phrase.id, text: "收到", category: "回复" }, 20);
    assert.equal(updated?.updatedAt, 20);
    const reloaded = new PhraseStore(join(directory, "phrases.json"));
    assert.deepEqual(await reloaded.list(), [updated]);
    assert.equal(await reloaded.delete(phrase.id), true);
    assert.deepEqual(await reloaded.list(), []);
  });

  it("rejects blank phrase text and defaults an empty category", async () => {
    await assert.rejects(store.create({ text: "  ", category: "" }));
    assert.equal((await store.create({ text: "hello", category: " " })).category, "未分类");
  });

  it("serializes concurrent creation and keeps old state on disk failure", async () => {
    await Promise.all(Array.from({ length: 8 }, (_, index) => store.create({ text: `phrase-${index}`, category: "测试" }, index)));
    assert.equal((await store.list()).length, 8);
    const metadata = join(directory, "phrases.json");
    await rename(metadata, metadata + ".bak");
    await mkdir(metadata);
    await assert.rejects(store.create({ text: "missing", category: "测试" }));
    assert.equal((await store.list()).length, 8);
    await rm(metadata, { recursive: true });
    await rename(metadata + ".bak", metadata);
  });
});
