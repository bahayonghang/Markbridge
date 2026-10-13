# State Management

| State | Owner |
|---|---|
| Browser tree and revision | Backend cache derived from Chrome |
| Tags, notes, summaries, history | SQLite through backend |
| Selection, search input, panels | Frontend |
| Unsaved edits and selected proposals | Explicit UI drafts |
| Remote webpage session | Isolated preview WebView |

Do not maintain several independently mutable copies of the browser tree. Keep original titles separate from suggestions and optional tag encoding.

Distinguish unpaired, connecting, reconciling, live, cached read-only, file read-only, and error. Only live state permits browser writes.

Documentation fixture:

```json
{"profileId":"profile-a","connection":"cached_read_only","canEditLocalMetadata":true,"canWriteBrowser":false}
```

No state library is installed. Additional dependencies need an actual shared-state requirement. An AI response remains a proposal until a confirmed apply receipt exists.

`AiSettings` may call `ai_settings` on mount. It does not call the model until the user tests the connection. The model key uses an uncontrolled password input and is cleared before the result is rendered. `AiSuggest` calls `suggest_ai` only from the generate button. A profile, bookmark, URL, or revision change drops the draft and cancels the in-flight request. Folder text is display-only. Confirmed title undo uses the existing edit undo action.

R03 keeps one full folder index for paths and separately loads the visible query through `useLibraryQuery`. The query key includes source kind/id and visit generation, revision, folder, text, tags and explicit summary/note flags. Reject late results even after A→B→A; a CONFLICT discards accumulated pages and restarts at offset zero. Local metadata mutations also invalidate matching pages because they need not change Chrome revision. File mirrors use their own tree snapshot and never invent tags, notes or summaries.

Metadata invalidation follows validated saved flags even if the active bookmark changed before completion; discard the old success UI but keep source-visit guards on the invalidation callback. Receipt handling can restore/merge metadata after the corresponding Chrome event, so sidecar-dependent queries also use the existing global BridgeState revision as a conservative invalidation signal. This may reread a filtered query after another profile's publication; plain title/URL queries do not use this extra token. Do not overwrite unsaved detail drafts to refresh a query.

Active keyboard focus and multi-selection are separate. Ctrl+A selects the currently loaded scope; loading another page does not silently add selected items. Folder/query/filter/source changes clear selection with a visible notice. Virtualized keyboard navigation must scroll the active item into view and preserve truthful aria-posinset/aria-setsize; tree values describe siblings, list values describe the full result count. Deep breadcrumbs scroll the current location into view. Pure navigation between app sections retains the library query and drafts.

R04 keeps blank bookmark and folder creation drafts separate from selected-node edits. Preview completion is bound to source visit, node, revision and draft generation. A changed draft or external revision invalidates confirmation while retaining input. Own write events may advance revision before apply resolves; retain the returned operation for the same identity/draft rather than losing its receipt watcher. Lock duplicate confirmation synchronously.

Daily multi-selection uses backend-reviewed groups and a shared `BatchReceipt` view. Persisted history can reopen per-item results after detail closure, source switches or restart; source/operation keys and request generations reject stale reads and stop responses. Closing a panel is not cancellation or rollback. Replacing ordinary actions with selection actions must keep the first row's position stable, otherwise the second click of a folder double-click hits a different row. Preserve a visible directory/path entry in selection mode. Folder targets collapse after pointer selection or keyboard Enter; arrow navigation stays open.

Native classic scrollbars contribute to the breadcrumb's height even when headless Chromium does not. Keep the ordinary heading in layout with visibility hidden, aria-hidden and inert while overlaying selection actions in the same container; do not swap it for a fixed-height bar. Verify a long overflowing path with an actual scrollbar, keyboard access to the full path, and unchanged first-row Y through selection/cancellation. Keep the full-path popup scrollable and within the minimum-height viewport.

R05 splits single-item detail into information, local metadata and content tabs. Multi-selection shows shared metadata actions. Hiding detail or changing app sections keeps local note/tag drafts mounted; changing item, source, folder, query or filter scope passes through the same explicit keep/discard transition, including Ctrl+End and folder Enter. Keep the list mounted so closing detail restores its scroll position.

Local metadata and title-encoding operations bind the draft's sourceEpoch. A dirty draft keeps its original epoch across a source identity reset; CONFLICT retains input for copy/discard and cannot silently retarget it. A clean catalog must finish loading for the new epoch before mutations become available. Keep metadata text read-only while its catalog identity is unknown, loading or stale, so editing an old visible value cannot make it a new-identity draft; text remains copyable. Same-identity saves may still accept continued typing. Product calls always send expectedSourceEpoch; the optional IPC argument only preserves older callers. Changing epoch or metadata refresh invalidates title diffs and pending preview responses.

Local save success clears only the submitted note/tag text, preserving edits typed while the save was pending. External catalog refresh must not overwrite dirty notes. A confirmed save invalidates its original source even after selection changes, while stale success UI is discarded. Content preview mounts only in the visible single-bookmark content tab, with source epoch in its identity key; hidden panels do not fetch, and an identity reset cancels old content work even when chromeId and URL are reused. R07 moves AI suggestions into the persistent, source/epoch-bound organize workspace.

R07 single AI suggestions live in the organize workspace, not the content-preview tab. Offline paired Profiles may still confirm local tags/summary only; title confirmation and undo require live. OrganizationRange start/end are end-exclusive; display the sum of end-start, not the number of ranges. Explicit source/scope changes may hide old operation state, but persistent history remains the recovery entry. AI credentials stay uncontrolled and the password element is cleared before awaiting credential storage, including failure.
