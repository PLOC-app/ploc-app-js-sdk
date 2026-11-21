// Pull sdk.js and sdk-catalog.js from the private repository (the source of truth) into this one.
//   npm run sync -- /path/to/ploc-sdk          (or set PLOC_SDK_PATH; default: ../ploc-sdk)
// Then run `npm run check` to see what must be updated in catalog/ and types/.
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { execFileSync } from "node:child_process";
import { ROOT } from "./lib.mjs";

const source = resolve(process.argv[2] ?? process.env.PLOC_SDK_PATH ?? join(ROOT, "..", "ploc-sdk"));
const files = [
    ["sdk.js", "sdk.js"],
    ["sdk-catalog.js", "catalog/sdk-catalog.js"],
];

for (const [from] of files) {
    if (!existsSync(join(source, from))) {
        console.error(`error ${join(source, from)} not found. Pass the private repository path.`);
        process.exit(1);
    }
}

const dirty = execFileSync("git", ["status", "--porcelain", "--", "sdk.js", "sdk-catalog.js"], { cwd: source, encoding: "utf8" }).trim();
if (dirty) console.warn(`warn  uncommitted changes in the private repository:\n${dirty}`);

for (const [from, to] of files) copyFileSync(join(source, from), join(ROOT, to));

// The private header says "All rights reserved"; this repository is MIT.
const target = join(ROOT, "sdk.js");
const js = readFileSync(target, "utf8");
const header = /Copyright \(c\) (\d{4}) PLOC, Inc\. All rights reserved\./;
if (header.test(js)) writeFileSync(target, js.replace(header, "Copyright (c) $1 PLOC. Released under the MIT License."));
else console.warn("warn  copyright header not recognized in sdk.js, check it by hand");

const head = execFileSync("git", ["log", "-1", "--format=%h %s"], { cwd: source, encoding: "utf8" }).trim();
console.log(`synced sdk.js and catalog/sdk-catalog.js from ${source} (${head})`);
console.log("next: npm run check, update catalog/ and types/ if it reports anything, then CHANGELOG and commit.");
