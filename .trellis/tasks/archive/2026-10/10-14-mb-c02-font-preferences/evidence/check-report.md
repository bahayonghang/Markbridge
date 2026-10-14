# C02 independent review — 2026-10-14

Reviewed the active child PRD/design/implementation plan, check manifest, parent font/geometry contracts, generated protocol path, Windows command/service, preference/picker lifecycle, shared row metrics, tests and current browser evidence. This report covers the current C01+C02 working tree, without changing task state or historical acceptance.

Production fingerprint at review: `5ad3791d1bdb11d6f837dfa2da1cd38c38b3b1fb16739dbe5bae304872678373` (371 production files), from `current-source.json`. No product file was changed by this reviewer.

## Findings (fixed)

- No product defect required a reviewer fix.
- Review identified stale default-row and size wording in frontend specs. The owning frontend worker synchronized `component-guidelines.md` and `quality-guidelines.md` with the v2 contract (14px default, 56px bookmark rows, 12–20px range), alongside the updated `ui-preferences.md`.
- Native-harness inspection suggested using the actual seeded Profile/bookmark identity for preview denial. The main coordinator changed the harness to `pb10k` / `10`; this is an evidence clarification, not a product permission change.

## Findings (not fixed)

- No unresolved static product finding. The command performs the exact trusted-main guard before the blocking DirectWrite call; the local collection excludes downloadable fonts. UTF-16 allocation, scalar/control bounds, catalog count and Windows ordinal deduplication are bounded. No capability, CSP, database or extension-protocol expansion was introduced.
- Rust DTO → schema/TypeScript/Ajv → unknown IPC validation stays intact. The adapter issues only the no-argument font command. Controls, lone surrogates, oversize values and additional private fields are rejected by the current validators/tests.
- GeneralSettings remains mounted under App, keeping its session cache across ordinary navigation. Enumeration is explicit, physical requests are single-flight, close/reopen generations discard stale UI/cache updates, and StrictMode replay preserves the current request. Preview does not save or globally apply candidates.
- v2 reading/migration preserves v1 bytes, defaults invalid fields independently and writes only on explicit actions. Installed names become a single escaped CSS string plus fixed fallback. A failed catalog cannot establish that a font is missing. Root CSS and virtual rows share the pure metrics function; the existing hidden anchor, bottom and checkbox handling is preserved.
- No remaining C02 acceptance blocker after the native receipt review below. Actual 125%/150% monitor DPI integration remains C04 scope and is not claimed by C02's recorded WebView device-pixel ratio alone. Installation, daily Chrome and font installation/removal remain NOT_RUN/outside this test scope.

## Verification

Independently executed with exit code 0:

- Lint: PASS — `pnpm lint`.
- TypeCheck: PASS — `pnpm typecheck` (protocol, extension, desktop and tools).
- Tests: PASS — four targeted Vitest files, **48 tests**: UI preferences, picker/catalog lifecycle, font IPC adapter and generated font DTO validation.
- Diff whitespace: PASS — `git diff --check`.
- Generated validator spot check: trailing LF/CR rejected; allowed Unicode line/paragraph separators remain ordinary non-control scalar names, matching the Rust control-category contract.

Reviewed rather than reran the owning workers' current gates: `backend-validation.md` records protocol drift, Rust 35 desktop + 16 protocol, clippy/fmt and the two actual Windows metadata probes; `frontend-validation.md` records 272 Vitest + 25 Node, build and the browser matrix. The initial browser race failure remains retained; the corrected picker run passed 12/12, alongside the other 74 matrix cases. No competing Cargo/native build was started by the reviewer.

Visually inspected `frontend-catalog-final/font-picker/light-20-640x480-actions.png` and `frontend-final/appearance/dark-20-通用-640x480.png`: modal actions remain reachable after internal scrolling, selected font preview is readable, and the General page keeps its own scroll region at the minimum viewport. These are browser screenshots, not native glyph or DPI evidence.

## Final native review and C02 acceptance

Reviewed the raw [native result](native/run-1791990497569-412d3a72/result.json), the producing `native-fonts.mjs` assertions, actual isolated main-WebView directory observations and both normal-close records. The run records **11 controls PASS**, Windows 11 Pro / WebView `Edg/155.0.4283.45`, production fingerprint matching the static review, and executable SHA256 `7209935053aff6b96592247d17622441df5a9e608432b680b432d4f66cabc5d1`. Independently rehashed the current release executable and confirmed that exact SHA256. This review did not rerun or rewrite the native result.

| Child criterion | Final review | Evidence |
|---|---|---|
| AC-C02-1 | PASS | Real main IPC returned 302 installed families, with CJK/Latin samples cross-checked against [local inventory](font-crosscheck.json). All 81 registered commands, including `list_installed_fonts`, returned `DENIED` in the real remote preview. Exact non-main label guard also remains covered by Rust command-inventory tests. |
| AC-C02-2 | PASS | Current unit/browser tests cover search, keys, refresh, empty/error/late replies and bounded 1000-family DOM. Native candidate cancel/apply and focus passed. `CSS.getPlatformFontsForNode` recorded Arial's 39 Latin glyphs with 11 CJK glyphs falling back to Microsoft YaHei UI; selected YaHei rendered both samples directly. |
| AC-C02-3 | PASS | All 12–20 inputs/formula cases pass unit tests; native 12/14/20 measurements match folder 40/40/48 and bookmark 52/56/76. Browser 24/120 anchors and native 120-row hidden resize, draft, selection, bottom and checkbox checks pass with 1 CSSpx tolerance. Minimum 640×480 at20px is covered in browser and native screenshots. |
| AC-C02-4 | PASS | Read-only legacy cases retain system/yahei/song and12/13/15; malformed/unknown/storage-denied cases pass automated tests. Native PID2816 exited0, PID114568 reopened the same isolated store and restored dark/installed-YaHei/20px with actual YaHei glyph evidence. Reset and synthetic missing-font fallback preserve the intended storage boundaries. |
| AC-C02-5 | PASS | Protocol drift, schema/adapter tests, source review and calibrated native request observation agree. Ordinary General access did not enumerate or persist. Appearance interactions emitted only the expected font/local read commands and zero remote font requests; no catalog logging, paths, bytes or business write was added. |

The second process also exited0, both owned WebView identities became absent, and the final process/listener arrays are empty. The executable was copied to a new temporary fixture; no installer, daily browser or font installation was used. The raw result's `crossCheck` field used a one-level-short relative reference; the correct evidence target is linked above, and the frozen raw result is retained unchanged.

Also visually inspected native `font-SimSun-candidate.png` (640×480,20px) and `library-20.png` (1100×760): the picker scrolls within the viewport, its local family labels remain readable, and the 76px bookmark rows show title/URL without clipping or overlap. C02 AC1–AC5 are supported as PASS; the coordinator may advance the approved sequence to C03. C04's final layout/DPI/performance integration and the unrelated legacy13/V12 and15/V18 gates remain separate.
