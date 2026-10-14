# C02 frontend implementation and verification

2026-10-14. Frontend implements the approved v2 preference and installed-font picker contract. Current source receipt is `current-source.json`; production fingerprint at this handoff: `5ad3791d1bdb11d6f837dfa2da1cd38c38b3b1fb16739dbe5bae304872678373`. Later native evidence must retain its own matching executable/source facts.

## Changes

- `ui-preferences.ts`: normalized v2, read-only legacy migration, safe single-string font-family escaping, exact12..20px validation and shared metrics. `App` and `VirtualRows` consume the same geometry; main startup retains its existing pre-render application path.
- `GeneralSettings`, `FontPicker`, `font-catalog`: explicit searchable installed-family selection, stable list-name font, separate presets, candidate-only sample, apply/cancel/refresh, per-App session cache and physical single-flight IPC. Closed/queued generations cannot overwrite UI/cache or start work after closing. React StrictMode effect replay keeps one request. Numeric input drafts do not change valid settings until Enter/blur; reset clears invalid drafts.
- `styles.css`: replaces transitional rem role ratios with metrics, relative role line heights, flexible header and bounded scrollable picker. C01 warm colors remain.
- Unit/App and browser tests cover lifecycle, migration, denial, Unicode/CSS, geometry, scroll anchors, drafts and focus. Frontend preferences/component/quality specs reflect v2.

## Executed checks

All commands used the project pnpm12.12.0 runner. The sandbox pnpm shim stalls in this environment; these commands ran through the approved outside-sandbox local runner.

| Command | Result |
|---|---|
| `pnpm exec vitest run apps/desktop/src/features/settings/ui-preferences.test.tsx apps/desktop/src/features/settings/font-picker.test.tsx apps/desktop/src/App.test.tsx` | PASS65 tests, exit0 |
| `pnpm lint` | PASS exit0, final after lifecycle fix |
| `pnpm typecheck` | PASS exit0, final after lifecycle fix |
| `pnpm test` | PASS272 Vitest +25 Node tests, exit0; includes protocol drift and CSP validator checks |
| `pnpm build` | PASS exit0; production asset scanner passes. Existing extension chunk-size warning remains informational |
| `git diff --check` | PASS exit0 |

## Browser runs and retained failures

1. `frontend-first`: targeted20 tests,18PASS/2FAIL. Both failures detected duplicate native-catalog invocation caused by React StrictMode effect cleanup/replay. Corrected consumer retain/release handling and added lifecycle coverage. This initial run is not a pass receipt.
2. `frontend-final`: `pnpm exec playwright test tests/e2e/font-picker.spec.ts tests/e2e/appearance.spec.ts tests/e2e/appearance-captions.spec.ts tests/e2e/settings-layout.spec.ts --workers=2`:85PASS/1FAIL, exit1. All74 non-picker tests and11 picker tests passed. The failure exposed two queued reopen consumers receiving different generations. The queue now shares one generation-bound promise; a targeted unit regression checks promise identity and double-close cancellation.
3. `frontend-catalog-final`: `pnpm exec playwright test tests/e2e/font-picker.spec.ts --workers=2`:12PASS, exit0. This is the corrected complete font-picker suite. Combined coverage is86 distinct browser tests, with the earlier failure retained rather than relabeled.

All screenshot commands set `MARKBRIDGE_EVIDENCE_DIR` to the corresponding new C02 evidence directory. Screenshots and JSON cover1440x900,1100x760,640x760,1100x480,640x480,1920x1080,2549x1356, both themes and12/14/20px; five settings categories and confirmation. Captions remain at least12px. The24/120-row tests verify hidden-resize middle anchor/pixel offset, note draft/selection, checkbox focus, keyboard reveal and bottom preservation. Computed text/control/focus contrast is unchanged from the C01 thresholds.

The corrected picker run checks1002 synthetic families with fewer than20 mounted options; display/canonical-name search; ArrowDown focus/selection; candidate font confined to sample; Escape returns trigger focus; reopen uses cache; explicit refresh increments census count; apply uses keyboard Enter; no business calls. Low-window20px screenshots show reachable cancel/apply actions and a dialog contained within640x480. The font-picker and General20px light screenshots were visually inspected.

## Evidence boundaries

Browser catalogs are clearly synthetic fixtures and do not prove installed fonts or glyphs. Main-session native receipts separately own actual DirectWriteCJK/Latin enumeration, platform-font glyph mapping, main/preview command denial, isolated real process restart and DPI evidence. No daily Chrome profile, font installation, commit, archive, package installation or publication was performed by this frontend implementation.
