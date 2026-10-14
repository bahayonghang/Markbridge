# S03 implementation and acceptance receipt, 2026-10-14

Final implementation and independent automated checks pass. The resumed session restored this existing child after confirming S01/S02 acceptance; no duplicate task or parent start was used. Final independent AC review is in `../check-report.md`. Commit, archive, installer execution and publication were not performed.

## Delivered behavior

- Ordinary Settings opens General; connection/AI/semantic/history-export shortcuts still target their categories. The existing library/source/query/selection/draft owners remain mounted.
- Versioned `markbridge.ui-preferences.v1` stores only the bounded theme/font/fontSize enums. Values apply immediately in the trusted main WebView, persist through a real process restart, and reset only this appearance key. Invalid records, unknown versions and denied storage are covered by conditional assertions; failed saves show the truthful session-only message.
- System theme subscribes to media changes; explicit light/dark stays fixed. Remote preview and extension permissions/styles are unchanged. The system stimulus in browser/native tests is CDP media emulation, not a Windows OS preference change.
- Text/control roles and virtual row heights share the appearance mapping. Middle scrolling preserves the visible row and offset; a list already at its bottom stays there across hidden standard/large changes. Hidden zero-height measurements do not replace the remembered position. Query, selection, dirty notes, keyboard reveal and checkbox focus are preserved.

## Fixes completed on resume

The historical native `b5eb6824` and resumed diagnostic `61d00883` exposed a real bottom-position defect: standard to large preserved the first visible row while shrinking the visible row count, hiding the selected last item. `VirtualRows.tsx` now remembers bottom proximity only for a visible scrollable list and clears it on source/reset changes or absent active items. Middle-row arithmetic is unchanged. Independent24/120-row UI regressions failed2/2 before and passed2/2 after. The native middle anchor is row30 plus11.199951px; the final standard position1571.199951px equals the expected position.

The earlier `441ed607` exact-integer scroll assertion was invalid under125%DPI. Native measurements now allow1CSS px rounding tolerance without relaxing row height, viewport, selection or focus checks. The two preview unit assertions used1s default deadlines while cold parser loading competed with a complete browser run; an isolated rerun passed14/14. Their condition waits now allow5s while retaining the same title/request assertions; no sleep, skipped test or production preview behavior change was introduced.

## Source and artifact binding

- Frozen build input: `source-resume-native.json`; production fingerprint `f2124fcee69de1eb3f2a390343f083aca2982f0af4fd1abd87959e4b54b0df89`,362 files.
- Final source record: `source-resume-final.json`, full fingerprint `7011cc7fc8998c08e13624037d748daef485b7dc37484111ce39da8587b02a40`; production fingerprint is unchanged after the two test-only edits.
- Executable: `target/x86_64-pc-windows-msvc/release/markbridge-desktop.exe`,25,387,008 bytes, SHA-256 `b94cb2f1e5f11d4db66ae680a5975bf05091c51d582f2a3fafd73a838a8d4866`.
- Native receipt: `native/run-1791965980131-17ad4cfd/result.json`, all11 controls PASS, script exit0. Current executable and isolated copied executable match. Later changes to the two preview test files do not change the production fingerprint or binary.
- The separately owned backend/protocol/build/install edits present at session start were preserved and included in combined validation; this receipt does not assign their design ownership to S03.

## Final checks

| Gate | Result | Evidence |
|---|---|---|
| lint/typecheck | PASS | `independent-check-20261014/lint-final.log`, `typecheck-final.log` |
| Unit and Node tests | PASS:232 Vitest +25 Node, exit0 | `independent-check-20261014/test-final.log` |
| Protocol generation | PASS, tracked outputs match | `independent-check-20261014/protocol-final.log` |
| Production desktop/extension build and scanner | PASS | `independent-check-20261014/build-final.log` |
| Complete browser suite | PASS:133/133, exit0 | `independent-check-20261014/e2e-full.log` |
| Windows native build and scanner | PASS, exit0 | `build-native-resume.log` |
| Real native acceptance | PASS:11/11 controls, exit0 | `native-resume-final.log`, final native receipt |
| Diff whitespace | PASS | independent check report and final root check |

## Native and visual evidence

Windows11 Pro, WebView2 `Edg/155.0.4283.45`, temporary Chrome155. Six CSS client sizes across five settings categories produce30 native observations. All9 font/size combinations have the expected computed family/body size and folder/bookmark height. Calibrated request-path observation records permitted reads, including `semantic_settings` and cache/tag reads, with no forbidden model/fetch/index/browser-write calls during navigation/appearance changes; this is not a zero-IPC claim.

Actual monitor DPI120/144, DPR1.25/1.5 and physical client sizes agree for12 light/dark large-font observations at1100×760 and640×480. Both the main and restarted WebView processes are observed inside the new fixture's `app-data/main-webview/EBWebView`. Process124808 exits0 and a different process132572 restarts from the same isolated data, retaining dark/song/large. Final process and listener lists are empty. No installer or daily application/browser data directory is used.

Browser screenshots cover light/dark × standard/large × six sizes, plus disabled/loading/empty/error/confirmation states and storage failures. The final independent contrast audit includes15 semantic and16 rendered consumer pairs per palette,62 total, meeting their4.5 text /3 boundary thresholds; minimum text4.68:1, boundary3.30:1. Root also audited the30 semantic pairs and inspected the real restart and150%DPI minimum-window screenshots separately from synthetic browser fixtures; details are in `root-visual-review.md`.

## Historical attempts and remaining scope

`source-build.json` and the old `d063d42e` executable evidence remain historical. Runs441ed607, b5eb6824 and61d00883 are FAIL; none establishes final acceptance. Old `protocol-final.log` failed with access denied; old `e2e-final.log` was incomplete/failed. The independent cold-loader unit failure is preserved in `test-before-cold-loader-deadlines.log`; the earlier browser teardown attempt is incomplete. Only the final gates listed above and17ad4cfd/b94 establish current acceptance.

Original13/V12 and15/V18 still lack actual-model evidence; no model was installed, downloaded or called by this task. Original non-Windows and external-sync gaps remain unchanged. S03 acceptance is complete, while task status stays `in_progress` pending separate commit/archive authorization.
