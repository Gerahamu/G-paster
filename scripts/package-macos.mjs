import { spawnSync } from "node:child_process";
import { access } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputDirectory = resolve(root, process.env.GPASTER_MAC_OUT || "work/packaged");
const appPath = join(outputDirectory, "G-paster-darwin-arm64", "G-paster.app");
const unsigned = process.argv.includes("--unsigned");
const adHoc = process.argv.includes("--adhoc");
const noDeveloperId = unsigned || adHoc;

function run(command, args, label) {
  const result = spawnSync(command, args, { cwd: root, env: process.env, stdio: "inherit" });
  if (result.error) throw new Error(`${label} could not start: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`${label} failed with exit code ${result.status ?? "unknown"}`);
}

function capture(command, args, label) {
  const result = spawnSync(command, args, { cwd: root, env: process.env, encoding: "utf8" });
  if (result.error) throw new Error(`${label} could not start: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`${label} failed with exit code ${result.status ?? "unknown"}`);
  return `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
}

async function signingOptions() {
  const identity = process.env.GPASTER_MAC_IDENTITY?.trim();
  if (!identity || !identity.startsWith("Developer ID Application:")) {
    throw new Error("Set GPASTER_MAC_IDENTITY to the exact Developer ID Application certificate name.");
  }
  const identityMatch = identity.match(/\(([A-Z0-9]{10})\)$/);
  if (!identityMatch) throw new Error("The signing identity must include its 10-character Apple Team ID.");
  const identities = capture("security", ["find-identity", "-v", "-p", "codesigning"], "Signing identity check");
  if (!identities.split(/\r?\n/).some((line) => line.includes(`\"${identity}\"`))) {
    throw new Error("The configured Developer ID certificate is not available in the macOS keychain.");
  }

  const profile = process.env.APPLE_NOTARY_PROFILE?.trim();
  const keyPath = process.env.APPLE_API_KEY?.trim();
  const keyId = process.env.APPLE_API_KEY_ID?.trim();
  const issuer = process.env.APPLE_API_ISSUER?.trim();
  const hasAnyApiKeyValue = Boolean(keyPath || keyId || issuer);
  if (profile && hasAnyApiKeyValue) throw new Error("Configure either APPLE_NOTARY_PROFILE or the complete App Store Connect API key set, not both.");
  if (profile) return ["--osx-notarize.keychainProfile", profile];
  if (!keyPath || !keyId || !issuer) {
    throw new Error("Set APPLE_NOTARY_PROFILE or all of APPLE_API_KEY, APPLE_API_KEY_ID, and APPLE_API_ISSUER.");
  }
  await access(keyPath);
  return [
    `--osx-notarize.appleApiKey=${keyPath}`,
    `--osx-notarize.appleApiKeyId=${keyId}`,
    `--osx-notarize.appleApiIssuer=${issuer}`
  ];
}

async function verifyReleaseApp(teamId) {
  run("codesign", ["--verify", "--deep", "--strict", "--verbose=2", appPath], "Strict code signature verification");
  run("xcrun", ["stapler", "validate", appPath], "Notarization ticket validation");
  const details = capture("codesign", ["-dv", "--verbose=4", appPath], "Code signature details");
  if (!details.includes(`TeamIdentifier=${teamId}`) || !details.includes("Authority=Developer ID Application:") || !/flags=.*runtime/.test(details)) {
    throw new Error("The packaged app is missing the expected Developer ID team or hardened runtime signature.");
  }
  const assessment = capture("spctl", ["--assess", "--type", "execute", "--verbose=2", appPath], "Gatekeeper assessment");
  if (!/accepted/.test(assessment) || /override=security disabled/.test(assessment)) {
    throw new Error("Gatekeeper did not confirm this app under the host's normal security policy.");
  }
}

async function main() {
  if (process.platform !== "darwin") throw new Error("macOS packaging must run on macOS.");
  const identityArgs = noDeveloperId ? [] : await signingOptions();
  const identity = noDeveloperId ? null : process.env.GPASTER_MAC_IDENTITY.trim();

  run("npm", ["run", "build"], "Production build");
  const args = [
    ".", "G-paster",
    "--platform=darwin", "--arch=arm64", `--out=${outputDirectory}`, "--overwrite",
    "--app-bundle-id=com.gpaster.desktop", "--icon=assets/G-paster.icns",
    "--extend-info=scripts/macos-agent-info.plist",
    "--extra-resource=assets/localizations/en.lproj",
    "--extra-resource=assets/localizations/zh-Hans.lproj",
    "--extra-resource=assets/localizations/zh-Hant.lproj",
    "--ignore=^/(work|outputs|src|electron|scripts|docs)(/|$)|^/node_modules/(\\.vite|\\.package-lock\\.json)(/|$)|^/(README\\.md|CHANGELOG\\.md|index\\.html|vite\\.config\\.mts|tsconfig\\.[^/]+\\.json|\\.gitignore)$|^/assets/(G-paster\\.icns|G-paster-brand\\.png|tray-icon\\.svg|GpasterTemplate(@2x)?\\.png|localizations)(/|$)"
  ];

  let teamId;
  if (!noDeveloperId) {
    teamId = identity.match(/\(([A-Z0-9]{10})\)$/)?.[1];
    args.push(
      `--osx-sign.identity=${identity}`,
      "--osx-sign.hardenedRuntime",
      "--no-osx-sign.continueOnError",
      ...identityArgs
    );
  }
  const packagerBin = join(root, "node_modules", ".bin", "electron-packager");
  run(packagerBin, args, noDeveloperId ? "Unsigned QA package" : "Signed and notarized macOS package");
  process.env.GPASTER_MAC_APP_PATH = appPath;
  run("node", ["scripts/package-macos-localizations.mjs"], "Localization resource verification");

  if (adHoc) {
    run("codesign", ["--force", "--deep", "--sign", "-", appPath], "Ad-hoc signing");
    run("codesign", ["--verify", "--deep", "--strict", "--verbose=2", appPath], "Ad-hoc signature verification");
  }
  if (!noDeveloperId) await verifyReleaseApp(teamId);
  console.log(adHoc
    ? "Ad-hoc QA package created; do not distribute it."
    : unsigned ? "Unsigned QA package created; do not distribute it."
      : "Signed, notarized, stapled, and Gatekeeper-accepted macOS package verified.");
}

main().catch((error) => {
  console.error(`macOS packaging blocked: ${error instanceof Error ? error.message : "unknown error"}`);
  process.exitCode = 1;
});
