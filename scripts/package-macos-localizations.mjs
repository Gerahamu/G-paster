import { stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const appPath = process.env.GPASTER_MAC_APP_PATH || resolve(root, "work/packaged/G-paster-darwin-arm64/G-paster.app");
const resources = resolve(appPath, "Contents/Resources");
await stat(resources);
for (const locale of ["en", "zh-Hans", "zh-Hant"]) {
  await stat(resolve(resources, `${locale}.lproj/InfoPlist.strings`));
}
console.log("macOS permission localization resources verified.");
