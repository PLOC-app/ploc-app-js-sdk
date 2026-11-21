// All version markers must agree: sdk.js (header + SDK.version/versionCode), sdk.d.ts header,
// package.json, the latest CHANGELOG entry, and the git tag when running on a tag.
import { read } from "./lib.mjs";

const errors = [];
const pkg = JSON.parse(read("package.json")).version;
const js = read("sdk.js");
const header = /PLOC SDK v([\w.+-]+)/.exec(js)?.[1];
const runtime = /SDK\.version = "([^"]+)"/.exec(js)?.[1];
const code = Number(/SDK\.versionCode = (\d+)/.exec(js)?.[1]);
const dts = /PLOC SDK v([\w.+-]+)/.exec(read("types/sdk.d.ts"))?.[1];
const changelog = /^## \[(\d[^\]]*)\]/m.exec(read("CHANGELOG.md"))?.[1];
const tag = process.env.GITHUB_REF_TYPE === "tag" ? process.env.GITHUB_REF_NAME.replace(/^v/, "") : null;

const markers = { "package.json": pkg, "sdk.js header": header, "SDK.version": runtime, "types/sdk.d.ts header": dts, "CHANGELOG.md": changelog };
if (tag) markers["git tag"] = tag;
for (const [name, v] of Object.entries(markers)) if (v !== pkg) errors.push(`${name} is ${v ?? "missing"}, expected ${pkg}`);

const major = Number(pkg.split(".")[0]);
if (!Number.isInteger(code) || code < 1) errors.push("SDK.versionCode must be a positive integer");
if (Number.isInteger(code) && code < major) errors.push(`SDK.versionCode (${code}) must not be lower than the major version (${major})`);

for (const e of errors) console.error(`error ${e}`);
console.log(`version: ${pkg} (code ${code}), ${errors.length} error(s)`);
process.exit(errors.length ? 1 : 0);
