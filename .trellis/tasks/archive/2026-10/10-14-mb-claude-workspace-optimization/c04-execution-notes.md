# C04 preparation notes (no execution yet)

C03 is active. Do not start C04 until its independent review passes. C01/C02 passed, with current C02 source fingerprint5ad3791d and executable72099350; these remain frozen evidence after C03 changes the presentation.

## Existing reusable methods

- C02 `evidence/native-fonts.mjs` is a successful real Windows harness, with11 controls, actual platform glyph evidence,122 synthetic nodes seeded by Rust, calibrated IPC paths,81 preview command denials and true new-PID restart. Run receipt: `native/run-1791990497569-412d3a72/result.json`. It does not open Chrome or install anything.
- Copy the harness, `native-window.ps1` and `fingerprint-source.mjs` into C04 before adapting them. Update the temporary-root prefix `native-c02-` and owned-window class to C04 consistently. Do not edit frozen C02 raw receipts or rerun with its evidence destination.
- `native-window.ps1` moves/resizes only the verified executable PID under an immediate non-reparse temp root. It reports actual GetDpiForWindow plus monitor inventory; optional PrintWindow captures stay under the task's `evidence/native/`.
- Historical S03 `evidence/native-appearance.mjs` has the actual-monitor-DPI loop pattern. C04 must record DPI120 and144 with matching WebView devicePixelRatio, measured CSS/physical dimensions, maximum20px, list and dialogs. Historical DPI evidence is not current proof. Move the owned window across existing monitors; do not change OS display scaling.
- The current machine's read-only monitor inventory suggests both scales are available, but actual C04 GetDpiForWindow measurements are still NOT_RUN.

## C04 native additions

After building current stable C03/C04 source, extend the copied C02 harness with actual125/150%DPI. Use unique DPI values, both palettes and1100×760/640×480. At20px check General, font picker, library, and dirty-note confirmation with reachable actions. Restore/cancel the synthetic draft between cases. Keep new PID restart and current executable hash, actual glyphs, permission denials and calibrated no-side-effect evidence.

Add a current native history→export entry and real OS Save dialog cancel using `dialog`/`waitDialog` from the existing current-native-driver if needed for integration coverage. Browser full-suite coverage supplies the broader business regression matrix; no real Chrome/profile/model work is necessary for this presentation task.

## Performance

Reuse `.trellis/tasks/10-10-mb-13-windows-acceptance/evidence/current-performance-probe.mjs` in a C04-local copy with task-local output and corrected imports, preserving the original search method. It uses Rust `seed_profile_cache`,11004 synthetic nodes (10000 bookmarks,1000 folders,maxdepth20), one excluded warmup and30 measured samples, input event through exact loaded1/1 result and next animation frame, p95=`sorted[ceil(n*.95)-1]`, threshold200ms. It also measures three fresh-process startup samples against3000ms; retain those results if retaining that portion, do not relax thresholds. Run after build/test workers are idle, record p95/max/environment and distinguish observed timing from assumptions about machine quiet.

The C02 backend worker built the unchanged seeder at `target/x86_64-pc-windows-msvc/debug/examples/seed_profile_cache.exe`, SHA25687F724DB424992401B2BE189EEF8AE8CB9A5B4CC0E7F109EAEA9F8EB7ADFA41C. Use the standard `pnpm build:native` for current release (Tauri invokes frontend build); the approved local runner needs `exec_command` outside the sandbox because sandbox pnpm stalls.

## Completion

Run/reuse current full affected automatic/browser checks, independent Trellis check, update parent V02–V14 and AC coverage, source hashes and execution status. Accepted tasks keep `status=in_progress` plus `meta.execution_status=completed_pending_archive` until separate commit/archive authorization; clear the active pointer when all requested implementation is accepted. No commit, archive, journal, install, push, signing or publication is authorized. Original13/V12,15/V18 and parent remain unchanged.
