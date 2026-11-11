// Automated runtime verification of the packaged Windows x64 executable.
// Uses an isolated temporary user-data directory to ensure the host user environment is untouched.
const assert = require("node:assert/strict");
const { spawn, execFile } = require("node:child_process");
const fs = require("node:fs");
const { tmpdir } = require("node:os");
const { join, resolve } = require("node:path");
const { setTimeout: delay } = require("node:timers/promises");

const root = resolve(__dirname, "..");
const exePath = join(root, "work", "packaged", "G-paster-win32-x64", "G-paster.exe");
const nsisPath = join(root, "work", "installer", "Gpaster-Setup-0.999.2-win-x64.exe");
const portablePath = join(root, "work", "installer", "Gpaster-Portable-0.999.2-win-x64.exe");

async function waitFor(fn, label, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fn();
      if (res) return res;
    } catch {}
    await delay(200);
  }
  throw new Error(`Timeout waiting for: ${label}`);
}

async function verifyFiles() {
  console.log("1. Verifying packaged artifacts on disk...");
  assert.ok(fs.existsSync(exePath), `Standalone executable missing: ${exePath}`);
  assert.ok(fs.statSync(exePath).size > 100_000_000, "Standalone executable size valid (>100MB)");

  assert.ok(fs.existsSync(nsisPath), `NSIS Installer missing: ${nsisPath}`);
  assert.ok(fs.statSync(nsisPath).size > 50_000_000, "NSIS installer size valid (>50MB)");

  assert.ok(fs.existsSync(portablePath), `Portable executable missing: ${portablePath}`);
  assert.ok(fs.statSync(portablePath).size > 50_000_000, "Portable executable size valid (>50MB)");

  console.log("   Artifact sizes:");
  console.log(`   - G-paster.exe: ${(fs.statSync(exePath).size / 1024 / 1024).toFixed(2)} MB`);
  console.log(`   - Gpaster-Setup-0.999.2-win-x64.exe: ${(fs.statSync(nsisPath).size / 1024 / 1024).toFixed(2)} MB`);
  console.log(`   - Gpaster-Portable-0.999.2-win-x64.exe: ${(fs.statSync(portablePath).size / 1024 / 1024).toFixed(2)} MB`);
}

async function verifyPackagedRuntime() {
  console.log("\n2. Verifying packaged app startup and single-instance behavior...");
  const tempDir = fs.mkdtempSync(join(tmpdir(), "gpaster-pkg-test-"));
  const userDataDir = join(tempDir, "userData");
  fs.mkdirSync(userDataDir);

  let appProcess;
  try {
    // Launch primary instance in background mode with isolated userData
    appProcess = spawn(exePath, ["--gpaster-background"], {
      cwd: tempDir,
      env: { ...process.env, GPASTER_USER_DATA: userDataDir },
      stdio: "pipe",
      windowsHide: false
    });

    let stdoutData = "";
    let stderrData = "";
    appProcess.stdout?.on("data", (d) => { stdoutData += d.toString(); });
    appProcess.stderr?.on("data", (d) => { stderrData += d.toString(); });

    // Wait for app to register its global shortcut
    await waitFor(() => {
      return stdoutData.includes("Alt+V");
    }, "primary instance global shortcut registration (Alt+V)", 10000);

    console.log("   Primary instance started successfully and registered global shortcut (Alt+V).");

    // Launch secondary instance to test single-instance lock
    console.log("   Testing second instance mutex / single-instance lock...");
    const secondInstance = spawn(exePath, [], {
      cwd: tempDir,
      env: { ...process.env, GPASTER_USER_DATA: userDataDir },
      stdio: "ignore"
    });

    const secondExitCode = await new Promise((resolve) => {
      secondInstance.on("exit", (code) => resolve(code));
    });
    console.log(`   Second instance exited with code: ${secondExitCode} (mutex prevented duplicate running)`);
    assert.equal(secondExitCode, 0, "Second instance must cleanly exit without creating duplicate process");

    // Verify primary is still running
    assert.equal(appProcess.exitCode, null, "Primary instance remained running throughout second-instance check");

  } finally {
    if (appProcess && appProcess.exitCode === null) {
      console.log("   Terminating primary instance...");
      try {
        process.kill(appProcess.pid);
      } catch {}
      await delay(1000);
      try {
        // Ensure child processes (electron renderer/gpu/crashpad) are cleaned up
        execFile("taskkill", ["/PID", String(appProcess.pid), "/T", "/F"], () => {});
      } catch {}
    }
    await delay(1000);
    try {
      fs.rmSync(tempDir, { recursive: true, force: true, maxRetries: 5 });
    } catch {}
  }
}

async function run() {
  await verifyFiles();
  await verifyPackagedRuntime();
  console.log("\nAll packaged application verification checks PASSED successfully!");
}

run().catch((err) => {
  console.error("Packaged verification failed:", err);
  process.exit(1);
});
