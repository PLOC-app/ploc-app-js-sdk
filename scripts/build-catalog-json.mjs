// Generate catalog/catalog.json (machine-readable) from catalog/sdk-catalog.js.
// Deterministic output (no timestamp) so CI can detect a stale file with `git diff --exit-code`.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT, loadCatalog, loadSdk } from "./lib.mjs";

const { classes } = loadSdk();
const catalog = loadCatalog();

const entries = {};
for (const [key, entry] of Object.entries(catalog)) {
    entries[key] = {
        desc: entry.desc,
        params: entry.params ?? [],
        snippet: entry.snippet,
    };
}

const json = { $schema: "./catalog.schema.json", sdkVersion: classes.SDK.version, count: Object.keys(entries).length, entries };
writeFileSync(join(ROOT, "catalog/catalog.json"), JSON.stringify(json, null, 2) + "\n");
console.log(`catalog/catalog.json: ${json.count} entries (SDK ${json.sdkVersion})`);
