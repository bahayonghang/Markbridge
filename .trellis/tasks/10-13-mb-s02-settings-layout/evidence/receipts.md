# S02 implementation receipt

Final implementation checks: PASS, 2026-10-14. Root and the independent checker own the final task transition. No installer, daily application data, real Chrome profile, commit, archive or publication was used by S02 validation.

## Delivered behavior and ownership

- `SettingsWorkspace.tsx` owns the separate vertical settings categories and content scroller. Up/Down/Home/End and roving focus are associated with the single visible panel. Changing categories resets only this scroller to the page start; selected hover retains the blue fill.
- `App.tsx` keeps one `LibraryWorkspace` mounted and a stable export host. `LibraryWorkspace.tsx` portals only the existing source toolbar and export view, preserving shared source/query/selection/draft and stale-response ownership. There is one source selector and one export tabpanel.
- `ConnectionSettings.tsx` presents paired/read-only sources before new connection setup in daily use; effective content width ≥960px uses two columns. First-run setup stays ordered and pending pairing keeps required instructions open. AI, semantic and export settings use compact rows and functional groups in their existing components and `styles.css`.
- Layout/navigation regressions cover keyboard entry into disabled/empty/loading panels, profile/mirror export, stale replies, retained inputs and lazy AI/semantic activity. `App.test.tsx`, affected existing browser assertions, `settings-layout.spec.ts` and its fixture-only mock support were updated.
- During a paused run, separately owned lazy protocol imports, protocol entry/export files and command/build scripts changed. They were preserved. The combined check found four cold-loader cancellation races. Root authorized a minimal `backend.ts` correction for `readContentPreview`, `suggestAi`, `proposeOrganization` and `checkLinks`: start IPC before loading its lazy parser, with both promises handled by `Promise.all`. The independent checker supplied four failing deferred-loader regressions before this change and updated existing async readiness tests. No Rust/DTO/permission change was made for this correction.

## Final source and artifact binding

`current-source.json` records all source/configuration files including unrelated preserved work. The final full fingerprint includes tests; the production fingerprint excludes `tests/` and `*.test.*` files so reviewer test changes cannot falsely imply a different executable source.

- Production fingerprint: `b5dea3641dda14771f7bbf13755796b25b29b0ea7533ed72cc0c2b22dce94549`, 360 files.
- Full fingerprint: `98addb5d68f9eba33ab46cc7061b28ab90674374862f8757a8d555659723acea`, 391 files.
- Final executable: `target/x86_64-pc-windows-msvc/release/markbridge-desktop.exe`, 25,382,912 bytes.
- Final executable SHA-256: `84c174923053b80ad9b4d96aa20bd1ef9139414a78058de16b9ecee7a96484ce`.
- `current-20261014/source-final-production.json` captures the corrected production source before test-only edits; `source-final.json` captures the final combined tree. `native/run-1791960684951-cddb3d58/result.json` binds that production fingerprint to the actual copied executable.

## Automated checks

| Check | Final result | Evidence |
|---|---|---|
| `pnpm lint` | PASS | `current-20261014/lint-final.log` |
| `pnpm typecheck` | PASS | `current-20261014/typecheck-final.log` |
| `pnpm test` | PASS: 222 Vitest, 25 Node tests | `current-20261014/reviewer-full-test.log` |
| Four deferred-loader start/cancel regressions | RED 4/4 before; GREEN 4/4 after | `current-20261014/race-before.log`, `race-after.log` |
| `pnpm protocol:check` | PASS, tracked outputs unchanged | `current-20261014/protocol.log` |
| `pnpm build` | PASS, desktop/extension and production artifact scanner | `current-20261014/build-final.log` |
| `pnpm test:e2e` after the four-start correction | PASS: 95 tests | `current-20261014/e2e-final.log`, `browser-final/` |
| `pnpm build:native` after the four-start correction | PASS, Windows x64 artifact scanner | `current-20261014/build-native-final.log` |
| `git diff --check` | PASS; line-ending conversion warnings only | `current-20261014/diff-check-final.log` |

## Geometry and visual evidence

The same synthetic two-profile state was captured before layout edits and after layout edits at 1440×900, 1100×760, 640×760, 1100×480, 640×480 and 1920×1080 CSS pixels, across all four categories. `layout/before`, `layout/after` and `layout/geometry-comparison.json` retain that comparison. Pending pairing, no-source, long-name and mirror scenarios have additional browser/native evidence; they are not claimed as identical before/after snapshots for every state.

| Connection geometry | Before | After |
|---|---|---|
| 1440×900 content width / total connection height | 880 / 1413.94px | 992 / 758.56px, two columns |
| 1920×1080 content width / total connection height | 880 / 1413.94px | 1472 / 758.56px, two columns |
| 1100×760 content width / total connection height | 836 / 1413.94px | 684 / 1215.94px, one column |
| 640×480 content width / total connection height | 528 / 1413.94px | 420 / 1299.13px, one column |
| Content container starts at Y | 121px | 56px |

Categories remain readable at 184/152/132px, depending on viewport width. Geometry asserts document dimensions, content/category separation, reachable controls and settings scroll reset, rather than relying on body overflow alone. Root's aesthetic comparison is in `root-visual-review.md`. Initial hover/scroll screenshots remain in `layout/review-initial`. Final native normal and minimum screenshots were visually inspected: selected fill, first AI content, source/export controls and internal scrolling are present.

## Current Windows native acceptance

Final run: `native/run-1791960684951-cddb3d58`, started `2026-10-14T06:51:24.977Z`, PASS. Actual runtime: Windows 11 Pro, WebView2 `Edg/155.0.4283.45`, disposable Chrome `Chrome/155.0.8059.39`.

- Owned fixture root: `C:\Users\lyh\AppData\Local\Temp\markbridge-task13-native-s02-JGfCht`.
- Copied portable executable: `<fixture>\install\markbridge-desktop.exe`; app data: `<fixture>\app-data`; actual main WebView evidence stays in `<fixture>\app-data\main-webview\EBWebView`; disposable Chrome profile: `<fixture>\chrome-a`.
- The harness verifies exact executable/window ownership and `Markbridge · 签桥` title, then records `GetDpiForWindow=120`, `devicePixelRatio=1.25`. All 24 category/size observations have physical client size equal to CSS size×1.25: e.g. 1440×900→1800×1125, 640×480→800×600. This is genuine 125% native evidence; 150% is NOT_RUN for S02.
- First-run pairing completed through current settings with real IPC and a fixture extension. Vertical focus and real note/query/unsaved AI/semantic values survived navigation.
- The request-path observer was calibrated by a known `get_bridge_state` request. It records command names only, without arguments or bodies. During the measured category navigation window it observed only `semantic_settings`; no model/fetch/index/Chrome-write commands matched the explicit forbidden list. This claim is limited to that calibrated window; browser mocks and source review cover the wider navigation contract.
- History export uses the current profile: real native OS save cancellation and saved Netscape HTML were checked. A source change while a previous source's real dialog/reply was pending did not apply the old receipt to the new source. CDP supplied the adversarial source-change stimulus because the modal dialog blocks ordinary pointer input.
- Mirror export offered HTML only and saved actual HTML. An explicit real `save_export` sidecar request returned `failed/READ_ONLY` without opening a save dialog. This validates the native denied-operation receipt, not a filesystem write-failure UI. Failed export UI and late completions are covered separately by meaningful unit/browser regressions.
- Fixture credentials were cleared before normal shutdown. Chrome closed with `Browser.close`, exit0; the verified owned app window closed with `WM_CLOSE`, exit0. `finalProcesses.processes=[]` and `listeners=[]`; the known WebView process was absent. Temporary fixture files remain isolated evidence and no daily registration/install was performed.

The helper uses workspace-sentinel root discovery and root-resolved Task13 driver paths. `native-settings.mjs`, `native-window.ps1` and `fingerprint-source.mjs` are task-local evidence helpers, not production instrumentation.

## Historical failures and limitations

- Initial native geometry run `run-1791951399094-541df623` failed a harness expectation: clicking the already-active category did not reset its deliberate scroll. Required reset is on category change. The corrected test navigates away/back; this failure remains recorded.
- Native run `run-1791951475182-8730fb2a` used an older `9122…` executable and attempted to replace immutable `__TAURI_INTERNALS__.invoke`. Its empty command list is INVALID zero-call evidence; `observer-limit.md` records this. Current calibrated runs supersede that claim.
- A quota auto-review rejection prevented one refresh from executing. Subsequent authorized current runs passed. Historical rejected/no-run evidence is not described as a successful test.
- The resumed combined full test initially failed 12 timing assumptions (`current-20261014/test.log`). Reviewer readiness fixes preserve assertions; the separate four real cancellation races were proved RED before correction. Final full results are current and green.
- Pre-correction native `run-1791960082767-06815e5f` validated combined artifact `9d26…`; it is historical. Final `cddb3d58` alone binds the corrected `84c…` executable.
- Real model quality, OS sleep, 150% native scaling, macOS/Linux and old V12/V18 gates were NOT_RUN by S02. Theme/font behavior belongs to S03. No unrelated task is closed by these receipts.

## Reproduction environment

Use the installed pinned pnpm12.12.0 executable directory at the front of the command-local PATH:

`C:\Users\lyh\AppData\Local\pnpm\package-manager-store\v11\links\@pnpm\exe.win32-x64\12.12.0\97591cf70181dc9a82d65ec409f03f2a987b90ee8de786cb970420ee5d7dd719\node_modules\@pnpm\exe.win32-x64`

Browser runs use command-local `PLAYWRIGHT_BROWSERS_PATH=C:\Users\lyh\AppData\Local\ms-playwright`. Vitest temporary workers, native Cargo/CIM/window ownership and loopback browser servers used approved unsandboxed execution after observed sandbox limitations. The global environment/package versions were not changed, and `scripts/install-app.mjs` was not executed.
