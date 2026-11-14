# Current Windows installer acceptance harness

`current-installer.mjs` is a new acceptance run against the actual installed executable. Archived R08 receipts remain frozen; pairing logic is reused without running an archived launch entry point. Probe and window helpers are task-local, with explicit process ownership and page-generation checks. `v15-isolated.mjs` is not used.

## Prepare the concrete installation plan

From the repository root, after `pnpm build:package` and the affected checks:

```powershell
node .trellis/tasks/10-10-mb-13-windows-acceptance/evidence/current-installer.mjs prepare
```

This does **not** invoke setup or uninstall. It creates `markbridge-task13-native-<random>` directly under the canonical system temporary directory, extracts the package with 7-Zip, scans the packaged and release executables, checks their identical hashes and versions, and writes a unique `current-installer-<runId>-plan.json`. The installer, executable, NSIS script and extension hashes are pinned. It probes only exact Markbridge registration/shortcut names and the WebView2 runtime registration. Existing Markbridge registration, shortcuts or Run entry block installation; absent WebView2 blocks setup instead of installing a bootstrapper. It does not discover daily Chrome, application data or credential entries.

The printed plan names the concrete installation directory and the exact command. The main session verifies that this plan fits the user's authorized isolated-install and fresh-rerun scope before running:

```powershell
node .trellis/tasks/10-10-mb-13-windows-acceptance/evidence/current-installer.mjs run "<absolute plan path>" <approved runId>
```

Each rerun needs a fresh prepared root; current run receipts use both runId and attemptId and are never overwritten. A changed package/extension/NSIS script fails the pinned-plan check; prepare again after a final integration build.

## Installation and cleanup scope

- Current-user NSIS installation uses `/S /NS /D=<root>\install`, with `/D` last and unquoted. `/NS` suppresses desktop and Start menu shortcut creation; `/R` is absent. No elevated installation, signing, publication or daily installation occurs.
- Setup writes `HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\Markbridge` and `HKCU\Software\markbridge\Markbridge`. The second key remains after ordinary uninstall to remember the old install location. The harness checks exact key absence before installing and records the actual registration after installing/uninstalling. After completing the immutable raw run receipt, a narrowly guarded restoration removes only this run-created unnamed install-location value and its now-empty product key. It requires both preflights to prove absence, recorded installation into the guarded root, finished run identity, absent uninstall registration/program files, stopped fixture processes, and a current default REG_SZ value equal to `<root>\install` with no other values/subkeys. Conflicts preserve extra state; `Software\markbridge` is never deleted.
- The normal installed `uninstall.exe /S` removes installed program files and the uninstall registration. Standard Tauri NSIS cleanup may clear jump-list destinations for `com.markbridge.desktop` and remove a `Markbridge` Run value; preflight requires that Run value and all named Markbridge shortcuts to be absent. Those shell side effects and restoration of this run's new installation-location value/key are part of the authorized isolated-test scope. Silent uninstall leaves the data-delete checkbox unselected; no data-delete flag is used. Restoration does not touch the Run value, jump lists, parent key, daily app data or prior registrations.
- `MARKBRIDGE_APP_DATA=<root>\app-data` isolates SQLite, backups, main WebView at `main-webview`, and per-profile `preview-sessions`. The script never sets global environment variables or `WEBVIEW2_USER_DATA_FOLDER`.
- Before pairing or UI actions, the harness inspects only the known application PID's direct WebView2 children. It parses the actual `--user-data-dir`, normalizes Windows long-path prefixes, quotes, separators and case, and requires the exact owned `app-data\main-webview` host directory or its exact `EBWebView` runtime child to exist. WebView2 adds that runtime suffix, as described by [Microsoft's WebView2 directory guidance](https://learn.microsoft.com/en-us/microsoft-edge/web-platform/devtools-mcp-server#step-2-find-the-webview2-user-data-directory). An outside-fixture value fails immediately without probing or printing that outside path. Preview opens require the selected profile's exact 67-character component `v1-` plus lowercase SHA256 of UTF-8 `markbridge:preview-session:v1`, one NUL byte and UTF-8 profileId, or that folder's exact `EBWebView` child. Legacy full-ID hex is a product migration source only and never satisfies current native path acceptance. Another profile and arbitrary inside-root paths fail. Only fixture-relative observed paths are emitted. Mere compiled string presence or configured path is insufficient.
- Only `<root>\chrome-a` and `<root>\chrome-b` are used, with the built unpacked extension loaded through CDP. Only `Markbridge.Task06.mb13-<runId>` credentials are created. Revocation uses trusted app IPC; credential presence checks query exact generated targets and never enumerate stores or read credential blobs.
- Selected synthetic bookmarks drive the test. A single `https://example.com/` bookmark supplies the actual public content preview; a temporary loopback HTTP page supplies independent full-page sessions and all registered-command IPC denial probes, including `save_diagnostics`. Production public-fetch denials are unchanged.
- No recursive removal is performed. The ordinary uninstaller is the only file-removal operation. The app data, Chrome profiles, extracted binary, exports and screenshots remain for review. Exact SQLite hash and an inventory hash over every owned data filename/size/content SHA256 must match before/after uninstall. Symlinks in the data inventory fail the check. Owned fixture processes/listeners must be absent, and all known test ports must bind again.

## Actual assertions and evidence boundary

The run asserts current installed/package/release hashes and versions; real P2 pairing; sync/create cancellation/create/apply/edit receipts; local tag/note persistence without title encoding; actual public content preview; A/B/A preview cookie/storage isolation and remote IPC denial; native diagnostic cancel/save and fixed-schema/private-canary checks; normal app exit and Chrome exit; restart/reconciliation/no replay; targeted credential revocation; normal uninstall and data/process/listener retention policy. Screenshots mask the pairing-code field.

Every PASS is appended after its corresponding assertion. A first failure is preserved in its own raw JSON receipt and screenshot. A harness/locator/environment failure is labelled for triage, not automatically promoted to a product gate FAIL. Teardown errors also fail the run; no forced kill or recursive delete conceals them. A teardown failure may leave a fixture running or registered for manual follow-up; the receipt identifies the stage.

Registry restoration writes a separate unique `*-registry-restore.json`; a future automatic run also writes `*-completion.json`, whose result requires both native acceptance and registry restoration to pass. Raw run receipts are never overwritten. A missing preview-session acceptance assertion still fails the native run but does not prevent safe ordinary uninstall.

For an older attempt completed before automatic restoration was added, use only its exact prepared plan and completed raw run receipt that includes an actual normal-uninstall exit-code-0 record:

```powershell
node .trellis/tasks/10-10-mb-13-windows-acceptance/evidence/current-installer.mjs restore "<absolute prepared plan>" "<absolute completed run receipt>"
```

The same ownership, absence and conflict guards apply. This command does not invoke setup/uninstall and does not accept historical/daily installation residue. It preserves all data and writes an immutable raw cleanup receipt. A finished failed receipt without an actual uninstall record cannot authorize this restoration command.

If a failed fixture was normally closed and its test credentials revoked but teardown stopped before uninstall, wait until its owned processes/listeners are actually absent, then run:

```powershell
node .trellis/tasks/10-10-mb-13-windows-acceptance/evidence/current-installer.mjs recover "<absolute prepared plan>" "<absolute completed failed run receipt>"
```

`recover` verifies the exact run/marker/root, both absent preflights, original installed registration, recorded app closure and test-credential revocation control. It checks the installed exe and approved package hashes, current registration ownership and stopped fixture processes before snapshotting every app-data file's content hash and running only the exact installed `uninstall.exe /S`. It verifies program/uninstall-key absence, unchanged data, absent owned processes/listeners and free known ports. It writes a new actual recovery receipt, then passes that normal-uninstall receipt to the strict registry restoration guard. No driver/process kill or manual data removal occurs. The original failed native receipt and screenshots remain FAIL; the separate recovery result measures cleanup only.

When the original receipt records an app-close timeout with no exit-code observation, a cleanup-only recovery additionally requires the main session's adjacent `current-late-close-<short-runId>.json` as the fourth argument. It verifies the full runId, normal WM_CLOSE action, no forced termination, null observed exit code and both exact app/WebView2 PID absence again, including a previously observed WebView2 outside the root filter. Original main exit remains `UNVERIFIED`; no exit-code-0 claim is invented. This cannot upgrade native acceptance. The recovery receipt explicitly leaves earlier outside-fixture main-store impact `UNVERIFIED`; its data inventory contains only temporary app-data. Earlier main-page API marker writes are not described as absent.

For fresh runs, source selection explicitly confirms the expected “清除当前输入并切换” handoff and waits for the selected source. Chrome runs with `--disable-background-mode`; close queues `Browser.close` and ends the driver pipe. The current installed harness uses observation method 2 with a bounded 180-second window for a real exit-code-0 observation. V15 does not impose a Chrome exit-speed requirement; this is an observation limit after several native runs actually exited normally beyond the earlier 45-second watchdog. It does not relax app-close, restart, no-replay or cleanup assertions. Old timeouts remain failure evidence, and absence without an observed exit code cannot pass. Close receipts retain methodVersion, observationBudgetMs, actual elapsedMs, fixed phases/events, frame-write callback, acknowledgement/error code, EOF state, actual child exit/signal and fixture process observations. No forced termination is added.

To compare the immediate-EOF baseline with the acknowledgement-before-EOF hypothesis, run these separately under the already authorized disposable-fixture scope:

```powershell
node .trellis/tasks/10-10-mb-13-windows-acceptance/evidence/current-chrome-close-probe.mjs baseline
node .trellis/tasks/10-10-mb-13-windows-acceptance/evidence/current-chrome-close-probe.mjs after-ack
```

Each command creates its own fresh guarded root and loads only the unpacked extension/options page in its disposable `chrome-a`. No application, NSIS, pairing, credentials or bookmark-write commands run. In `after-ack` mode the driver keeps its pipe open until the close reply or an actually observed child exit, before requesting EOF. Both modes keep the same 45-second total close limit. A timeout records FAIL before pipe teardown; a later stopped-process observation is cleanup evidence only. The comparison is a transport hypothesis, not a presumed fix or a product acceptance result. No forced process termination or recursive data removal occurs.

If both unpaired modes exit normally, that does not explain the earlier paired two-Chrome timeout. A separate socket-order comparison uses these commands:

```powershell
node .trellis/tasks/10-10-mb-13-windows-acceptance/evidence/current-paired-chrome-close-probe.mjs bridge-open
node .trellis/tasks/10-10-mb-13-windows-acceptance/evidence/current-paired-chrome-close-probe.mjs app-first
```

Each creates a fresh guarded root, copies/scans the current release exe, verifies actual isolated main WebView data before pairing, and pairs only two disposable Chrome Profiles. It sends no bookmark-write commands and invokes no installer or registry mutation. Credentials use only the generated `Markbridge.Task06.close-<runId>` namespace; trusted main IPC revokes them and exact-target existence checks verify removal. Both modes retain the original Chrome close pipeline and explicitly select observation method 1's 45-second limit. `bridge-open` closes Chrome after revocation while the observed app listener remains open; `app-first` normally exits the copied app before closing Chrome. Receipts retain fixed bridge counts/listening state, close timing/transport facts and actual app/Chrome exits. Missing exits remain FAIL even if the final stopped-fixture check later succeeds. This diagnoses ordering only and cannot upgrade the original installed-package failure.

`node .trellis/tasks/10-10-mb-13-windows-acceptance/evidence/current-paired-chrome-close-probe.mjs live-paired` instead proves both Profiles live immediately before its first Browser.close and leaves the fixture credentials active through the close attempts. It verifies the selected target Profile remains live before each attempt. Revocation and exact-target absence checks run afterward in finally, followed by normal app exit and stopped-fixture checks. The original close pipeline and explicitly selected method 1's 45-second budget remain unchanged; transport or late-cleanup failures stay FAIL.

The same script's `live-get-tree` mode adds only the full harness's final read sequence: awaited `chrome.bookmarks.getTree()` in A, then B, followed by the same live/default close attempts. Its receipt stores two tree hashes, never tree/title/URL contents. It still performs no bookmark-write commands, does not add a target/session attachment and revokes credentials only afterward.

Its separate `live-aged` mode adds only 40 one-second timer waits after pairing, with fixed progress every ten ticks, before the same live/default close checks. It performs no getTree or bookmark writes and records the actual monotonic elapsed wait. This tests the lifetime delta while leaving the close budget at 45 seconds. It does not suspend the operating system or change the user's waived sleep acceptance.

`live-aged-concurrent` keeps that same wait, rechecks both Profiles live immediately before dispatch, and starts both ordinary Browser.close calls without awaiting the first exit. Each retains its own unchanged 45-second budget, transport facts and exit-code-0 requirement. Both failed requests and late exits remain independently recorded. Revocation happens only after both close attempts finish. This comparator does not establish that A can exit while B remains running, and cannot change any earlier native FAIL.

`node .trellis/tasks/10-10-mb-13-windows-acceptance/evidence/current-paired-chrome-close-probe.mjs live-aged-headful` uses the same sequential 40-second aged comparison with ordinary Chrome windows in the two new disposable Profiles. It omits only the headless flag and adds the fixed offscreen initial position `-32000,-32000`; all extension, pairing, EOF, 45-second close budget and exit assertions stay the same. It performs no bookmark writes or installation. This opt-in comparison leaves the default headless driver unchanged and preserves previous failed receipts.

`node .trellis/tasks/10-10-mb-13-windows-acceptance/evidence/current-paired-chrome-close-probe.mjs live-aged-observation` keeps the headless baseline, 40-second wait, sequential live checks and normal close request, and selects only method 2's 180-second observation window per Chrome. It requires the actual child exit code 0, trusted credential revocation afterward, normal app exit and absent fixture processes/listeners. It records the new method, limit and elapsed values separately. All older comparator modes explicitly keep 45 seconds and every old receipt remains unchanged. This can establish normal eventual exit under the new observation method; it cannot establish fast Chrome shutdown or upgrade an old FAIL.

The independent performance command `node .trellis/tasks/10-10-mb-13-windows-acceptance/evidence/current-performance-probe.mjs` uses a performance-only read-only startup observer. It observes static B10K DOM readiness and a following animation frame concurrently with the actual main OS-directory guard. The numeric candidate is captured before the listener-ownership PowerShell query, then accepted only after both proofs succeed: the exact generated loopback browser-debug endpoint, exact trusted main origin, listening PID owned by the copied application's direct WebView2 child, and that same child's existing exact main data directory. A failed proof discards the candidate and leaves milestone getters unpublished. IPC and input remain unavailable until those checks succeed. Five actual monotonic timestamps record valid CDP target discovery, connect start/end, heading readiness and the exact existing DOM candidate. The default startup/full harness still waits for the OS guard before CDP discovery. Cold samples include actual discovery/polling overhead, with no estimated subtraction or relaxed limit; older performance failures remain unchanged.

Preview probe jobs include both the expected path and a fresh page UUID. Every A/B/A open waits for a new expected-path hello since that open began, so a closing B page or an old A generation cannot consume A's job. Synthetic path/local/cookie snapshots are retained to distinguish a probe routing failure from actual session loss. Normal app close verifies the executable for the known PID and posts WM_CLOSE only to owned windows with the exact known main/preview titles, then requires app exit 0 and absence of every observed direct WebView2 PID. Other windows are inspected without messages, including visible toolkit/WebView windows; it does not pick the first visible window or force-kill a process.

Before rebuilding a full installer acceptance after a startup-isolation fix, run a separate startup-only check:

```powershell
node .trellis/tasks/10-10-mb-13-windows-acceptance/evidence/current-startup-probe.mjs
```

This scans and copies the current release exe into a new guarded temporary `install` directory without invoking NSIS or touching registration. It reports actual main-process data-directory evidence before automation interaction, then normally closes the application. It performs no pairing, input actions, model calls or preview navigation. The copied-release startup receipt is separate from actual installed-package acceptance and does not replace it.

The default copied startup probe and full installer acceptance do not enable or require temporary stage markers. During shutdown diagnosis, use `node .trellis/tasks/10-10-mb-13-windows-acceptance/evidence/current-startup-probe.mjs --stages` only with a build that includes the temporary marker instrumentation. This explicit option sets `MARKBRIDGE_NATIVE_PROBE=1` only in that child environment. It drains stderr and retains only the exact `TASK13_NATIVE_STAGE:<TOKEN>` wire format and thirteen fixed stage tokens, once each in observed order. Every other line is discarded. This diagnostic mode requires `RUN_READY` before returning startup readiness and before posting WM_CLOSE; an absent ready event records an unperformed-close timeout and preserves the fixture for investigation. Failure receipts in both modes retain the exact close error code, phase, bounded owned-window observations, known WebView2 PIDs and actually observed child exit/signal. They never turn a missing exit observation into exit 0.

To inspect a surviving fixture without posting any message, provide its recorded PID and exact guarded executable/root:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .trellis/tasks/10-10-mb-13-windows-acceptance/evidence/current-native-window.ps1 -Action inspect -TargetProcessId <recorded-app-PID> -ExpectedExecutable '<fresh-root>\install\markbridge-desktop.exe' -IsolationRoot '<fresh-root>' -MainTitle 'Markbridge · 签桥' -PreviewTitle 'Markbridge 网页预览'
```

The helper verifies the known process executable first, then reports only its owned top-level/message-only window handles, thread IDs, visibility, fixed main/preview/other roles, empty-title booleans and bounded native class names containing only ASCII letters/digits, underscores, dots or hyphens. The two exact toolkit classes `Tao Thread Event Target` and `Tao Window` map to the fixed labels `TAO_THREAD_EVENT_TARGET` and `TAO_WINDOW`; other space-containing names remain unreported. It emits no title text or outside-fixture paths. Close eligibility requires an exact known main/preview title and excludes every message-only or other-role window. If a process remains with zero eligible windows, further WM_CLOSE posts cannot establish normal exit; retain that state and investigate the application's shutdown stage.

This harness does not claim actual-model quality, Floccus propagation, macOS/Linux, B10K performance or sleep execution. Real-model checks are `NOT_RUN`, Floccus is `UNVERIFIED`, and sleep records the user's `WAIVED` decision with execution `NOT_RUN`. Other gates use their separate current or explicitly scoped historical evidence.
