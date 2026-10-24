import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const npmExec = process.platform === "win32" ? "npm.cmd" : "npm";
const children = [];
let shuttingDown = false;

function start(command, args, options = {}) {
  const child = spawn(command, args, {
    cwd: projectRoot,
    stdio: "inherit",
    env: process.env,
    ...options
  });
  children.push(child);
  child.on("error", (error) => {
    console.error("Could not start development process:", error);
    shutdown(1);
  });
  return child;
}

async function waitForRenderer(server) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) throw new Error("Vite stopped before becoming ready.");
    try {
      const response = await fetch("http://127.0.0.1:5173");
      if (response.ok) return;
    } catch {
      await delay(250);
    }
  }
  throw new Error("Vite did not become ready within 30 seconds.");
}

function shutdown(exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    if (child.exitCode === null) child.kill("SIGTERM");
  }
  process.exitCode = exitCode;
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

try {
  const renderer = start(npmExec, ["run", "build:main"]);
  await new Promise((resolveBuild, rejectBuild) => {
    renderer.on("exit", (code) => (code === 0 ? resolveBuild() : rejectBuild(new Error("Main process compilation failed."))));
  });
  const vite = start(npmExec, ["run", "dev:renderer"]);
  await waitForRenderer(vite);
  const electronPath = resolve(projectRoot, "node_modules", "electron", "cli.js");
  const devUserData = join(projectRoot, "work", "dev-user-data");
  const desktop = start(process.execPath, [electronPath, "."], {
    env: {
      ...process.env,
      VITE_DEV_SERVER_URL: "http://127.0.0.1:5173",
      GPASTER_DEV_USER_DATA: devUserData
    }
  });
  desktop.on("exit", (code) => shutdown(code ?? 0));
} catch (error) {
  console.error(error);
  shutdown(1);
}
