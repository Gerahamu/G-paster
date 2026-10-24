import assert from "node:assert/strict";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { consumeCorruptionEvents, readJsonArray } from "./atomic-json";

describe("atomic JSON privacy", () => {
  let directory: string;

  beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), "gpaster-json-")); });
  afterEach(async () => rm(directory, { recursive: true, force: true }));

  it("does not include malformed local data in parse errors", async () => {
    const filePath = join(directory, "history.json");
    const privateFixture = "synthetic-sensitive-clipboard-content";
    await writeFile(filePath, `not valid JSON ${privateFixture}`);

    await assert.rejects(readJsonArray(filePath), (error: Error) => {
      assert.equal(error.message, "Invalid local JSON data");
      assert.equal(error.message.includes(privateFixture), false);
      return true;
    });
  });

  it("preserves irrecoverably corrupt files and starts empty when recovery is allowed", async () => {
    const filePath = join(directory, "history.json");
    await writeFile(filePath, "{truncated");
    await writeFile(filePath + ".bak", "{also-truncated");
    assert.deepEqual(await readJsonArray(filePath, { recoverCorrupt: true }), []);
    const names = await readdir(directory);
    assert.ok(names.some(name => name.startsWith("history.json.primary.corrupt-")));
    assert.ok(names.some(name => name.startsWith("history.json.bak.backup.corrupt-")));
    assert.equal(consumeCorruptionEvents().includes(filePath), true);
  });
});
