import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rename, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { isScreenshotImage, ScreenshotMonitor } from "./screenshot-monitor";

describe("macOS screenshot collection", () => {
  it("recognizes Chinese filenames without a space and common localized formats", () => {
    for (const name of ["截屏2026-10-12 20.20.20.png", "屏幕截图2026-10-12.tiff", "Screenshot 2026-10-12.png", "スクリーンショット2026-10-12.heic", "스크린샷 2026-10-12.jpg"]) assert.equal(isScreenshotImage(name), true, name);
    for (const name of ["Screenshotter.png", "private.png", "截屏.docx"]) assert.equal(isScreenshotImage(name), false, name);
  });
  it("imports from an accessible directory when another directory cannot be read", async (context) => {
    context.mock.timers.enable({ apis: ["Date"], now: Date.now() });
    const directory = await mkdtemp(join(tmpdir(), "gpaster-screenshot-access-"));
    try {
      const blocked = join(directory, "not-a-directory");
      await writeFile(blocked, "blocked");
      const imported: string[] = [];
      const issues: (string | null)[] = [];
      const monitor = new ScreenshotMonitor([blocked, directory], async (path) => { imported.push(path); }, (issue) => issues.push(issue));
      await monitor.scanNow();
      const screenshot = join(directory, "截屏2026-10-12.png");
      await writeFile(screenshot, "image");
      await monitor.scanNow();
      context.mock.timers.tick(601);
      await monitor.scanNow();
      assert.deepEqual(imported, [screenshot]);
      assert.match(issues.at(-1)!, /无法访问部分截图目录/);
      await rm(blocked);
      await mkdir(blocked);
      await monitor.scanNow();
      assert.equal(issues.at(-1), null);
      assert.equal(imported.length, 1);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
  it("retries a failed import with backoff rather than losing the screenshot", async (context) => {
    context.mock.timers.enable({ apis: ["Date"], now: Date.now() });
    const directory = await mkdtemp(join(tmpdir(), "gpaster-screenshot-retry-"));
    try {
      let attempts = 0;
      const issues: (string | null)[] = [];
      const monitor = new ScreenshotMonitor([directory], async () => { if (++attempts === 1) throw new Error("temporary write failure"); }, (issue) => issues.push(issue));
      await monitor.scanNow();
      await writeFile(join(directory, "截屏2026-10-12.png"), "image");
      await monitor.scanNow();
      context.mock.timers.tick(601);
      await monitor.scanNow();
      assert.equal(attempts, 1);
      assert.match(issues.at(-1)!, /导入失败/);
      context.mock.timers.tick(1_000);
      await monitor.scanNow();
      assert.equal(attempts, 1);
      context.mock.timers.tick(4_001);
      await monitor.scanNow();
      assert.equal(attempts, 2);
      assert.equal(issues.at(-1), null);
      await monitor.scanNow();
      assert.equal(attempts, 2);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
  it("ignores screenshots predating startup and leaves originals intact", async (context) => {
    context.mock.timers.enable({ apis: ["Date"], now: Date.now() });
    const directory = await mkdtemp(join(tmpdir(), "gpaster-screenshot-old-"));
    try {
      const old = join(directory, "Screenshot 2025-01-01.png");
      await writeFile(old, "original");
      await utimes(old, new Date(Date.now() - 60_000), new Date(Date.now() - 60_000));
      let imports = 0;
      const monitor = new ScreenshotMonitor([directory], async () => { imports++; });
      await monitor.scanNow();
      context.mock.timers.tick(2_000);
      await monitor.scanNow();
      assert.equal(imports, 0);
      assert.equal(await readFile(old, "utf8"), "original");
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
  it("does not import handled screenshots again after a directory access outage", async (context) => {
    context.mock.timers.enable({ apis: ["Date"], now: Date.now() });
    const directory = await mkdtemp(join(tmpdir(), "gpaster-screenshot-outage-"));
    const screenshots = join(directory, "screenshots");
    try {
      await mkdir(screenshots);
      let imports = 0;
      const monitor = new ScreenshotMonitor([screenshots], async () => { imports++; });
      await monitor.scanNow();
      await writeFile(join(screenshots, "截屏2026-10-12.png"), "original");
      await monitor.scanNow();
      context.mock.timers.tick(601);
      await monitor.scanNow();
      assert.equal(imports, 1);
      await rename(screenshots, screenshots + "-backup");
      await writeFile(screenshots, "blocked");
      await monitor.scanNow();
      await rm(screenshots);
      await rename(screenshots + "-backup", screenshots);
      await monitor.scanNow();
      context.mock.timers.tick(601);
      await monitor.scanNow();
      assert.equal(imports, 1);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
});
