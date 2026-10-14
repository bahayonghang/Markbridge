# Frontend Quality Guidelines

Child 01 provides `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm protocol:check`, and `pnpm test:e2e`. Run results belong in the current task receipts. These commands do not establish later-child functionality.

Foundation tests are `apps/desktop/src/App.test.tsx`, `packages/protocol/src/index.test.ts`, `scripts/foundation.test.mjs`, `scripts/protocol.test.mjs`, and `tests/e2e/foundation.spec.ts`. Production checks are in `scripts/check-artifacts.mjs`. The Windows CI definition is `.github/workflows/ci.yml`; a local pass does not prove hosted CI passed.

Child 02 wire tests are in `packages/protocol/src/wire.test.ts`. These tests serialize typed DTOs in each language, invoke the Rust fixture executable, and compare runtime acceptance of valid and invalid frames. They also check field, frame, tree, Unicode and operation bounds. The protocol module has no GUI database or Chrome connection.

Validate keyboard navigation, moving, profile switching, edits, proposal review, read-only states, and conflicts. Fixtures include duplicate URLs, equal IDs across profiles, long titles, deep folders, and non-ASCII tags.

Test late preview responses, open drafts invalidated by browser edits, and disconnect during apply. Unknown results must differ from confirmed failures.

DOM tests cover state and interactions. Native Tauri runs cover remote preview isolation, focus, OS behavior, and rendering. Record viewport and runtime with screenshots. Mock IPC does not establish native correctness.

R01 shell regression uses `tests/e2e/mock-bridge.ts` only in the test runner, never the production bundle. Check 1440×900, 1100×760, 640×760, 1100×480 and 640×480. Assert source/search/button bounding boxes do not overlap in addition to document overflow: an input specificity regression can overlap adjacent controls without expanding the document. Cover checkbox keyboard focus, detail/folder replacement return, settings tab keyboard behavior, preserved drafts and reduced motion. Native evidence must name the executable hash, actual client dimensions, device scale, isolated data directory and whether actions use real IPC. Distinguish Windows display scaling from a WebView2 process scale override.

Performance evidence includes item count and machine details. Virtualization preserves selection and keyboard behavior. Avoid tests that only duplicate implementation markup.

S02 settings regression adds 1920×1080 to the five shell sizes. `tests/e2e/settings-layout.spec.ts` checks four category panels, vertical keys, Tab/Shift+Tab with disabled/loading/empty content, selected-hover fill, category content starting at the top, wide connection columns and pending/long source names. Check category/content bounding boxes and internal scrolling, not document overflow alone. `App.test.tsx` covers one shared source selector and discarded old-source export completions.

S03 adds General as the fifth category and `tests/e2e/appearance.spec.ts`. Check the six sizes in light/dark and standard/large, all local font presets and sizes, system media changes versus fixed themes, truthful denied-storage behavior and actual computed text/control/row styles. Scroll away from the previous active bookmark before changing size while the library is hidden, then assert the same visible row and pixel offset, retained draft/selection, last-item keyboard reveal and checkbox focus. Theme tests calculate text and control/focus contrast from final colors and verify real consuming states, including hover, disabled and confirmation. Native process exit/restart and actual monitor DPI have separate receipts; browser reload and emulated media/scale are supplementary. See [UI preferences](ui-preferences.md).

Native command observation must prove its instrumentation works. Tauri's `__TAURI_INTERNALS__.invoke` property is non-writable; assigning it can silently produce an empty log without observing anything. For task evidence, calibrate request-path observation with a known explicit IPC read and record command names only, excluding payloads, headers and credentials. An uncalibrated empty log is INVALID evidence for absence of external effects. Keep historical runs tied to their executable hash; source/artifact drift requires current integration evidence.

Browser screenshot output uses `MARKBRIDGE_EVIDENCE_DIR` when supplied for the current run, otherwise `test-results/screenshots`. Pass that environment variable only to the current test command and never hardcode a completed task's evidence directory. Preserve native artifacts with unique run IDs and executable hashes; later tests must not overwrite a prior task's frozen screenshots.

R02 regression in `tests/e2e/connection.spec.ts` covers source-specific read-only status while another profile is live, equal Chrome IDs across profiles, source-switch cancel/discard and settings-triggered focus return. Keep pending-ticket values out of screenshots and logs. The task-local `native-connection.mjs` uses actual Tauri IPC and two disposable Chrome profiles for pairing/restart/revocation, plus a synthetic file source for stale-cache recovery; browser mocks do not substitute for it. Authentication may deliberately return pending for an invalid token, so rejection evidence must check that no profile or pending identity was accepted, rather than assuming an extension `error` state.

`apps/desktop/src/features/preview/web-preview.test.tsx` checks the main-window controls, stale results, and the Chrome fallback label. That file does not mark parent V11 passed.
# Integration evidence timing

When timing an external bookmark removal or move, absence of a row alone is not completion: a revision change clears the query page before its replacement arrives. Require the matching loaded count, no loading status, and recheck the condition on the sampled animation frame. Keep discarded timing runs as provisional evidence. Actual Windows DPI evidence records both GetDpiForWindow and WebView devicePixelRatio on the owned native window; a process scale override is supplementary only. R08's native-live and native-system harnesses demonstrate these checks.
