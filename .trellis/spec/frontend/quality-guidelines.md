# Frontend Quality Guidelines

Child 01 provides `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm protocol:check`, and `pnpm test:e2e`. Run results belong in the current task receipts. These commands do not establish later-child functionality.

Foundation tests are `apps/desktop/src/App.test.tsx`, `packages/protocol/src/index.test.ts`, `scripts/foundation.test.mjs`, `scripts/protocol.test.mjs`, and `tests/e2e/foundation.spec.ts`. Production checks are in `scripts/check-artifacts.mjs`. The Windows CI definition is `.github/workflows/ci.yml`; a local pass does not prove hosted CI passed.

Child 02 wire tests are in `packages/protocol/src/wire.test.ts`. These tests serialize typed DTOs in each language, invoke the Rust fixture executable, and compare runtime acceptance of valid and invalid frames. They also check field, frame, tree, Unicode and operation bounds. The protocol module has no GUI database or Chrome connection.

Validate keyboard navigation, moving, profile switching, edits, proposal review, read-only states, and conflicts. Fixtures include duplicate URLs, equal IDs across profiles, long titles, deep folders, and non-ASCII tags.

Test late preview responses, open drafts invalidated by browser edits, and disconnect during apply. Unknown results must differ from confirmed failures.

DOM tests cover state and interactions. Native Tauri runs cover remote preview isolation, focus, OS behavior, and rendering. Record viewport and runtime with screenshots. Mock IPC does not establish native correctness.

Performance evidence includes item count and machine details. Virtualization preserves selection and keyboard behavior. Avoid tests that only duplicate implementation markup.

`apps/desktop/src/features/preview/web-preview.test.tsx` checks the main-window controls, stale results, and the Chrome fallback label. That file does not mark parent V11 passed.
