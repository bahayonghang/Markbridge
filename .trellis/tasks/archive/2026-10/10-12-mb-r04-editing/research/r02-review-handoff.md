# R02 review handoff to R04

2026-10-13 independent R02 review observed a pre-existing node-level edit preview race in `apps/desktop/src/features/library/EditDesk.tsx`: `requestPreview` has no request generation; a preview started for node A may arrive after selection changes to B in the same profile and reappear. R02 guards source changes by remount and source generation, but this same-profile editing lifecycle belongs to R04.

During R04 implementation, reproduce with deferred `previewEdit`, then bind preview acceptance to the current source/profile, node, revision, and request/cancellation generation. Test node switch, changed revision, cancel, and an older preview arriving after a newer preview. A preview still never authorizes an apply. Keep drafts as the approved design requires rather than clearing unrelated input silently.

This is a review finding to verify against current R04 code, not an R04 test result or new scope beyond the approved safe editing flow.
