import { rm } from "node:fs/promises";

await rm(new URL("../dist-electron/", import.meta.url), { recursive: true, force: true });
