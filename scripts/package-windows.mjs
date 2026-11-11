import { spawnSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputDirectory = resolve(root, process.env.GPASTER_WIN_OUT || "work/packaged");
const appDirectory = join(outputDirectory, "G-paster-win32-x64");
const exePath = join(appDirectory, "G-paster.exe");

// Spawn real executables and JS entry points directly (no npm/npx .cmd shims, which
// spawnSync cannot run with inherited stdio on Windows).
const node = process.execPath;
const electronBinary = join(root, "node_modules", "electron", "dist", "electron.exe");
const packagerEntry = join(root, "node_modules", "@electron", "packager", "bin", "electron-packager.mjs");
const asarEntry = join(root, "node_modules", "@electron", "asar", "bin", "asar.mjs");
const builderEntry = join(root, "node_modules", "electron-builder", "cli.js");

function run(command, args, label) {
  console.log(`\n--- [${label}] ---`);
  const result = spawnSync(command, args, { cwd: root, env: process.env, stdio: "inherit" });
  if (result.error) throw new Error(`${label} could not start: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`${label} failed with exit code ${result.status ?? "unknown"}`);
}

function capture(command, args, label) {
  const result = spawnSync(command, args, { cwd: root, env: process.env, encoding: "utf8" });
  if (result.error) throw new Error(`${label} could not start: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`${label} failed with exit code ${result.status ?? "unknown"}`);
  return result.stdout ?? "";
}

function requireFile(path, label) {
  if (!existsSync(path)) throw new Error(`${label} is missing: ${path}`);
}

async function verifyPackagerOutput() {
  requireFile(exePath, "Executable");
  const asarPath = join(appDirectory, "resources", "app.asar");
  requireFile(asarPath, "app.asar");
  const entries = capture(node, [asarEntry, "list", asarPath], "asar listing")
    .replace(/\\/g, "/").split(/\r?\n/).map(entry => entry.replace(/^\/+/, ""));
  const required = [
    "package.json", "dist/index.html", "dist-electron/electron/main.js",
    "dist-electron/electron/preload.js", "assets/G-paster-icon.png", "assets/GpasterTray.png"
  ];
  for (const entry of required) {
    if (!entries.includes(entry)) throw new Error(`app.asar is missing ${entry}`);
  }
  const forbidden = ["electron/main.ts", "src/App.tsx", "G-paster.icns", "GpasterTemplate.png"];
  for (const entry of forbidden) {
    if (entries.some(path => path.includes(entry))) throw new Error(`app.asar unexpectedly contains ${entry}`);
  }
  const exeBytes = statSync(exePath).size;
  if (exeBytes < 1_000_000) throw new Error(`Executable unexpectedly small (${exeBytes} bytes)`);
  console.log(`\nWindows x64 standalone app verified: ${appDirectory}`);
  console.log(`  G-paster.exe = ${exeBytes} bytes`);
}

async function verifyInstallerOutput() {
  const installerDir = resolve(root, "work/installer");
  const pkg = JSON.parse(capture(node, ["-e", "console.log(JSON.stringify(require('./package.json')) )"], "read package.json"));
  const version = pkg.version;
  const nsisPath = join(installerDir, `Gpaster-Setup-${version}-win-x64.exe`);
  const portablePath = join(installerDir, `Gpaster-Portable-${version}-win-x64.exe`);

  requireFile(nsisPath, "NSIS Setup Installer");
  const nsisBytes = statSync(nsisPath).size;
  if (nsisBytes < 10_000_000) throw new Error(`NSIS Setup unexpectedly small (${nsisBytes} bytes)`);
  console.log(`\nWindows NSIS Installer verified: ${nsisPath} (${(nsisBytes / 1024 / 1024).toFixed(2)} MB)`);

  if (existsSync(portablePath)) {
    const portableBytes = statSync(portablePath).size;
    console.log(`Windows Portable Executable verified: ${portablePath} (${(portableBytes / 1024 / 1024).toFixed(2)} MB)`);
  }
}

async function main() {
  run(node, ["scripts/clean-electron-build.mjs"], "Clean build");
  run(node, ["node_modules/typescript/bin/tsc", "-p", "tsconfig.electron.json"], "Compile main process");
  run(node, ["node_modules/vite/bin/vite.js", "build"], "Bundle renderer");
  run(electronBinary, ["scripts/generate-windows-icon.cjs"], "Generate Windows icon");

  const args = [
    ".", "G-paster",
    "--platform=win32", "--arch=x64", `--out=${outputDirectory}`, "--overwrite",
    "--icon=assets/G-paster.ico",
    "--ignore=" + [
      "^/(work|outputs|src|electron|scripts|docs|WINDOWS-HANDOFF)(/|$)",
      "^/node_modules(/|$)",
      "^/(README\\.md|CHANGELOG\\.md|index\\.html|vite\\.config\\.mts|tsconfig\\.[^/]+\\.json|\\.gitignore|package-lock\\.json|Windows开发提示词\\.md)$",
      "^/assets/(G-paster\\.icns|G-paster-brand\\.png|tray-icon\\.svg|GpasterTemplate(@2x)?\\.png|localizations)(/|$)"
    ].join("|")
  ];
  run(node, [packagerEntry, ...args], "Windows x64 Packager");
  await verifyPackagerOutput();

  if (existsSync(builderEntry) && existsSync(join(root, "electron-builder.yml"))) {
    run(node, [builderEntry, "--win", "--config", "electron-builder.yml"], "Windows NSIS & Portable Installer (electron-builder)");
    await verifyInstallerOutput();
  }

  console.log("\n=========================================");
  console.log("Windows x64 packaging completed successfully!");
  console.log("=========================================\n");
}

main().catch((error) => {
  console.error(`Windows packaging blocked: ${error instanceof Error ? error.message : "unknown error"}`);
  process.exitCode = 1;
});
