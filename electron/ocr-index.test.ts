import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { setTimeout as delay } from "node:timers/promises";
import { OcrIndex } from "./ocr-index";

async function until(condition: () => Promise<unknown> | unknown): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (await condition()) return;
    await delay(15);
  }
  throw new Error("OCR index did not reach the expected state");
}

test("retries OCR and cache writes and drops deleted files and records", async () => {
  const root = await mkdtemp(join(tmpdir(), "gpaster-ocr-"));
  const file = join(root, "image.png");
  const cacheRoot = join(root, "index");
  const cache = join(cacheRoot, "text.json");
  let attempts = 0;
  const recognize = async (path: string) => {
    if (++attempts === 1) throw new Error("Temporary recognition failure");
    return readFile(path, "utf8");
  };
  const index = new OcrIndex(cache, recognize, () => {}, 40);
  const item = { key: "image:1", path: file };
  const persisted = () => readFile(cache, "utf8").catch(() => "");
  try {
    await writeFile(file, "fixture");
    await writeFile(cacheRoot, "temporarily blocked");
    index.reconcile([item]);
    await until(() => index.snapshot()[item.key] === "fixture");
    await rm(cacheRoot);
    await mkdir(cacheRoot);
    await until(async () => (await persisted()).includes("fixture"));

    const restored = new OcrIndex(cache, () => Promise.reject(new Error("cache should be reused")), () => {}, 40);
    try {
      await restored.load();
      restored.reconcile([item]);
      await until(() => restored.snapshot()[item.key] === "fixture");
    } finally { await restored.close(); }

    await rm(file);
    await until(() => !(item.key in index.snapshot()));
    await until(async () => (await persisted()).trim() === "{}");
    await writeFile(file, "replacement");
    await until(() => index.snapshot()[item.key] === "replacement");
    index.reconcile([]);
    assert.deepEqual(index.snapshot(), {});
    await until(async () => (await persisted()).trim() === "{}");
  } finally {
    await index.close();
    await rm(root, { recursive: true, force: true });
  }
});
