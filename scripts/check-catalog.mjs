// Verify the catalog against sdk.js (reflection).
// Errors fail the build; warnings are informational.
import { expectedKeys, loadCatalog, loadSdk } from "./lib.mjs";

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
// Intentional entries that duplicate an inherited method with a more specific snippet.
const ALLOWED_EXTRA = new Set(["Wine#save", "Wine#delete"]);

const errors = [];
const warnings = [];
const catalog = loadCatalog();
const expected = expectedKeys();
const keys = new Set(Object.keys(catalog));

for (const k of expected) if (!keys.has(k)) errors.push(`missing in catalog: ${k}`);
for (const k of keys) {
    if (expected.has(k)) continue;
    (ALLOWED_EXTRA.has(k) ? warnings : errors).push(`${ALLOWED_EXTRA.has(k) ? "redundant" : "unknown (not in sdk.js)"} catalog entry: ${k}`);
}

// Entry shape + snippet syntax + declared parameter names.
const { classes, sdk } = loadSdk();
function declaredParams(key) {
    let fn;
    if (key.includes("#")) {
        const [cls, m] = key.split("#");
        fn = classes[cls]?.prototype?.[m];
    } else if (/^[A-Z]/.test(key)) {
        const [cls, m] = key.split(".");
        fn = classes[cls]?.[m];
    } else {
        const parts = key.split(".");
        const m = parts.pop();
        let target = sdk;
        for (const p of parts) target = target?.[p];
        fn = target?.[m] ?? (parts[0] === "cellar" && parts.length === 2 ? classes.Model[m] : undefined);
    }
    if (typeof fn !== "function") return null;
    const m = /^(?:async\s+)?(?:static\s+)?[\w$]*\s*\(([^)]*)\)/.exec(fn.toString());
    if (!m) return null;
    return m[1].split(",").map(s => s.trim().split("=")[0].trim()).filter(Boolean);
}

for (const [key, e] of Object.entries(catalog)) {
    if (typeof e.desc !== "string" || !e.desc.trim()) errors.push(`${key}: empty desc`);
    if (typeof e.snippet !== "string" || !e.snippet.trim()) { errors.push(`${key}: empty snippet`); continue; }
    if (e.params !== undefined && !Array.isArray(e.params)) errors.push(`${key}: params must be an array`);
    for (const p of e.params ?? []) {
        if (typeof p.name !== "string" || typeof p.type !== "string") errors.push(`${key}: invalid param ${JSON.stringify(p)}`);
    }

    try {
        new AsyncFunction("sdk", e.snippet.replaceAll("{Class}", "Wine"));
    } catch (err) {
        errors.push(`${key}: snippet does not parse (${err.message})`);
    }

    const declared = declaredParams(key);
    if (declared) {
        const top = (e.params ?? []).map(p => p.name).filter(n => !n.includes("."));
        if (top.length > declared.length) warnings.push(`${key}: catalog documents ${top.length} params, sdk.js declares ${declared.length} (${declared.join(", ")})`);
        top.forEach((n, i) => {
            if (declared[i] && declared[i] !== n) warnings.push(`${key}: param #${i + 1} is "${n}" in catalog, "${declared[i]}" in sdk.js`);
        });
    }
}

for (const w of warnings) console.warn(`warn  ${w}`);
for (const e of errors) console.error(`error ${e}`);
console.log(`catalog: ${keys.size} entries, ${expected.size} expected, ${errors.length} error(s), ${warnings.length} warning(s)`);
process.exit(errors.length ? 1 : 0);
