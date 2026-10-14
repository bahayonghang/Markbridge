# Component Guidelines

Expose profile, connection, source freshness, search, folders, bookmarks, and detail. Distinguish empty, loading, failed, stale, and read-only states without relying only on color.

## Bookmark workspace shell (R01)

`App` owns the `library | organize | history | settings` navigation and mounts one `useBridge`. `ConnectionSettings` contains pairing/listener/mirror controls; `AiSettings` is first mounted only after opening its settings tab. Do not put configuration forms back before the bookmark list. Settings tabs use matching tab/tabpanel IDs and support ArrowLeft/ArrowRight/Home/End.

Keep `LibraryWorkspace` mounted across navigation so source, query, selection and edit drafts survive. Its `active` and `section` props govern visible content, not a second tree cache. Mount `ContentPreviewPanel` and `WebPreviewPanel` only for active, open library details. Navigating to Organize or AI settings must not start a link probe, model call or browser mutation.

Use the CSS tokens in `styles.css`: neutral sidebar, white content and blue selected/focus states. List rows are 52px; folder rows are 40px. Text-input rules exclude checkbox/radio inputs; checkboxes are 16px inside a 40px target. Below 1100px detail replaces the list; below 800px the folder view also replaces it. Hidden replacement content must not remain keyboard-focusable. Escape/close restores the corresponding trigger's focus.

Checkboxes are independent controls inside virtual rows. `onListKey` must ignore events originating from checkbox inputs, and `VirtualRows` must not move focus away from a checkbox when the rows array changes. Space changes the checkbox; Enter must not invoke the row's open action. Test this with an already active row, not only an initially empty selection. See `tests/e2e/shell.spec.ts`.

R06 separates `HistoryWorkspace` and `ExportDesk` from `EditDesk`, which owns editing only. History is independent of a selected bookmark and remains readable offline; browser undo requires live state and explicit review/confirmation. Show operation type, time, affected count and truthful state first, with IDs and restore mappings in diagnostics. A deleted folder's history includes its original descendants. Undo review contains the complete bounded plan, not a truncated sample.

Exports are reachable from settings and history. `save_export` opens a Rust-owned native dialog and returns saved/cancelled/failed. Report saved only after actual writing succeeds; cancellation must not show success. Display the captured source, revision and cache time. Mirror sources offer HTML only. Sidecar JSON retains local metadata but is not a full-library restore format. Neither output body nor selected filesystem path enters the frontend.

Task13 `DiagnosticExport` is a sibling in Chrome connection settings. State the fixed report contents and exclusions before the explicit action, call no-argument `save_diagnostics` only on click, and prevent duplicate clicks with an immediate lock. Do not receive or render report contents or paths. Use generated `DiagnosticSaveResult`, safe saved/cancelled/failed copy, an unmount guard, and the existing panel/typography/focus tokens. See backend [diagnostic export contract](../backend/logging-guidelines.md) and `tests/e2e/diagnostics.spec.ts`; browser IPC mocks remain separate from native save and preview-denial evidence.

The user requested content previews and full webpage browsing. Separate metadata, modification diffs, and remote content. Never inject fetched HTML into the trusted application DOM. Remote pages have no application file, secret, or mutation permissions.

## Connection and source handoff (R02)

First-run onboarding and Chrome settings share `ConnectionSettings` and the single bridge subscription. Opening either must not enumerate local profiles automatically or initialize AI. Show file-path errors outside the connect-only branch so the read-only path can recover. Bind an enumerated choice to the path used by that enumeration; clear choices when the path changes.

The workspace connection label describes the selected `kind:id`, not whether any profile is live. Use actual cache timestamps; missing times mean unknown, and file freshness never implies browser write access. Settings browse actions go through the same source-switch guard as the source selector. Explicit discard resets detail inputs; cancel keeps them and returns focus to a visible control. Key source-specific children by source identity, with distinct prefixes for siblings. Async callbacks must match both the source identity and a generation incremented on every source switch: after A -> B -> A, the first A callback must still be discarded.

Pairing expiry is a deadline, not a simulated connection transition. Expired tickets/candidates cannot be confirmed; the user may cancel or regenerate. Revocation uses `ConfirmDialog`, explains cache/bookmark effects, defaults focus to cancel and sends no revoke command until confirmation. If the trigger becomes hidden during navigation, pass a visible return-focus target.

Show original and proposed values. Apply shows target profile and item count. Disable browser mutations when disconnected, reconciling, or protected. Local metadata can remain editable.

Provide keyboard navigation, visible focus, accessible labels, and a keyboard alternative to drag-and-drop. Preview affected items before deletion or bulk changes.

`apps/desktop/src/features/tags/TagDesk.tsx` keeps notes and tags editable while the profile is disconnected. Title encoding lists every selected title change before `apply_title_encoding`. A local tag command, an encoding toggle, a selection change, or a revision change drops that diff, including a preview that returns late. Turning the encoding control off does not send a title write.

`apps/desktop/src/features/organization/OrganizationDesk.tsx` stays mounted within the visited, source/epoch-bound `OrganizeWorkspace`, including offline review. It does not call the model on mount. A revision change invalidates an unconfirmed plan and shows `资料已变化。旧方案不能应用。`, retaining the review for inspection. Each assignment row shows the source label, the target folder, a reject control, and the impact count. Apply stays disabled unless the phase is `ready`, the connection is live, and `sourceRevision` matches the current revision. Empty-folder cleanup uses a separate confirm button. The first cleanup button does not send a delete.

Preserve user drafts when external edits cause conflict. UI tasks must add native screenshot and interaction evidence.

`apps/desktop/src/features/preview/WebPreview.tsx` opens one in-app page for the selected bookmark from the trusted main window. The panel names the current profile and the selected URL, and it shows the preview-window URL separately. Closing the window keeps that profile session until the user confirms clear. A failed or blocked load tells the user to continue in Chrome and does not promise site or Chrome login compatibility. The desktop control does not grant the extension `activeTab`.

`apps/desktop/src/features/maintenance/MaintenanceDesk.tsx` stays mounted inside the visited `OrganizeWorkspace`. It does not start checks on mount. Preview cleanup does not confirm a delete. Confirm stays disabled unless the profile is live and a fresh preview is visible. A running link check does not disable the tree or the ordinary edit desk. Completed cleanup links to the unified history for undo review. A revision change drops an unconfirmed preview and keeps a confirmed operation id and its receipt watch.

`apps/desktop/src/features/library/EditDesk.tsx` puts `回执已确认。` in a status paragraph when confirm receives `applied` or `rolled_back`. `apply_edit` can return `applying` or `rolling_back` first. Confirm then reads `list_operations` for that operation id until the state is not `planned`, `applying`, or `rolling_back`, and the same paragraph follows `noticeFor`. A new preview drops that watch. Tests: `apps/desktop/src/features/library/library.test.tsx`.

R07 places maintenance, folder organization and single AI suggestions in a broad OrganizeWorkspace, separate from bookmark details. Show the captured selection or explicit folder path (including descendants) and count before starting. Reuse the validated folder index; do not silently truncate at the maintenance 1000 / organization 900 bounds. Page entry and tab navigation may read local settings but never start link checks, content fetches or model requests. Show endpoint/model and actual sent data categories before generation. Keep settings in the settings workspace and preserve independent everyday browsing when AI is disabled.

Maintenance reports include cached link rows even for duplicate inspection. Choose completion feedback from the requested action, never from the presence of links. Mark untouched link rows as cached and zero checks as not yet checked.
