import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { deliverWindowsArtifacts } from "./deliver-windows-artifacts.mjs";

test("copies the versioned Windows installers into the delivery directory", async () => {
  const root = await mkdtemp(join(tmpdir(), "gpaster-delivery-"));
  try {
    const installerDirectory = join(root, "installer");
    const outputsDirectory = join(root, "outputs");
    await mkdir(installerDirectory);
    await mkdir(outputsDirectory);
    await writeFile(join(outputsDirectory, "README-Windows-Delivery.md"), "keep documentation");
    const expected = new Map([
      ["Gpaster-Setup-1.0.0-win-x64.exe", "setup-bytes"],
      ["Gpaster-Portable-1.0.0-win-x64.exe", "portable-bytes"]
    ]);
    for (const [name, contents] of expected) await writeFile(join(installerDirectory, name), contents);

    const delivered = await deliverWindowsArtifacts(installerDirectory, outputsDirectory, "1.0.0");

    assert.deepEqual(delivered.map(path => path.split(/[\\/]/).at(-1)), [...expected.keys()]);
    for (const [name, contents] of expected) assert.equal(await readFile(join(outputsDirectory, name), "utf8"), contents);
    assert.equal(await readFile(join(outputsDirectory, "README-Windows-Delivery.md"), "utf8"), "keep documentation");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("validates every installer before replacing an existing delivery artifact", async () => {
  const root = await mkdtemp(join(tmpdir(), "gpaster-delivery-missing-"));
  try {
    const installerDirectory = join(root, "installer");
    const outputsDirectory = join(root, "outputs");
    await mkdir(installerDirectory);
    await mkdir(outputsDirectory);
    const setupName = "Gpaster-Setup-1.0.0-win-x64.exe";
    await writeFile(join(installerDirectory, setupName), "new setup");
    await writeFile(join(outputsDirectory, setupName), "previous setup");

    await assert.rejects(deliverWindowsArtifacts(installerDirectory, outputsDirectory, "1.0.0"), /Portable installer is missing/);
    assert.equal(await readFile(join(outputsDirectory, setupName), "utf8"), "previous setup");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
