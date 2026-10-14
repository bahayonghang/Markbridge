# C02 current native acceptance — 2026-10-14

`pnpm build:native` passed, exit0, then `node .trellis/tasks/10-14-mb-c02-font-preferences/evidence/native-fonts.mjs` passed, exit0. This used a copied executable in a new OS temporary directory, a synthetic 122-node cache created by the existing Rust seeder, and real main-window IPC. No installer, daily Chrome profile, font installation/removal, model, commit or publication was used.

- Production source fingerprint: `5ad3791d1bdb11d6f837dfa2da1cd38c38b3b1fb16739dbe5bae304872678373`, identical before and after the build. Full input hashes: [current-source.json](current-source.json).
- Executable SHA256: `7209935053aff6b96592247d17622441df5a9e608432b680b432d4f66cabc5d1`; 25,627,648 bytes, release artifact scanner PASS.
- Raw run: [result.json](native/run-1791990497569-412d3a72/result.json), 11 controls PASS; screenshot and OS/WebView/process evidence are alongside it.
- Main PID2816 exited normally with code0; same isolated data directory restarted as PID114568 and restored dark/installed Microsoft YaHei UI/20px. The second process also exited0; no owned process or listener remained.

## Observed behavior

1. Ordinary General navigation did not enumerate fonts or write preferences. The main command returned302 local families, including Arial, Microsoft YaHei UI and SimSun. Independent GDI metadata cross-check is documented in [backend-validation.md](backend-validation.md) and [font-crosscheck.json](font-crosscheck.json); its larger count represents legacy aliases/weight groupings. The frozen raw run's `catalog.crossCheck` has a one-level-short relative path; the correct path from its directory is `../../font-crosscheck.json`. The producer was corrected for future runs without changing the frozen raw result.
2. `CSS.getPlatformFontsForNode` proved Arial rendered39 Latin glyphs while Microsoft YaHei UI rendered11 fallback Chinese glyphs. Selecting Microsoft YaHei UI rendered both the39 Latin and11 Chinese sample glyphs. No claim relies on a computed family stack or `document.fonts.check`.
3. Candidate selection left global font and persisted preferences unchanged; Escape canceled and returned focus. Explicit use saved the installed family. SimSun was also previewed at20px in the640×480 window and canceled.
4. Real tree/bookmark heights were40/52 at12px,40/56 at14px and48/76 at20px. The hidden120-row search preserved row30/pixel offset, unsaved note, selection, last-item visibility and checkbox focus across resizing.
5. Calibrated IPC request-path observation found no model/fetch/index/browser mutation caused by appearance changes and no remote-font request. The independent remote preview rejected every registered command, including `list_installed_fonts`; non-main caller guards also passed the Rust suite.
6. Actual process restart restored the same serialized v2 preference and actual YaHei glyph selection. Reset wrote only the v2 default. Synthetic v1 fixtures retained their original bytes, migrated system/yahei/song with12/13/15px in memory, and did not create v2 records on startup.
7. A synthetic missing-family record rendered local fallback glyphs. Missing-font status appeared only after a successful real catalog read; the chosen family remained persisted without automatic replacement.

The main session visually inspected the real dark20px restart screenshot and the browser20px picker/action screenshot. Native640×480 control access and document bounds passed. Broader all-page layout is C03; actual125%/150% monitor-DPI integration and current B10K performance remain C04. Original13/V12 and15/V18 remain unchanged.
