import assert from "node:assert/strict";
import { test } from "node:test";
import { withTimeout } from "./async-timeout";

test("resolves before the deadline", async () => {
  assert.equal(await withTimeout(Promise.resolve("ok"), 100, "synthetic timeout"), "ok");
});

test("rejects when the operation does not settle in time", async () => {
  await assert.rejects(withTimeout(new Promise(() => {}), 20, "synthetic timeout"), /synthetic timeout/);
});

test("preserves the original rejection", async () => {
  await assert.rejects(withTimeout(Promise.reject(new Error("original failure")), 100, "synthetic timeout"), /original failure/);
});
