import { test } from "node:test";
import assert from "node:assert/strict";
import { cropRegion, projectWindow } from "./capture-geometry";

test("projects a window spanning a negative-origin 150 percent display and a primary 100 percent display", () => {
  const window = { x: -450, y: 90, width: 600, height: 300 };
  const left = { x: -1200, y: 0, width: 1200, height: 800 };
  const primary = { x: 0, y: 0, width: 2560, height: 1600 };
  assert.deepEqual(projectWindow(window, { x: -1800, y: 0, width: 1800, height: 1200 }, left, left),
    { x: 900, y: 60, width: 300, height: 200 });
  assert.deepEqual(projectWindow(window, primary, primary, primary),
    { x: 0, y: 90, width: 150, height: 300 });
});

test("converts a DIP crop to source bitmap pixels and clips rounding at display edge", () => {
  assert.deepEqual(cropRegion({ x: 100.1, y: 40, width: 1100.1, height: 50 }, { width: 1200, height: 800 }, { width: 1800, height: 1200 }),
    { x: 150, y: 60, width: 1650, height: 75 });
  assert.equal(cropRegion({ x: -1, y: 0, width: 100, height: 100 }, { width: 1200, height: 800 }, { width: 1800, height: 1200 }), undefined);
});
