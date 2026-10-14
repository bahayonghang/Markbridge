# Markbridge Project Baseline

## Evidence and status

Desktop source is in `apps/desktop`, the MV3 extension in `apps/extension`, Rust storage/bridge services in `crates/core`, and shared DTOs in `crates/protocol` and `packages/protocol`. The running desktop opens its SQLite storage and provides pairing, live mirror queries, confirmed editing, local metadata, previews, history/export and optional AI proposals. The approved redesign parent is `.trellis/tasks/archive/2026-10/10-12-mb-workspace-redesign`; R01–R07 passed their child acceptance on 2026-10-13. R08 AC1–AC5 passed final integration. On 2026-10-13 the user explicitly waived actual OS sleep/wake acceptance for this redesign, superseding the earlier deferral: AC6 is WAIVED, execution remains NOT_RUN and legacy V04 remains UNVERIFIED. It no longer blocks this redesign; the 2026-10-13 closeout audit applies that same waiver to legacy03/04 after verifying their other AC evidence. Original01-12 and redesignR01-R08 are completed. Original13, original15, and the original parent remain unfinished. Child14 is archived only as deferred non-Windows scope: V17 stays NOT_RUN and is not a support claim. Other safety and acceptance contracts are unchanged. These source and child-acceptance facts do not imply installer release, external synchronization, real-model quality or cross-platform acceptance. Git ignores `ref/`; tracked task documents preserve the implementation contracts.

JSON examples remain documentation fixtures unless linked to an existing fixture. Runtime results and remaining gates belong in task evidence. Never report planned checks as executed or a historical result as a fresh run.

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

On 2026-10-13 the user approved a narrow child13→14/15 startup exception: current Windows installation, explicit diagnostics and affected automated gates must pass first, while child13's missing actual-model V12/full acceptance remains incomplete. This does not waive model acceptance or complete M4/the original parent. User confirmed no native macOS/Linux hosts or local embedding model; child15 actual V18 remains NOT_RUN. See `.trellis/tasks/10-10-markbridge-workspace/gate-proposal-2026-10-13-model.md`. The same turn authorized disclosed current-user temporary installer/uninstaller tests and necessary fresh-temp reruns, not daily installation, signing or publication.

Later the same day the user set Windows as the default delivery and said to leave other platforms aside. Child14 therefore leaves the active queue. Its executable adaptation remains in source, while V17 stays NOT_RUN and macOS/Linux stay unsupported. This deferral does not waive V12 or V18.

On 2026-10-13 the user approved the redesign and initially deferred real OS sleep/wake verification until R08. The later explicit instruction “这一条不用管，使用的时候也不会睡眠” supersedes that deferral and waives this check for the redesign. AC-R08-6 is WAIVED, execution remains NOT_RUN, and legacy V04 stays UNVERIFIED; sleep no longer blocks R08 or the redesign parent. No other gate or runtime safety contract is waived. The authoritative decision history is `.trellis/tasks/archive/2026-10/10-12-mb-workspace-redesign/gate-change-2026-10-13.md`.

Public preview fetch accepts only HTTP and HTTPS. It rejects userinfo, loopback, private, link-local, multicast, and cloud-metadata addresses, including a resolution that changes to one of those addresses. Parsing does not run page script. A summary is a page description or a visible excerpt. Source images use the same fetch guard. Ollama loopback is not a public-fetch target. Production settings do not contain a switch that allows a forbidden address.

A full-page preview is a separate `preview-*` WebviewWindow. It is not the public fetch path. The preview window has no application capability, file permission, or secret. Ollama loopback is not added to the preview window.

AI assistance is off until the user enables a provider, endpoint, and model. Page text and model output are data. A suggestion does not write Chrome. A confirmed title uses the existing edit apply path. Model keys use the OS credential service `Markbridge.Model`, separate from `Markbridge.Pairing`. React and the extension do not receive the key. The model client is separate from public page fetch and does not change the public address denials. A configured local model run is recorded in the child 10 receipts; a scripted fixture is not that run.

Child 12 checks dead links and duplicate URLs only inside a user-selected scope. URL grouping changes scheme, host, and default port. Query, fragment, and path stay distinct. The same URL does not merge sidecar metadata until the user confirms a keeper. Link probes use the public fetch guard. Cleanup deletes go through the existing operation engine. Summary and note search uses the profile-scoped FTS5 trigram index, with a parameterized substring query below 3 characters.
