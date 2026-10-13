# R03 review handoff to R05

2026-10-13 independent R03 review observed existing `AiSuggest` busy state surviving a selection change while an AI request is pending. Old response guards correctly discard stale UI, but the shared busy flag can remain true until explicit cancellation. R03 fixed successful local metadata invalidation independently of the selected item's success UI; keep that behavior when repairing this lifecycle.

During R05 rapid A/B selection acceptance, reproduce with deferred generation/apply responses. Each new selected item must have usable controls; stale completions must not clear a newer request's busy state, overwrite the new draft, or trigger apply. Preserve an already-confirmed local save's source-guarded query/catalog invalidation even if selection changes before completion. Verify source changes, cancellation, and repeated A/B navigation. This is a finding for verification, not a passed R05 test.
