# R01 implementation report

Date: 2026-10-13 local execution. Scope: R01 shell and existing frontend entry points only. No Rust, DTO, extension, database, real Chrome profile, or installed application changes were made by the implementer.

## Result and ownership

- `apps/desktop/src/App.tsx`: bookmark-first shell, four workspaces, settings tabs, one root `useBridge`, lazy connection/AI settings, skip link, navigation focus.
- `apps/desktop/src/features/settings/ConnectionSettings.tsx` (new): extracted the existing connection/pairing/mirror forms and state machine from App. Same backend commands and explicit pairing confirmation; “browse cache” returns to bookmarks.
- `apps/desktop/src/features/library/LibraryWorkspace.tsx`: retains the single source/tree/query/selection owner. Its tree is portaled to the shell sidebar; source selector remains in the toolbar. Routes existing organization/maintenance into Organize and existing history/export into separate workspaces. Details are optional; below 1100px they replace the list. Below 800px folders are a replace-and-return view. Background list is unavailable to keyboard focus while that folder view is open.
- `apps/desktop/src/features/library/EditDesk.tsx`: small `edit`/`history`/`export` presentation adapter of the existing engine, with backward-compatible default `all`. Cached history is readable; undo is disabled without live connection. Exports retain the existing download implementation and now say the content was generated, asking the user to confirm the downloaded file rather than claiming a native save receipt.
- `apps/desktop/src/features/library/VirtualRows.tsx`: configurable row height (40px tree, 52px two-line list), initial tab stop, pointer versus focus activation; checkbox focus no longer opens details.
- `apps/desktop/src/features/library/WorkspaceIcon.tsx` (new): local shared 18px line icons, no remote assets.
- `apps/desktop/src/styles.css`: approved blue/neutral tokens, Windows Latin/CJK font stack, 216px sidebar/312px optional detail pane, viewport-height regional scrolling, 64px narrow navigation rail, scoped text inputs and 16px checkbox in a 40px target, visible focus and reduced-motion treatment.
- Tests: `App.test.tsx`, `features/library/library.test.tsx`, `features/tags/tags.test.tsx`, `tests/e2e/foundation.spec.ts`, new `tests/e2e/mock-bridge.ts` and `tests/e2e/shell.spec.ts`.

The small EditDesk adapter and virtual-row changes are necessary to expose existing history independently and match the approved shell geometry. No new creation, batch executor, pagination, or native export protocol was introduced. Existing library and AI configuration drafts survive workspace navigation. Content preview and preview-window control subscriptions are mounted only for visible details; entering Organize or AI settings performs no model/probe/mutation action.

Main-session-owned changes are separate: `scripts/dev-port.d.mts`, `playwright.config.ts`, Trellis status/spec integration and native evidence. Preexisting `scripts/foundation.test.mjs` and `scripts/tauri-dev.mjs` were not edited by the implementer.

## Commands and evidence

Environment: Windows, PowerShell, Node v26.7.0, pnpm 12.12.0, Playwright 1.64.0, isolated bundled headless Chromium 156.0.8078.4. Browser fixtures are synthetic and replace the backend module only through Playwright routing. Production bundles contain no demo data or mock bridge.

| Check | Result | Evidence |
|---|---|---|
| `pnpm lint` | PASS, exit 0 | `lint-handoff.log` |
| `pnpm typecheck` | PASS, exit 0 | `typecheck-handoff.log` |
| `pnpm test` | PASS, exit 0; 104 Vitest + 6 Node tests | `test-verified.log` |
| `pnpm build` | PASS, exit 0; production artifact scan passed | `build.log` |
| `pnpm test:e2e` | PASS, exit 0; 17 tests | `browser-final-17.log` |
| `git diff --check` | PASS, exit 0 | tool receipt in implementation turn |
| Native Windows interaction and 125%/150% scaling | Main-session-owned; not established by these browser tests | separate native evidence |
| Real Chrome pairing/sync, V04 sleep, external sync | NOT_RUN by this R01 implementation | existing gates unchanged |

The build command preceded the final diagnostic-summary hit-area and export-copy cleanup; main will rebuild the final native artifact after independent review.

Build warnings about >500kB chunks are unchanged category warnings; artifact scans pass. JSDOM reports its expected unimplemented document navigation when testing download links. The full test command passes despite that warning.

## First failures and corrections

1. Initial sandboxed pnpm could not open its user-wide engine store lock (exit 1). The same authorized checks succeeded with sandbox escalation. No dependency reinstall was performed.
2. Initial typecheck hit existing `vite.config.ts` TS7016 for `scripts/dev-port.mjs`; main added its declaration file. Initial lint hit existing ANSI regex `no-control-regex` in `playwright.config.ts`; main replaced it with Node `stripVTControlCharacters`.
3. First component run: 20/30 failures. Most old tests assumed connection forms/details were always visible and full URLs were in list rows. They now navigate to settings/open details and verify full URLs in details, retaining the underlying safety assertions. Retry logs preserve 8 then 1 remaining failures: `component-retry.log`, `component-retry2.log`, `component-final.log`; eventual component pass is `component-verified.log` (30 tests before two new App tests).
4. First browser run: 11/15 passed (`browser-first.log`). Actual bug: focusing a checkbox bubbled into row activation and hid the narrow list before checkbox state changed. Fixed pointer/focus distinction and label hit-area propagation. Also narrowed a text selector matching hidden browser-preview copy.
5. Screenshot review caught AI tabs below the content (flex ordering) and narrow search input overlap (global input selector specificity). Corrected both and added bounding-box assertions, not merely document overflow checks.
6. Browser retries retained in `browser-retry.log`, `browser-retry2.log`, `browser-verified.log`. First-focus check now waits for the initial page to render instead of sending Tab during a reload.
7. First full suite: 101/102, then 103/104 (`test.log`, `test-final.log`). The existing offline multi-tag test needed explicit detail navigation and a fixture `cache_get` result matching the requested folder. Corrected the fixture and retained the no-Chrome-write assertions. Final 104/104 plus script checks pass.
8. Added file-tree replacement focus/return and reduced-motion tests; final browser pass is authoritative.

## AC mapping and screenshots

| Acceptance | Observed browser result | Evidence |
|---|---|---|
| AC-R01-1 | Bookmarks are first; connection/AI configuration absent until Settings. Bookmarks, Organize, History, Settings and export entry points work; one bridge subscription. Query, selection and edit/config drafts survive navigation. | App tests; `shell.spec.ts`; `shell-library-*.png`, `shell-ai-*.png` |
| AC-R01-2 | Loading, no source, cache failure, empty cache, stale mirror and disconnected cache display distinct real fixture states. No fabricated live state in browser preview. | `shell-loading-1100x760.png`, `shell-cache-error-1100x760.png`, `shell-empty-1100x760.png`, `shell-readonly-1100x760.png`; foundation and App tests |
| AC-R01-3 | 1440×900, 1100×760, 640×760, 1100×480, 640×480: document width/height remain viewport-sized; source/search/buttons do not overlap; separate list/detail/settings scroll; narrow detail and folders return correctly. | `shell-library-WxH.png`, `shell-detail-WxH.png`, `shell-ai-WxH.png` for all five sizes |
| AC-R01-4 | Checkbox actual width 16px, 40px label target; controls use shared styles. Skip link is first focus; focus outline 2px; settings tabs support arrows/Home/End; Escape restores detail/folder trigger focus; reduced-motion pointer press transform is none. | `shell.spec.ts`, `foundation.spec.ts`, CSS and browser screenshots |

Screenshots were opened and inspected at 1440×900, 1100×760, 1100×480 and 640×480 (with all five sizes captured by tests). The approved design’s strongest visual element is the blue bookmark selection, with neutral sidebar and cardless white content. System Segoe UI/YaHei keeps Chinese and Latin consistent without network fonts. Row URLs show the host; full values remain readable in details.

Computed WCAG contrast from the actual token values: ink/white 15.01:1, muted/white 5.40:1, muted/sidebar 4.68:1, blue/white 5.37:1, blue/selected 4.69:1.

## Remaining boundaries

- Native proof, Windows scaling and independent review remain main-session responsibilities; browser results do not close them.
- R03 still owns current 200 search result/10,000 list limits and full selection semantics; R04 owns new creation and batch workflows; R05 owns detailed metadata UX; R06 owns native file save receipts/history formatting; R07 owns further organization workflow improvements.
- Existing download export has no native saved/cancelled receipt. UI avoids claiming one.
- No commit, archive, publication or daily-environment installation was performed. Old synchronization gates and exceptions are unchanged.
