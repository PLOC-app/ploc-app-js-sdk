# PLOC SDK

[![CI](https://github.com/PLOC-app/ploc-app-js-sdk/actions/workflows/ci.yml/badge.svg)](https://github.com/PLOC-app/ploc-app-js-sdk/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Client SDK running inside the PLOC app (7.0 and later), for **scripts** and **mini apps**.

The PLOC app **injects the SDK for you**: there is nothing to install or bundle. This repository is the public
**reference** of that SDK: its source, its TypeScript declarations and its API catalog.

| What | Where |
|---|---|
| SDK source, as injected by the app | [`sdk.js`](sdk.js) |
| TypeScript declarations (autocompletion, type checking) | [`types/sdk.d.ts`](types/sdk.d.ts) |
| API catalog: every method with description, params and a ready-to-paste snippet | [`catalog/catalog.json`](catalog/catalog.json) |

## Hello PLOC

In a script or a mini app, `sdk` is already available (the app injects it):

```js
const info = await sdk.cellar.getInfo();
const wines = await sdk.cellar.wine.find("Margaux");

await sdk.dialog.toast(`${wines.count} wine(s) out of ${info.counts.wines}`);
return wines.map(w => w.name).toArray();
```

Use it directly: do not declare `sdk` yourself (`const sdk = ...`), it is already declared and the page would fail to load.

`sdk` is also available as `window.sdk` / `globalThis.sdk`.

Outside PLOC (a regular browser), `sdk` does not exist, so guard with `typeof sdk === "undefined"`. A page that loads `sdk.js` itself (local development, tests) creates the instance:

```js
globalThis.sdk = new SDK(new Authorization());
```

The SDK then falls back to a mock gateway: `sdk.isMock` is `true` and native calls are not available.

## Services

`sdk.ui` · `sdk.cellar` · `sdk.network` · `sdk.dialog` · `sdk.haptics` · `sdk.clipboard` · `sdk.backup` · `sdk.ploud` · `sdk.csv` · `sdk.pdf` · `sdk.files` · `sdk.translations` · `sdk.miniApps` · `sdk.account` · `sdk.app` · `sdk.storage`

`sdk.cellar` exposes one repository per model (`wine`, `rack`, `order`, `tastingNotes`, `document`, `country`, `region`, `appellation`, `grape`, `classification`, `color`, `bottleFormat`, `vendor`, `owner`, `parameter`), each with `get`, `getAll`, `find` and `findFirst`. Results of `getAll` and `find` are a `Collection`: use `.count`, `.isEmpty`, `.first` and `.toArray()` (there is no `.length`).

Every method is documented in [`catalog/catalog.json`](catalog/catalog.json).

## TypeScript and editor support

```ts
/// <reference path="path/to/ploc-app-js-sdk/types/sdk.d.ts" />
```

In a script, also reference `types/sdk-scripts.d.ts`: it types the `sdk` instance provided by the app.

For plain JavaScript, the same references work with `// @ts-check` or `checkJs`. Use `"lib": ["ES2022"]` without `"dom"`: `sdk.js` replaces `globalThis.Document` with the PLOC `Document` model, which conflicts with the DOM type (with `"dom"`, set `"skipLibCheck": true`).

## Compatibility

The SDK ships inside the app, so the available API depends on the app version.

| SDK | `SDK.versionCode` | PLOC app |
|---|---|---|
| 1.0.0 | 1 | 7.0 and later |

At runtime: `SDK.version`, `SDK.versionCode` and `await sdk.app.getInfo()`.

## Related repositories

| Repository | Content |
|---|---|
| [ploc-scripts](https://github.com/PLOC-app/ploc-scripts) | Scripts for PLOC, shared by the community |
| [ploc-miniapps](https://github.com/PLOC-app/ploc-miniapps) | Mini apps for PLOC |
| [ploc-skills](https://github.com/PLOC-app/ploc-skills) | Skills that help an AI assistant write scripts and mini apps with this SDK |

## Community

Questions, ideas, scripts and mini apps to share: join the [PLOC communities](https://www.ploc.co/community/).

## Contributing

Issues and pull requests are welcome. `sdk.js` is a snapshot of the runtime injected by the app, so API changes are made in the app first. Run `npm ci && npm run check` before opening a pull request: it verifies that `types/` and `catalog/` stay in sync with `sdk.js`. Changes are listed in the [CHANGELOG](CHANGELOG.md). Report vulnerabilities as described in [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE)
