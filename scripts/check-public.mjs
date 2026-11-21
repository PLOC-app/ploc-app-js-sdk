// Guard: nothing private may ship in this public repository.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "./lib.mjs";

const FORBIDDEN_FILES = [/(^|\/)sdk-private\b/, /(^|\/)sdk-assistant\b/, /(^|\/)internal\//, /(^|\/)state\//];
// Markers of the private extension (native-side permission names, private namespace).
const FORBIDDEN_CONTENT = [/PLScriptEngine/, /PLScriptPermissionManager/, /allowsPrivateMethods/, /\bsdk\.private\b/];
const SELF = new Set(["scripts/check-public.mjs"]);

const files = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], { cwd: ROOT, encoding: "utf8" })
    .split("\n").filter(Boolean);

const errors = [];
for (const f of files) {
    if (FORBIDDEN_FILES.some(r => r.test(f))) errors.push(`private file in repo: ${f}`);
    if (SELF.has(f) || !/\.(js|mjs|ts|json|md|html|txt|yml|yaml)$/.test(f)) continue;
    const text = readFileSync(join(ROOT, f), "utf8");
    for (const r of FORBIDDEN_CONTENT) if (r.test(text)) errors.push(`${f} mentions private API (${r})`);
}

for (const e of errors) console.error(`error ${e}`);
console.log(`public: ${files.length} files scanned, ${errors.length} error(s)`);
process.exit(errors.length ? 1 : 0);
