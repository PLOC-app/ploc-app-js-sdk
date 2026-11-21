// Validate types/sdk.d.ts:
//   1. coverage  - every public member of sdk.js (by reflection) is declared;
//   2. usage     - every catalog snippet type-checks against the declarations.
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { ROOT, expectedKeys, loadCatalog, loadSdk } from "./lib.mjs";

const errors = [];
const dtsPath = join(ROOT, "types/sdk.d.ts");
const sf = ts.createSourceFile("sdk.d.ts", readFileSync(dtsPath, "utf8"), ts.ScriptTarget.ES2022, true);

// ---- 1. coverage -----------------------------------------------------------
const classes = new Map();
sf.forEachChild(node => {
    if (!ts.isClassDeclaration(node) || !node.name) return;
    const members = { instance: new Map(), static: new Map() };
    for (const m of node.members) {
        if (!m.name || !ts.isIdentifier(m.name)) continue;
        const isStatic = m.modifiers?.some(x => x.kind === ts.SyntaxKind.StaticKeyword);
        (isStatic ? members.static : members.instance).set(m.name.text, m);
    }
    const ext = node.heritageClauses?.find(h => h.token === ts.SyntaxKind.ExtendsKeyword)?.types[0]?.expression;
    classes.set(node.name.text, { members, parent: ext && ts.isIdentifier(ext) ? ext.text : null, node });
});

function findMember(cls, name, kind) {
    for (let c = classes.get(cls); c; c = c.parent ? classes.get(c.parent) : null) {
        if (c.members[kind].has(name)) return c.members[kind].get(name);
    }
    return null;
}

const typeName = (member) => member?.type && ts.isTypeReferenceNode(member.type) ? member.type.typeName.getText(sf) : null;

const { classes: runtime, sdk } = loadSdk();
for (const key of expectedKeys()) {
    if (key.includes("#") || /^[A-Z]/.test(key)) {
        const [cls, m] = key.split(/[#.]/);
        const kind = key.includes("#") ? "instance" : "static";
        if (!classes.has(cls)) errors.push(`${key}: class ${cls} is not declared`);
        else if (!findMember(cls, m, kind)) errors.push(`${key}: ${kind} member not declared on ${cls}`);
        continue;
    }
    const [service, ...rest] = key.split(".");
    const svcType = typeName(findMember("SDK", service, "instance"));
    if (!svcType) { errors.push(`${key}: sdk.${service} is not declared on SDK`); continue; }
    if (service === "cellar" && rest.length === 2) {
        const repoType = typeName(findMember("CellarService", rest[0], "instance"));
        if (!repoType) errors.push(`${key}: CellarService.${rest[0]} is not declared`);
        else if (!findMember("Repository", rest[1], "instance")) errors.push(`${key}: Repository.${rest[1]} is not declared`);
        continue;
    }
    if (!findMember(svcType, rest[0], "instance")) errors.push(`${key}: ${svcType}.${rest[0]} is not declared`);
}

// Services and enumerations present at runtime must be declared too.
for (const service of Object.keys(sdk)) {
    if (!findMember("SDK", service, "instance")) errors.push(`sdk.${service} is not declared on SDK`);
}
for (const [name, cls] of Object.entries(runtime)) {
    if (name !== "Model" && !classes.has(name)) errors.push(`global class ${name} is not declared`);
    for (const s of Object.getOwnPropertyNames(cls)) {
        if (/^[A-Z][A-Z_]+$/.test(s) && !findMember(name, s, "static")) errors.push(`${name}.${s} (static constant) is not declared`);
    }
}

// ---- 2. usage: type-check every catalog snippet ----------------------------
const tmp = join(ROOT, ".tmp");
mkdirSync(tmp, { recursive: true });
const catalog = loadCatalog();
const body = Object.entries(catalog).map(([key, e], i) => {
    const code = e.snippet.replaceAll("{Class}", "Wine");
    return `// ${key}\nasync function snippet_${i}() {\n${code}\n}\n`;
}).join("\n");
// Browser globals used by snippets (the DOM lib is excluded on purpose, see above).
const env = `declare const console: { log(...a: unknown[]): void; error(...a: unknown[]): void };
declare function btoa(s: string): string;
declare function atob(s: string): string;
declare class File { constructor(parts: unknown[], name: string, options?: { type?: string }); readonly size: number; readonly type: string; readonly name: string }
`;
writeFileSync(join(tmp, "snippets.ts"), `/// <reference path="../types/sdk-scripts.d.ts" />\nexport {};\n${env}\n${body}`);

const options = {
    noEmit: true, strict: false, target: ts.ScriptTarget.ES2022, lib: ["lib.es2022.d.ts"], // no DOM: SDK's `Document` model replaces the DOM one
    skipLibCheck: false, noImplicitReturns: false, noUnusedLocals: false,
    // Snippets are pasteable examples: nullability is not enforced, names and signatures are.
    // Snippets use `return` at the end of a block for display: allow mixed return paths.
    allowUnreachableCode: true, types: [],
};
const program = ts.createProgram([join(tmp, "snippets.ts"), dtsPath], options);
const lines = readFileSync(join(tmp, "snippets.ts"), "utf8").split("\n");
for (const d of ts.getPreEmitDiagnostics(program)) {
    const text = ts.flattenDiagnosticMessageText(d.messageText, "\n");
    if (d.file && d.file.fileName.endsWith("snippets.ts")) {
        const { line } = d.file.getLineAndCharacterOfPosition(d.start);
        let k = line; while (k > 0 && !lines[k].startsWith("// ")) k--;
        errors.push(`snippet ${lines[k].slice(3)} (line ${line + 1}): TS${d.code} ${text}`);
    } else {
        errors.push(`${d.file ? d.file.fileName.replace(ROOT + "/", "") : "tsc"}: TS${d.code} ${text}`);
    }
}

for (const e of errors) console.error(`error ${e}`);
console.log(`types: ${errors.length} error(s)`);
process.exit(errors.length ? 1 : 0);
