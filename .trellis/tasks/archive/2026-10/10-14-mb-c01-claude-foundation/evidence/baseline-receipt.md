# C01 before baseline

2026-10-14, source `1000103`, no product edits at run time. Existing mock-IPC Playwright fixtures; this is browser evidence, not native acceptance.

Command: `pnpm exec playwright test tests/e2e/appearance.spec.ts tests/e2e/shell.spec.ts --grep 'S03 appearance light standard 1440x900|S03 appearance dark standard 1440x900|S03 appearance light large 640x480|R01 shell and settings 1440x900' --workers=1` (via `rtk proxy`, outside the sandbox).

`MARKBRIDGE_EVIDENCE_DIR` points to this task's `evidence/before`. Result: **4 passed (10.1s), exit 0**. Screenshots include all five settings categories and confirmation states in the three selected appearance combinations, plus library/detail/AI at 1440×900. Root visually inspected General/light/standard and library screenshots.

Tooling: `pnpm --version` inside the sandbox did not return and was stopped. The same read outside the sandbox returned 12.12.0. The standard repository Playwright command then worked without changes to product tooling or package-manager configuration. Previous planning attempts remain UNVERIFIED; this new run supplies the missing baseline.
