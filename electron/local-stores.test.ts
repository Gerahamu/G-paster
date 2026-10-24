import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
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

  it("deduplicates repeated images and keeps the newest 10", async () => {
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

  });

  it("tracks real image sources across deduplication and reload without duplicating bytes", async () => {
    const bytes = Buffer.from("same-image-two-sources");
    const copied = await store.record(bytes, 8, 6, 1, "clipboard");
    assert.deepEqual(copied.sources, ["clipboard"]);
    const screenshot = await store.record(bytes, 8, 6, 2, "screenshot");
    assert.equal(screenshot.id, copied.id);
    assert.deepEqual(screenshot.sources, ["clipboard", "screenshot"]);
    assert.equal((await readdir(join(directory, "images"))).length, 1);
    const reloaded = new ImageStore(join(directory, "image-history.json"));
    assert.deepEqual((await reloaded.get(copied.id))?.sources, ["clipboard", "screenshot"]);
    screenshot.sources.length = 0;
    assert.deepEqual((await store.get(copied.id))?.sources, ["clipboard", "screenshot"]);
  });

  it("keeps legacy images with unknown provenance intact until an actual source is observed", async () => {
    const bytes = Buffer.from("legacy-image");
    const image = await store.record(bytes, 8, 6, 1);
    const metadata = join(directory, "image-history.json");
    const entries = JSON.parse(await readFile(metadata, "utf8"));
    delete entries[0].sources;
    const legacyJson = JSON.stringify(entries);
    await writeFile(metadata, legacyJson);
    const reloaded = new ImageStore(metadata);
    assert.deepEqual((await reloaded.get(image.id))?.sources, []);
    assert.deepEqual(await reloaded.read(image.id), bytes);
    assert.equal(await readFile(metadata, "utf8"), legacyJson);
    const copied = await reloaded.record(bytes, 8, 6, 2, "clipboard");
    assert.equal(copied.id, image.id);
    assert.deepEqual(copied.sources, ["clipboard"]);
  });

  it("reads and deletes image files by opaque id", async () => {
    const bytes = Buffer.from("test-png-bytes");
    const image = await store.record(bytes, 3, 4, 10);
    assert.deepEqual(await store.read(image.id), bytes);
    assert.equal(await store.delete(image.id), true);
    assert.equal(await store.read(image.id), null);
  });

  it("surfaces failed image deletion and retries generated-file cleanup on clear", async () => {
    const image = await store.record(Buffer.from("test-png-bytes"), 3, 4, 10);
    const imagePath = join(directory, "images", image.fileName);
    await rm(imagePath);
    await mkdir(imagePath);
    await writeFile(join(imagePath, "blocker"), "test");

    await assert.rejects(store.delete(image.id));
    assert.equal((await store.get(image.id))?.id, image.id);

    await assert.rejects(store.clear());
    assert.equal((await store.list()).length, 0);
    await rm(imagePath, { recursive: true, force: true });
    await store.clear();
    assert.deepEqual(await readdir(join(directory, "images")), []);
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
    await assert.rejects(store.delete(first.id));
    assert.equal((await store.get(first.id))?.id, first.id);
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

  it("keeps saved image phrases independent of image history and reloads their bytes", async () => {
    const imageBytes = Buffer.from("dedicated-phrase-image-bytes");
    const phrase = await store.createImage(imageBytes, 120, 80, "素材", 30);
    assert.equal(phrase.kind, "image");
    assert.deepEqual(phrase.image, { width: 120, height: 80 });
    assert.deepEqual(await store.readImage(phrase.id), imageBytes);

    const reloaded = new PhraseStore(join(directory, "phrases.json"));
    assert.deepEqual(await reloaded.readImage(phrase.id), imageBytes);
    assert.equal(await reloaded.delete(phrase.id), true);
    assert.equal(await reloaded.readImage(phrase.id), null);
    assert.deepEqual(await reloaded.list(), []);
  });

  it("restores an image asset when phrase metadata deletion cannot be persisted", async () => {
    const imageBytes = Buffer.from("rollback-image-bytes");
    const phrase = await store.createImage(imageBytes, 12, 8, "测试", 40);
    const metadata = join(directory, "phrases.json");
    await rename(metadata, metadata + ".bak");
    await mkdir(metadata);

    await assert.rejects(store.delete(phrase.id));
    assert.deepEqual(await store.readImage(phrase.id), imageBytes);
    assert.equal((await store.list()).some(item => item.id === phrase.id), true);

    await rm(metadata, { recursive: true });
    await rename(metadata + ".bak", metadata);
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
