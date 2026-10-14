# S01 independent check report

Review scope: current S01 product diff, untracked runtime assets, generation/visual records and current native evidence. No product source fixes were needed. Parent/implementation agents are writing separate evidence; this report does not authorize commit, archive, installation or publication.

## Findings (fixed)

- File: `evidence/export-icons.py`
  - Issue: fixed-depth `parents[4]` repository discovery fails after the task moves beneath `archive/YYYY-MM`.
  - Fix: find the ancestor containing `pnpm-workspace.yaml`. Verified current and hypothetical archived paths without invoking `export()` or regenerating any assets.
- File: `evidence/inspect-icons.py`
  - Issue: the same fixed-depth discovery and hardcoded active-task candidate paths prevent archive-time inspection replay.
  - Fix: sentinel-based repository discovery and derive candidate paths from the helper's actual task directory. Verified both directory depths without writing asset evidence.
- File: `evidence/native-icons.mjs`
  - Issue: fixed-depth repository resolution and a relative sibling-task driver import fail when this S01 directory is archived.
  - Fix: find the workspace sentinel and import the existing current task13 driver from its repository path. Syntax and current/hypothetical archived path checks pass; the native harness was not relaunched. This supports moving S01 only and does not claim replay after the separately owned task13 driver moves.
- File: `assets/brand/README.md` (fixed by root)
  - Issue: a re-export command pointed at the active task path, which moves on archive.
  - Fix: root replaced the command with durable provenance and consumer/derivation rules; the reviewed helpers remain task-local evidence.
- File: `evidence/native-brand.ps1` / native run `run-1791949541810-5a0cbe9a` (fixed by implementation agent)
  - Issue: `StartsWith('Markbridge')` selected `Markbridge - File Explorer - 1 running window`; the resulting taskbar screenshot shows Explorer's yellow folder. Its provisional `PASS_PENDING_VISUAL_REVIEW` is insufficient for AC-S01-4.
  - Fix: match the actual app title, emit UTF-8 and use DPI-aware geometry. Independently viewed the fresh `run-1791949706426-73a68df7` screenshot: the named `Markbridge · 签桥 - 1 running window` button displays the selected bookmark/bridge icon. Earlier wrong-target evidence remains invalid.

## Findings (not fixed)

None. No remaining product defect, spec drift or acceptance blocker was found within S01's scope.

## Verification

- Lint: PASS, independently executed with pinned pnpm 12.12.0; final repeat passed after both evidence helper fixes.
- TypeCheck: PASS, independently executed for all workspace packages and tools; final repeat passed after both evidence helper fixes.
- Tests: PASS; audited implementation `test.log` (217 Vitest and 21 Node tests) and `browser-shell.log` (12 browser shell tests). Initial sandbox failures/stall remain preserved separately. The reviewer did not duplicate the full test/native build.
- Build: PASS; audited `build.log` and `build-native.log`, including the unchanged production/native asset scanners. Current desktop Vite bundle contains and references the hashed local 128px brand PNG; extension output PNGs match source byte-for-byte.
- Asset checks: PASS; master RGBA 1254×1254 with alpha 0–255 and transparent edge/corners; selected master matches byte-for-byte. Side/extension PNGs match LANCZOS derivatives of the unchanged master. ICO frames 16/24/32/48/64/256 decode with alpha. The 16px PNG's outer edge alpha max 3 is resampling antialiasing; the viewed light/dark comparison has no matte.
- Safety/scope: PASS; normalized extension manifest differs only by `icons` and `action.default_icon`. Permissions, host permissions, CSP, background worker, popup/options and protocol remain unchanged. Production artifact scanner remains unchanged. Existing functional `WorkspaceIcon` glyphs remain intact.
- Spec sync: reviewed root's `frontend/component-guidelines.md` brand section; the stable master/consumer paths, decorative image semantics, artwork/derivative distinction and actual-taskbar-target rule match the delivered code/evidence.
- Evidence replay helpers: current/archive path probes PASS for export, inspection and native harness lookup; `node --check evidence/native-icons.mjs` PASS. These final evidence-only edits do not alter the frozen product or its accepted native run.
- Visual: PASS for A/B/refined-A comparison at 16/24/32/48/128/256 on white and dark backgrounds. Independently inspected the final native titlebar/sidebar, taskbar and real temporary Chrome extension card screenshots; all show the selected bookmark/bridge brand.
- Native: PASS for run `run-1791949706426-73a68df7`; independently matched current platform-target EXE SHA-256 and all four runtime Chrome PNG hashes to repository files, and checked owned-app isolation plus empty cleanup process/listener lists. Physical client 1375×950 equals CSS 1100×760 at devicePixelRatio 1.25; actual GetDpiForWindow is 120. No optional large WM_GETICON handle is supplied; the actual taskbar screenshot establishes the required observed appearance. Chrome is headless and its card is the observed surface; pinned-toolbar appearance was not claimed.
- `git diff --check`: PASS.

Independent static receipt: `evidence/reviewer-static.json`.

## Acceptance audit

| Criterion | Status | Evidence |
|---|---|---|
| AC-S01-1 | PASS | `assets/generation.json`, candidates, `evidence/icon-comparison.png`, root and independent visual reviews |
| AC-S01-2 | PASS | local master/consumer assets, `evidence/asset-inspection.json`, independent `reviewer-static.json`, archive-path probes |
| AC-S01-3 | PASS | manifest diff, local/built resource byte equality, Vite hashed reference, independent lint/typecheck, audited build/native logs |
| AC-S01-4 | PASS | fresh native run `run-1791949706426-73a68df7`, independent screenshot/hash/DPI/isolation audit; EXE SHA-256 `ef06b936da825542c990bbb2125f620075172992ac25d4e680bd58adb663b41e` |

Preliminary native failures `run-1791949382974-a6aebd66` and `run-1791949472510-dd2b6ae8` are retained as failures. The third run is retained as provisional/wrong-taskbar evidence. Only the fourth run and its visual review establish AC-S01-4. No unrun or wrong-target result is upgraded by this report.
