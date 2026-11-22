// Shared helpers: load sdk.js and the catalog inside a sandbox (no native bridge needed).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const read = (rel) => readFileSync(join(ROOT, rel), "utf8");

// Public globals exported by sdk.js (globalThis.X = X).
// Classes that are not exported but are part of the documented surface are listed in EXTRA_CLASSES.
const EXTRA_CLASSES = ["Model"];

export function loadSdk() {
    const source = read("sdk.js");
    const exported = [...source.matchAll(/^globalThis\.(\w+) = \1;$/gm)].map(m => m[1]);
    const names = [...new Set([...exported, ...EXTRA_CLASSES])];

    const context = vm.createContext({ console: { log() {}, error() {} }, window: {}, setTimeout, clearTimeout, TextEncoder, TextDecoder, atob, btoa });
    const classes = vm.runInContext(`${source}\n;({ ${names.join(", ")} })`, context, { filename: "sdk.js" });
    const sdk = vm.runInContext("new SDK(new Authorization('check'))", context);

    return { source, classes, exported, sdk };
}

const isPublic = (name) => !name.startsWith("_") && name !== "constructor";

function own(target, { statics = false } = {}) {
    const out = [];
    for (const name of Object.getOwnPropertyNames(target)) {
        if (!isPublic(name)) continue;
        const d = Object.getOwnPropertyDescriptor(target, name);
        if (statics) {
            if (typeof d.value === "function") out.push(name);
        } else if (typeof d.value === "function") {
            out.push(name);
        }
    }
    return out;
}

// Every key the catalog is expected to contain, derived from sdk.js by reflection.
export function expectedKeys() {
    const { classes, sdk } = loadSdk();
    const keys = new Set();
    const skipServices = new Set(["bridge", "cellar"]);

    for (const [service, instance] of Object.entries(sdk)) {
        if (service === "cellar") {
            keys.add("cellar.getInfo");
            for (const [repo, repository] of Object.entries(instance)) {
                if (repository?.model) {
                    for (const m of ["get", "getAll", "find", "findFirst"]) keys.add(`cellar.${repo}.${m}`);
                }
            }
            continue;
        }
        if (skipServices.has(service) || typeof instance !== "object" || instance === null) continue;
        for (const m of own(Object.getPrototypeOf(instance))) keys.add(`${service}.${m}`);
    }

    // Models: only methods defined by the class itself. Static get/getAll/find/findFirst are covered by cellar.*.
    for (const [name, cls] of Object.entries(classes)) {
        if (["Authorization", "SDK"].includes(name)) continue;
        if (cls._undocumented === true) continue;
        for (const m of own(cls.prototype)) {
            if (m === "toJSON") continue;
            keys.add(`${name}#${m}`);
        }
        for (const m of own(cls, { statics: true })) {
            if (["get", "getAll", "find", "findFirst"].includes(m)) continue;
            keys.add(`${name}.${m}`);
        }
    }
    return keys;
}

export function loadCatalog() {
    const context = vm.createContext({ window: {} });
    vm.runInContext(read("catalog/sdk-catalog.js"), context, { filename: "sdk-catalog.js" });
    return context.window.SDK_CATALOG;
}
