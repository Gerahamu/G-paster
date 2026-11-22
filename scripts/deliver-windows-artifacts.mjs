import { randomUUID } from "node:crypto";
import { copyFile, mkdir, rename, rm, stat } from "node:fs/promises";
import { join } from "node:path";

export async function deliverWindowsArtifacts(installerDirectory, outputsDirectory, version) {
  const names = [
    `Gpaster-Setup-${version}-win-x64.exe`,
    `Gpaster-Portable-${version}-win-x64.exe`
  ];
  const sources = await Promise.all(names.map(async (name, index) => {
    const path = join(installerDirectory, name);
    let info;
    try { info = await stat(path); }
    catch { throw new Error(`${index === 0 ? "Setup" : "Portable"} installer is missing: ${path}`); }
    if (!info.isFile() || info.size === 0) throw new Error(`${index === 0 ? "Setup" : "Portable"} installer is invalid: ${path}`);
    return path;
  }));

  await mkdir(outputsDirectory, { recursive: true });
  const staged = names.map(name => join(outputsDirectory, `.${name}.${randomUUID()}.tmp`));
  try {
    await Promise.all(sources.map((source, index) => copyFile(source, staged[index])));
    for (let index = 0; index < names.length; index++) {
      const target = join(outputsDirectory, names[index]);
      const [sourceInfo, stagedInfo] = await Promise.all([stat(sources[index]), stat(staged[index])]);
      if (sourceInfo.size !== stagedInfo.size) throw new Error(`Installer copy verification failed: ${names[index]}`);
      await rename(staged[index], target);
    }
  } finally {
    await Promise.all(staged.map(path => rm(path, { force: true })));
  }
  return names.map(name => join(outputsDirectory, name));
}
