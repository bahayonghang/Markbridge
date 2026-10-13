# R05 independent check

Status: PASS for R05 scope. Automated checks and final native receipts have been reviewed. One existing AI cancellation-copy issue is explicitly handed to R07 below. Task completion metadata remains owned by the main session.

## Findings (fixed)

- File: `apps/desktop/src-tauri/src/main.rs`
  - Issue: The existing acceptance data-directory override did not configure the trusted main WebView. The new native harness used global `WEBVIEW2_USER_DATA_FOLDER` to compensate; that global setting also overrode each preview's data directory and invalidated Profile isolation evidence.
  - Fix: Reuse the already validated `MARKBRIDGE_APP_DATA` path before Tauri builds windows, set only the configured `main` window's data directory to `main-webview` under that root, and pass the same resolved override to database setup. Normal launch without the override is unchanged. A pure configuration regression covers default behavior, rejection of relative paths, window label matching regardless of order, and preservation of preview-specific data directories. The main session removes the harness's global WebView2 override.

- File: `apps/desktop/src-tauri/src/preview.rs`
  - Issue: When the active preview belonged to Profile B, clearing Profile A's session returned the unchanged B state even if directory removal failed. The existing frontend interpreted that successful return as a completed clear.
  - Fix: A failed clear that cannot report through the current Profile's state returns the existing `StorageError`. Same-Profile failures keep `SessionBusy`. No DTO or permission change. The deterministic regression failed on the old `Ok(())` path, then passed with the correction; it also checks successful A clears leave B unchanged, same-Profile busy behavior, and failure with no current window. Evidence: `check-session-clear-red.log`, `check-session-clear-green.log`.

- File: `apps/desktop/src/features/tags/TagDesk.tsx`
  - Issue: A clean note from a previous source epoch could remain editable while the new epoch's catalog read was pending. Sending the new expected epoch alone allowed old displayed data to become a new-identity draft.
  - Fix: Implementation owner bound mutations to a loaded epoch, retained dirty drafts on conflict, and guarded all product tag/title commands through the existing IPC boundary. Review additionally made note, tag-name and rename text read-only until that identity's catalog is loaded, preserving copying and same-identity typing while a save is pending. The additional regression failed before this fix and all 13 tag tests passed afterward: `check-epoch-input-red.log`, `check-epoch-input-green.log`.

- File: `apps/desktop/src/features/tags/TagDesk.tsx`
  - Issue: A title diff could remain after an AI-confirmed tag update refreshed its catalog. The existing apply path recomputes title encoding, so applying that stale diff could write a different title.
  - Fix: Implementation owner invalidated the visible diff and its request generation on `refreshVersion` changes, with regressions for displayed and late-returning previews.

- File: `apps/desktop/src/features/library/LibraryWorkspace.tsx`
  - Issue: Ctrl+End bypassed the unsaved-metadata guard; folder Enter cleared the query outside the guarded transition. Content children also retained old work if a source epoch reused the same Profile/node/URL.
  - Fix: Implementation owner routed pagination/folder/breadcrumb/filter transitions through the draft guard and keyed content children by epoch, with regressions for cancelled navigation and cancellation after an identity reset. R04's real-scrollbar heading layout and hidden/inert actions remain intact.

- File: `apps/desktop/src/features/ai/AiSuggest.tsx`
  - Issue: A pending request could retain the busy state across selection changes; a late undo could clear a newer item's undo state. Cancellation rejections were unhandled.
  - Fix: Implementation owner tied busy/completion UI and undo to the request generation, catches cancellation failures, and retains source-guarded invalidation of confirmed local saves. Tests cover 20 pending A/B changes and stale completions.

## Findings (not fixed)

- `AiSuggest.tsx`: The existing cancel action says results will not write bookmarks even if an already-confirmed apply or undo is in flight. Cancellation of generation and cancellation after dispatch need distinct, truthful status copy. This requires the AI interaction decision owned by R07; the main session explicitly requested a R07 handoff rather than extending R05. No change to the already-dispatched operation semantics was made in this review. Tracked follow-through: `../../10-12-mb-r07-organize/research/r05-review-handoff.md`, included in both R07 context manifests.
- Real OS sleep/wake and Windows settings at 150% remain the separately recorded R08 gates; neither is inferred from R05's Windows 125% native runs.

## Preview-host analysis

- `preview.rs` reuses the same window generation for a same-Profile open. `DownloadBlocked` is not in the successful navigation callback's notice-clearing list, and history updates do not clear notices. Inspection of locked Tauri/Wry sources confirmed that Requested dispatches through WebView2 DownloadStarting and a false return cancels it. There is currently no confirmed product defect requiring a second download guard.
- A userinfo HTTP request alone is not proof that the forbidden page loaded. Native acceptance must check page-ready reports and actual loaded state; public-fetch denial and independent-WebView navigation are distinct contracts.
- Baseline native runs used the prior R04 executable and the global WebView2 override. They remain historical failed fixture runs, not R05 acceptance or evidence of shared production Profile sessions. The final isolated executable passes the actual download notice and no-saved-download checks, with no second interception mechanism added.

## Verification

- Lint: PASS, `pnpm lint`, exit 0, `check-lint.log`.
- TypeCheck: PASS, `pnpm typecheck`, exit 0, `check-typecheck.log`.
- Tests: PASS, `pnpm test`, 156 Vitest tests and 6 script tests, exit 0, `check-test.log`.
- Rust: PASS, `cargo fmt --all -- --check`, `cargo clippy --workspace --all-targets -- -D warnings`, and `cargo test --workspace --locked`. Final 136 tests pass (107 core, 15 desktop, 14 protocol), 3 pre-existing ignored tests. Logs: `check-fmt.log`, `check-clippy.log`, `check-rust.log`.
- Protocol: PASS, `pnpm protocol:check`, exit 0, `check-protocol.log`.
- Browser: PASS, `pnpm test:e2e` with this task's `MARKBRIDGE_EVIDENCE_DIR`, 45 tests, exit 0, `check-e2e.log`. Includes five supported window sizes, R04 classic-scrollbar regression, and R05 local drafts/content.
- Build: PASS, root `pnpm build`, exit 0, `check-build.log`; production asset checks passed. Existing bundle-size advisory remains in the log.
- Native webpage: PASS, `native-web-2c95c715.json`, 11 controls on executable SHA256 `f43fa1827d0b2b1a9d740cc997c34c880c7a6dda7b253d2dc733d4ec6afff7b1` (23,772,160 bytes). All 65 registered app commands denied remotely; real history, scheme/file/userinfo/popup/download denial, no saved download, independent main DOM/storage, A/B session isolation and scoped clear, failure state, and foreground transfer observed at 35 ms. This is actual Tauri/Windows evidence with synthetic Profile IDs, distinct from Chrome bookmark management.
- Native detail management: PASS, final `native-details-e5e26b2a.json`, 6 controls on the same frozen executable. Real isolated Chrome disconnect/reconnect, offline notes and batch tag add/remove, unchanged titles, keep/discard drafts, 20 A/B cycles with 40 intentionally delayed real tag-state responses, explicit title-encoding opt-in/full diff/cancel, all five native dimensions at actual 125%, safe suspended Chrome handoff (suspend count 1, no child), and scroll 780 to 780. The response-delay instrument is positively verified (`installed=true`, 120 IPC calls, 1 visible content-preview call, 43 delayed tag reads by run end). Temporary credentials were removed and there were no recorded page errors.
- Earlier `native-details-ae9d9318.json` retains its raw result, but its `delayedReads=0` does not establish forced late-response or counter-based hidden-preview assertions: assignment to Tauri's immutable invoke property had not installed the observer. The final run corrects this with a verified fetch observer that delays real responses without changing their payloads. Earlier detail failures from a cleared selection and immediate checkbox assertion were harness synchronization issues; their receipts remain preserved.
- Early desktop run: the restricted sandbox could not inspect its suspended test process command line (13 pass, 1 fail); identical source passed with normal process-observation permissions. An earlier pre-freeze compile caught the implementation owner's temporarily missing SourceEpoch import, now resolved. Intentional red regressions and all native fixture failures are preserved.
- Visual inspection: read browser-rendered 1440×900 and 640×480 details plus actual final `native-screenshots/e5e26b2a-long-url-640x480.png` and `e5e26b2a-long-url-1100x480.png`, along with the prior same-executable common-metadata view. Plain blue selection, cardless white detail, sticky tabs, bounded long-URL scrolling and narrow replacement view match the approved design. Native and browser evidence remain separate.
- `git diff --check`: PASS, `check-diff.log`.
- Scope: the R04 frozen 215-file core fingerprint differs only in `main.rs`, `preview.rs`, bridge tag guards and their tests. No additional organization, extension or protocol changes were introduced by R05.
- Existing user scripts `foundation.test.mjs` and `tauri-dev.mjs` retain their supplied SHA256 values.

## Spec follow-through

The main session updated the stable frontend state/lifecycle and backend database/quality guidance. Review confirmed the documented guarded source epoch, read-only unknown/loading/stale metadata inputs, retained drafts, title-diff refresh invalidation, guarded keyboard navigation and per-window acceptance WebView data directories without a global override. No platform template or detection path changed.
