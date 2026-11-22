# Changelog

All notable changes to the PLOC SDK are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- `Wine#getRacks()`, `Wine#getTastingNotes()` and `Wine#getOrders()` return the racks, tasting notes and orders of a wine (each a `Collection`). They use `find({ wineId })` and throw `INVALID_PARAMS` if the wine has no id.

### Changed
- `sdk.cellar.wine.find`, `sdk.cellar.tastingNotes.find` and `sdk.cellar.rack.find` take a search `query` (a string, or `{ query }`) instead of a `name`, and match like the app's search field. `tastingNotes.find` and `rack.find` also accept `{ wineId }`, alone or with `query`, to restrict to one wine.

## [1.0.0] - 2026-11-21

Requires PLOC 7.0 or later.

### Added
- First public release of the SDK reference: `sdk.js`, TypeScript declarations (`types/`) and the machine-readable API catalog (`catalog/catalog.json`).
- Services: `ui`, `cellar` (one repository per model), `network`, `dialog`, `haptics`, `clipboard`, `backup`, `ploud`, `csv`, `pdf`, `files`, `translations`, `miniApps`, `account`, `app`, `storage`.
- Models: `Wine`, `Rack`, `RackItem`, `Order`, `TastingNotes`, `Document`, `Country`, `Region`, `Appellation`, `Grape`, `Classification`, `Color`, `BottleFormat`, `Vendor`, `Owner`, `Parameter`, and the `Collection` result type.

[Unreleased]: https://github.com/PLOC-app/ploc-app-js-sdk/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/PLOC-app/ploc-app-js-sdk/releases/tag/v1.0.0
