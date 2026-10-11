# Component Guidelines

Expose profile, connection, source freshness, search, folders, bookmarks, and detail. Distinguish empty, loading, failed, stale, and read-only states without relying only on color.

The user requested content previews and full webpage browsing. Separate metadata, modification diffs, and remote content. Never inject fetched HTML into the trusted application DOM. Remote pages have no application file, secret, or mutation permissions.

Show original and proposed values. Apply shows target profile and item count. Disable browser mutations when disconnected, reconciling, or protected. Local metadata can remain editable.

Provide keyboard navigation, visible focus, accessible labels, and a keyboard alternative to drag-and-drop. Preview affected items before deletion or bulk changes.

`apps/desktop/src/features/tags/TagDesk.tsx` keeps notes and tags editable while the profile is disconnected. Title encoding lists every selected title change before `apply_title_encoding`. A local tag command, an encoding toggle, a selection change, or a revision change drops that diff, including a preview that returns late. Turning the encoding control off does not send a title write.

Preserve user drafts when external edits cause conflict. UI tasks must add native screenshot and interaction evidence.

`apps/desktop/src/features/preview/WebPreview.tsx` opens one in-app page for the selected bookmark from the trusted main window. The panel names the current profile and the selected URL, and it shows the preview-window URL separately. Closing the window keeps that profile session until the user confirms clear. A failed or blocked load tells the user to continue in Chrome and does not promise site or Chrome login compatibility. The desktop control does not grant the extension `activeTab`.
