# Markbridge Project Baseline

## Evidence and status

The repository contains Trellis tooling and `ref/Markbridge-实施方案.md`. No application manifest, source, database, or product test suite exists as of 2026-10-10. Git ignores `ref/`; tracked task documents must preserve all requirements needed for implementation.

These guidelines define greenfield constraints. They do not report existing runtime behavior. JSON examples are documentation fixtures, not source excerpts. Add real implementation and test references when product code exists. Never invent source evidence or report planned checks as executed.

## Product boundaries

- Markbridge is a Tauri 2 desktop bookmark workspace with a Chrome Manifest V3 extension.
- The user requested local real-time synchronization, editing, tags, AI assistance, content previews, and full webpage browsing inside the application.
- Confirmed product choices: Windows first; macOS/Linux later; tags remain local by default, with optional explicit title encoding.
- Chrome owns bookmark titles, URLs, folders, and order. SQLite owns local metadata, proposals, and operation history.
- Browser mutations use `chrome.bookmarks`. Browser bookmark files are read-only inputs.
- A preview or AI proposal does not authorize application. Require an explicit apply action.
- Local synchronization does not include a new cross-device cloud service.

## Verified external constraints

Checked on 2026-10-10 against primary documentation:

| Constraint | Source |
|---|---|
| API IDs are profile-scoped; the API has no `guid`. Browser-added folder types can occur zero, one, or multiple times. | [Chrome bookmarks](https://developer.chrome.com/docs/extensions/reference/api/bookmarks) |
| Active WebSocket traffic supports MV3 worker liveness from Chrome 116; worker restart still needs recovery. | [Chrome WebSockets](https://developer.chrome.com/docs/extensions/how-to/web-platform/websockets) |
| Injection requires `scripting` and host authorization. | [Chrome scripting](https://developer.chrome.com/docs/extensions/reference/api/scripting) |
| An extension gesture grants `activeTab`; a desktop action does not grant access. | [Chrome activeTab](https://developer.chrome.com/docs/extensions/develop/concepts/activeTab) |
| Capabilities depend on window/webview labels; remote content has no command access by default. | [Tauri capabilities](https://v2.tauri.app/security/capabilities/) |
| Child webviews require the unstable feature. A separate WebviewWindow uses the stable API. | [Tauri webview](https://v2.tauri.app/reference/javascript/api/namespacewebview/) |

## Terms

Use `profileId` for an application-owned paired profile identity, `chromeId` for the browser node ID, and `bookmarkId` for the local persistent identity. Use `sourceEpoch` for an identity reset and `sessionId` for a transport connection. A display name is not an authenticated identity.

A proposal is unapplied. An operation is confirmed for execution. A snapshot records before-state. A receipt records an observed result. A snapshot alone does not prove successful rollback.

## Authorization and evidence

The current request authorizes bootstrap specs and product planning. Keep product tasks in `planning` until implementation approval. Do not commit, publish, install extensions, or modify real browser profiles during planning.

Separate document checks, unit tests, browser tests, native desktop tests, and external synchronization tests. Preserve failures and label absent evidence `NOT_RUN` or `UNVERIFIED`.
