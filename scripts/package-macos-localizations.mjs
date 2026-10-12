import { cp, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const resources = resolve(root, "work/packaged/G-paster-darwin-arm64/G-paster.app/Contents/Resources");
await stat(resources);
for (const locale of ["en", "zh-Hans", "zh-Hant"]) {
  await cp(resolve(root, `assets/localizations/${locale}.lproj`), resolve(resources, `${locale}.lproj`), { recursive: true });
}
console.log("macOS permission descriptions localized.");
