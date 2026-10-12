# Frontend Directory Structure

`apps/desktop/src/` contains the React empty state. `apps/extension/src/` contains the unpaired popup. Both locations use TypeScript and Vite. These foundation surfaces do not implement pairing or bookmark access.

Organize actual features around connection, library, editing, preview, tags, AI, and history. Keep typed backend access in one boundary module. Components do not access SQLite, browser files, provider endpoints, or secrets.

The extension owns pairing and user-authorized capture UI. Its worker lifecycle stays separate from UI effects. Share protocol definitions, not privileged adapters.

`apps/desktop/src/backend.ts` owns the startup IPC boundary. `apps/desktop/src/App.tsx` owns startup loading, unpaired, and safe error states. `packages/protocol/src/index.ts` validates the startup DTO. `apps/extension/public/manifest.json` owns the MV3 manifest. Do not create empty folders solely to match a proposed tree.

Child 07: `apps/desktop/src/features/tags/TagDesk.tsx` edits local tags and notes. `apps/desktop/src/features/library/LibraryWorkspace.tsx` owns multi-select and replaces the visible list for a tag filter. File mirrors do not mount the tag desk. `apps/desktop/src/features/tags/tags.test.tsx` covers the offline multi-select path and the encoding diff.
