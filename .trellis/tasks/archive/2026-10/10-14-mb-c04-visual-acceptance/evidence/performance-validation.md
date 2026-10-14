# C04 native B10K performance

**The planned ordinary-search gate passes in both runs. The additional startup gate fails in both runs and remains unresolved.** Neither complete raw receipt is relabeled PASS.

| Run | Formal search samples | Search p95 / max | Three fresh-process startup samples | Raw overall |
|---|---:|---|---|---|
| [c398f6c2](current-performance-c398f6c2-77d8-4e79-99ca-4ac546530e08-receipt.json) |30|142.8 /145.7ms|4605.9 /735.2 /728.0ms|FAIL: COLD_START_OVER_3000MS|
| [0681df82](current-performance-0681df82-d2a0-479c-bf47-392d7e2d634e-receipt.json) |30|149.8 /161.4ms|1108.5 /1090.5 /4552.3ms|FAIL: COLD_START_OVER_3000MS|

## Method and identity

Both runs use `node .trellis/tasks/10-14-mb-c04-visual-acceptance/evidence/current-performance-probe.mjs`, exit1 due to the retained startup check. The producer copies the original methodVersion2 probe with task-local evidence output; timing, fixture and thresholds are unchanged. Each run uses a new temporary root, the same current executable SHA256 `8c1f59be4ea553b32e0eed1df3f167e0cfd19c7136b1b31734c3254317c56bbc`, and the frozen build-time source manifest in `pre-build-source.json` (production `e199c0aa…69311`). No installer or Chrome is used.

Rust seeds11004 nodes:10000 bookmarks,1000 folders, maximum depth20, seed20261010. Search measures browser-monotonic time immediately before the input event until the exact marker is visible, loaded1/1, enabled and rechecked on the next animation frame. One warmup is separately recorded, then30 samples; p95=`sorted[ceil(n*.95)-1]`. The search threshold remains **≤200ms**, without subtraction, sample rejection or mocked timing.

Startup measures spawn through the first observed operable readonly B10K tree/list/search. CDP discovery and polling overhead remain included. OS disk caches are not purged. Three fresh application processes share that run's isolated app store; each second run starts a new store. Main OS path/owned listener/actual WebView ancestry guards validate the observed candidate before acceptance. The supplementary startup threshold remains **≤3000ms for every sample**.

Other build, browser and reviewer test processes had finished before performance measurement. Ordinary OS background load was not instrumented or claimed absent. All eight application launches across both runs closed normally with exit0; the corresponding owned process/listener arrays are empty. Both runs record zero page errors.

## Unresolved startup observation

The first run's slow sample reaches `cdpTargetSeen` at4539.3ms and DOM-ready at4605.9ms. This locates most observed delay before target discovery but does **not** establish whether the cause is application startup, WebView, OS scheduling, networking/discovery or observation overhead. The same-method repeat has a4552.3ms third startup, so the observation is not limited to first-use initialization. Cause remains **UNVERIFIED**. No product code or threshold was changed in response, and no further runs were used to seek a passing receipt.

The historical original13 receipt `6c7edb60…` had startup788.4/633.6/728.6ms under methodVersion2. It remains historical evidence for its old executable, not proof for this one. Its record and the old parent V06 result were not rewritten. The current executable cannot be advertised as having passed the old full startup/search performance gate.

## Scope conclusion

The approved new parent [V14](../../10-14-mb-claude-workspace-optimization/verification.md) and AC-C04-3 require the ordinary-search p95≤200ms regression check; both current runs satisfy it. They do not add a startup optimization deliverable. Final C04 acceptance must explicitly carry this additional startup failure as an open observation, rather than claim full performance or release readiness. Original13/V12,15/V18 and the original parent remain unfinished.
