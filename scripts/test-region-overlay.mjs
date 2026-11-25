import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";

const script = readFileSync(new URL("../assets/region-capture.js", import.meta.url), "utf8");

function overlay() {
  const handlers = new Map();
  const elements = new Map();
  const results = [];
  for (const id of ["shade", "selection", "toolbar", "backdrop", "save", "text", "cancel"]) {
    const element = { hidden: true, style: {}, offsetWidth: 190, offsetHeight: 40,
      classList: { toggle() {} }, setAttribute() {}, contains(target) { return target === element; } };
    elements.set(id, element);
  }
  runInNewContext(script, {
    document: { getElementById: id => elements.get(id), body: { setPointerCapture() {} } },
    innerWidth: 500, innerHeight: 350,
    addEventListener: (name, listener) => handlers.set(name, listener),
    window: { regionCapture: {
      onInit: listener => listener({ language: "en", candidates: [{ x: 20, y: 30, width: 100, height: 90 }] }),
      finish: (action, rect) => results.push({ action, rect: rect && { ...rect } })
    } }
  });
  const pointer = (type, x, y, target = {}) => handlers.get(type)({ clientX: x, clientY: y, target, button: 0, pointerId: 1 });
  return { pointer, elements, results, key: value => handlers.get("keydown")({ key: value }) };
}

test("hover snaps to the top window; click selects; selection moves and saves with one action", () => {
  const { pointer, elements, results } = overlay();
  pointer("pointermove", 30, 60);
  assert.equal(elements.get("selection").style.width, "100px");
  assert.equal(elements.get("toolbar").hidden, true);
  pointer("pointerdown", 30, 60);
  pointer("pointerup", 30, 60);
  assert.equal(elements.get("toolbar").hidden, false);
  pointer("pointerdown", 60, 70, elements.get("selection"));
  pointer("pointermove", 68, 81);
  pointer("pointerup", 68, 81);
  elements.get("save").onclick();
  assert.deepEqual(results, [{ action: "save", rect: { x: 28, y: 41, width: 100, height: 90 } }]);
});

test("free drag and all edge and corner handles update the expected sides; Escape cancels", () => {
  const cases = {
    n: [100, 80, 200, 220], ne: [100, 80, 220, 220], e: [100, 100, 220, 200], se: [100, 100, 220, 220],
    s: [100, 100, 200, 220], sw: [80, 100, 220, 220], w: [80, 100, 220, 200], nw: [80, 80, 220, 220]
  };
  for (const [handle, [x, y, width, height]] of Object.entries(cases)) {
    const { pointer, elements, results, key } = overlay();
    pointer("pointerdown", 100, 100);
    pointer("pointermove", 300, 300);
    pointer("pointerup", 300, 300);
    const target = { dataset: { handle } };
    pointer("pointerdown", 100, 100, target);
    pointer("pointermove", handle.includes("w") ? 80 : 320, handle.includes("n") ? 80 : 320, target);
    pointer("pointerup", 0, 0, target);
    elements.get("text").onclick();
    key("Escape");
    assert.deepEqual(results, [{ action: "text", rect: { x, y, width, height } }, { action: "cancel", rect: undefined }], handle);
  }
});
