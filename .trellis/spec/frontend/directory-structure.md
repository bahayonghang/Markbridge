# Frontend Directory Structure

The reference plan section 5 proposes `apps/desktop/src/` and `apps/extension/`. Neither exists. The product design selects the framework and tooling.

Organize actual features around connection, library, editing, preview, tags, AI, and history. Keep typed backend access in one boundary module. Components do not access SQLite, browser files, provider endpoints, or secrets.

The extension owns pairing and user-authorized capture UI. Its worker lifecycle stays separate from UI effects. Share protocol definitions, not privileged adapters.

Add exact source references when implemented. Do not create empty folders solely to match a proposed tree.
