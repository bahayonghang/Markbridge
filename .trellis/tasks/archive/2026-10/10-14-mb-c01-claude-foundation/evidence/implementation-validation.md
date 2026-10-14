# C01 implementation validation, 2026-10-14

This receipt describes the implementer's pre-review tree. Independent C01 review found that native HTML `small` elements still use the browser's smaller size; the reviewer owns the focused correction and final fingerprint. The results below remain tied to `pre-review-fingerprint.json`, not a later tree.

## Change boundary

- `apps/desktop/src/styles.css`: one warm light/dark semantic palette; `--accent` and `--focus` replace the color-named interaction token; ink primary buttons and explicit hover/pressed/disabled states; selected-hover preservation across navigation, tabs, breadcrumbs, history and checked rows; local mono font role; shared transitional font roles; caption floor12px; 8px controls and12px dialogs, with one floating shadow.
- `tests/e2e/appearance.spec.ts`: current computed text/border/focus measurements, pressed/disabled/selected/error/loading/read-only consumers; all three v1 sizes, six official viewports and the user-reference2549×1356; measured row and caption bounds.
- `DESIGN.md`, frontend component and UI-preference specs: approved C01 implementation and the remaining C02 metrics boundary.
- V1 body sizes12/13/15, tree rows40/40/48, bookmark rows48/52/60, control minima40/40/44, persistence and business state ownership remain unchanged. No product TSX, IPC, Rust, extension or font asset changed.

## Executed checks

Commands ran from the repository root through `rtk proxy`; local pnpm execution required the approved elevated tool context because its sandbox launcher hung. This is a tooling distinction, not a product failure.

| Check | Result |
|---|---|
| `pnpm lint` | PASS, exit0; repeated after final matrix assertions |
| `pnpm typecheck` | PASS, exit0; repeated after final matrix assertions |
| `pnpm test` | PASS, exit0;232 Vitest tests in28 files,25 Node tests; includes protocol drift/CSP checks |
| `pnpm build` | PASS, exit0; final pre-review desktop CSS `index-CZuVysH-.css`; production artifact scanner passed |
| `pnpm exec playwright test tests/e2e/appearance.spec.ts tests/e2e/shell.spec.ts tests/e2e/settings-layout.spec.ts --workers=2` | PASS, exit0;83 tests,1.2min; current output `after-final/` |
| `git diff --check` | PASS, exit0; Git reports normal working-copy LF→CRLF notices |

The existing extension chunk-size advisory and NO_COLOR/FORCE_COLOR notices remain warnings, without a failing exit. The initial focused contrast attempts failed three times because the new selectors matched navigation plus breadcrumb, duplicate loading messages, or scoped a cache alert to the wrong container. The selectors were corrected from actual DOM/source evidence. The first full matrix then passed65/65 in44.1s (`after/`), followed by the expanded83/83 result above. No failed color result was hidden by lowering a threshold.

## Browser evidence

`before/` is the main-session baseline and was not modified. `after-final/` contains329 screenshots and51 JSON receipts from headless Playwright Chromium with the existing synthetic `mockBridge` scenarios. No daily Chrome profile was used.

- Palette/size/category matrix: light and dark × small/standard/large ×1440×900,1100×760,640×760,1100×480,640×480,1920×1080,2549×1356; each checks General, connection, AI, semantic and export panels plus confirmation.
- Actual root sizes12/13/15 and row heights48/52/60 were measured. Titles and captions stayed inside the measured rows. Caption size was at least12px. Category/content bounds, internal top reset and reachable final controls passed.
- All three font presets, theme-system changes and fixed themes, reset isolation, storage failure, unknown version preservation, draft/selection/checkbox focus, hidden-list middle/bottom anchors with24/120 rows and keyboard reveal passed.
- `appearance/light-contrast.json` and `dark-contrast.json` each contain40 actual rendered text/boundary/focus measurements, in addition to the token-pair precheck. Minimum actual text ratio: light4.547959, dark5.346641 (required4.5). Minimum actual border/focus ratio: light3.929899, dark3.892913 (required3). Consumers include title/URL, selected navigation/bookmark/detail tab/theme/category, keyboard focus, text input, disabled listener, primary/ordinary hover/pressed, dialog text/action, pairing/cache/startup errors, read-only and loading states.
- Visually inspected light/dark General1440×900, light large General640×480, library1440×900, dark large confirmation640×480 and connection2549×1356. Warm surfaces and terracotta interaction states are consistent; Markbridge's blue icon remains intact. The minimum-window dialog keeps copy and both actions visible. Wide connection whitespace/reading widths remain C03 scope.

## Boundaries and follow-up

These are browser/mock and build results. Fresh native process restart, installed-font rendering and actual monitor DPI are NOT_RUN in C01 and remain C02/C04 work. This receipt does not close original13/V12,15/V18 or imply native acceptance, installation, signing, commit, archival or publication.

Independent review must append its `small` fix, targeted checks and final source/build hashes before C01 is accepted. Main session owns task status and AC checkboxes.
