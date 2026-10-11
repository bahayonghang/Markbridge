# Component Guidelines

Expose profile, connection, source freshness, search, folders, bookmarks, and detail. Distinguish empty, loading, failed, stale, and read-only states without relying only on color.

The user requested content previews and full webpage browsing. Separate metadata, modification diffs, and remote content. Never inject fetched HTML into the trusted application DOM. Remote pages have no application file, secret, or mutation permissions.

Show original and proposed values. Apply shows target profile and item count. Disable browser mutations when disconnected, reconciling, or protected. Local metadata can remain editable.

Provide keyboard navigation, visible focus, accessible labels, and a keyboard alternative to drag-and-drop. Preview affected items before deletion or bulk changes.

Preserve user drafts when external edits cause conflict. These contracts have no component implementation yet. UI tasks must add native screenshot and interaction evidence.
