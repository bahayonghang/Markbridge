# C01 independent review — 2026-10-14

Result: PASS for AC-C01-1 through AC-C01-4 within the approved C01 browser/visual-foundation scope. The next child may start after the main session records acceptance. This does not establish native C02/C04 or original task13/15 acceptance.

## Findings (fixed)

- File: `apps/desktop/src/styles.css`; regression: `tests/e2e/appearance-captions.spec.ts`.
- Issue: the new caption floor did not reach HTML `small` consumers. At standard size, the real FolderPicker read-only reason rendered at10px; duplicate metadata and link-check metadata rendered at10.8333px. This violated the C01 caption minimum12px.
- Fix: one shared `small { font-size: var(--text-caption); }` rule. No v1 storage, body/control sizing, virtual-row height, state ownership or business behavior changed. Added a focused browser regression that opens the actual folder picker and maintenance results at640×480 for all three existing sizes.
- Evidence: `review-before/captions/standard.json` and its screenshots preserve the reproduced failure. `review-after/captions/{small,standard,large}.json` and screenshots record the correction. Standard now measures12px in all three consumers; large measures13.8462px. Caption bounds remain inside unchanged48/52/60px rows. The test's first setup attempt used an editing fixture with no disabled directory; the subsequent library fixture exposed the real failure. No threshold was relaxed.

## Findings (not fixed)

None within C01. Real installed-font enumeration/rendering, precise v2 sizing, later layout changes, fresh native restart and actual125/150%DPI remain the assigned C02–C04 work; they are not claimed by these browser/mock results. Original13/V12 and15/V18 remain open.

## Verification

- Lint: PASS, current post-fix `pnpm lint`, exit0.
- TypeCheck: PASS, current post-fix `pnpm typecheck`, exit0.
- Build: PASS, current post-fix `pnpm build`, exit0, production scanner passed; desktop CSS `index-S2jBUJQC.css`.
- Focused browser tests: PASS,7/7,12.4s, exit0. Command: `pnpm exec playwright test tests/e2e/appearance-captions.spec.ts tests/e2e/appearance.spec.ts tests/e2e/editing.spec.ts tests/e2e/organize.spec.ts --grep 'auxiliary captions|contrast uses|batch destination.*640x480|R07 scope.*640x480' --workers=1`. Output: `review-after/`. Uses the existing isolated synthetic `mockBridge`; no daily Chrome data.
- Actual light/dark rendered text, boundary and focus contrast was rerun after the correction; all40 measurements per theme passed4.5:1 text and3:1 controls/focus. Reports: `review-after/appearance/{light,dark}-contrast.json`.
- Broad regression: implementer83/83 browser matrix and232 Vitest +25 Node tests passed before the one-rule reviewer correction. These remain honestly tied to `pre-review-fingerprint.json` and `implementation-validation.md`; they were not unnecessarily rerun. Six official sizes plus2549×1356, all three v1 sizes, both themes, five settings categories, checkbox/drafts/anchors and confirmation reachability were covered.
- Visual inspection: post-fix large-size folder-picker and maintenance640×480 screenshots, plus the retained dark large confirmation640×480. Captions are legible, retain existing row bounds, and the affected minimum-window editing/organize action reachability tests passed.
- `git diff --check`: PASS, exit0.
- `ui-preferences.ts`, `VirtualRows.tsx` and brand assets are unchanged. No Rust, protocol, extension, permission or network-font changes. The root DESIGN and frontend specs describe the C01 transition and C02 boundary consistently.
- Final source/build hashes: `fingerprint.json`. Baseline and all pre-review matrix outputs remain frozen; native execution is NOT_RUN for this child.

The main session owns task status, parent integration and acceptance checkboxes. No commit, archive, installation, signing, push or publication was performed.
