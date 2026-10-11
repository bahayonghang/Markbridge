# Markbridge Project Baseline

## Evidence and status

The repository contains Trellis tooling, child 01 foundation source and child 02 protocol/storage source. Desktop source is in `apps/desktop`, extension source is in `apps/extension`, and shared startup/wire DTOs are in `crates/protocol` and `packages/protocol`. Child 01 native acceptance remains UNVERIFIED under the approved 01-to-02 startup exception. Child 02 storage source and temporary-database tests live under crates/core/src/storage. The desktop startup does not open a database. No pairing, bookmark mutation or AI feature exists yet. Git ignores `ref/`; tracked task documents must preserve all requirements needed for implementation.

These guidelines distinguish foundation source from later design constraints. JSON examples remain documentation fixtures unless linked to an existing fixture. Runtime results belong in task evidence. Never report planned checks as executed.

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

The user approved implementation of the current parent and child plans on 2026-10-10. Activate one child only after prerequisite acceptance passes. The user approved one exception on 2026-10-10: start child02 after child01 automated checks, with child01 native acceptance UNVERIFIED until Windows delivery. Other dependency gates remain required. The parent coordinates requirements and integration. Commits, archives, publication, system installation, and changes to daily browser profiles require separate authorization.

Separate document checks, unit tests, browser tests, native desktop tests, and external synchronization tests. Preserve failures and label absent evidence `NOT_RUN` or `UNVERIFIED`.

Public preview fetch accepts only HTTP and HTTPS. It rejects userinfo, loopback, private, link-local, multicast, and cloud-metadata addresses, including a resolution that changes to one of those addresses. Parsing does not run page script. A summary is a page description or a visible excerpt. Source images use the same fetch guard. Ollama loopback is not a public-fetch target. Production settings do not contain a switch that allows a forbidden address.
