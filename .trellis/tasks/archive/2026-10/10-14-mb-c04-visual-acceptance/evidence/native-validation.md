# C04 current Windows integration

The current copied executable passed all **13 native controls**, with **42 screenshots** and **8 actual monitor-DPI cases**. Raw result: [run-1791992355705-19b666c5/result.json](native/run-1791992355705-19b666c5/result.json). Command `node .trellis/tasks/10-14-mb-c04-visual-acceptance/evidence/native-integration.mjs` exited 0.

## Identity and isolation

- `pnpm build:native` exited 0; [build log](native-build.log). Executable SHA256 `8c1f59be4ea553b32e0eed1df3f167e0cfd19c7136b1b31734c3254317c56bbc`, 25,627,648 bytes. It was copied into a newly created OS temporary fixture, without installation.
- Comparable production source fingerprint `e199c0aa19a0e3560f398831d5a0297ce532ff443be706767f009770d3f69311` stayed unchanged before/after build. [Build-time manifest](pre-build-source.json) additionally binds root Cargo/config/test inputs with complete fingerprint `9c45b89fc6f234119f5758c1a0f5f8bbbac480fe6669e92f6e228c35a18ac3c4`.
- Windows 11 Pro / WebView `Edg/155.0.4283.45`. Rust seeded 122 synthetic nodes into the isolated app store. Main WebView ownership/data-directory guards passed. No daily Chrome, installed extension, font installation/removal, installer, signing or publication was used.
- First PID **124380** exited 0; fresh PID **117400** reopened the same isolated data and also exited 0. Known WebView identities became absent; final owned process/listener arrays are empty.

## Native results

| Area | Current evidence |
|---|---|
| General and enumeration | Ordinary Settings opens General without a font command or storage write. Explicit main IPC returns 302 local DirectWrite families; Arial, Microsoft YaHei UI and SimSun agree with the unchanged C02 metadata cross-check. |
| Actual rendering | CDP `CSS.getPlatformFontsForNode` records Arial Latin glyphs and Chinese fallback to YaHei; selected YaHei renders both samples. Candidate/cancel leave global font and storage unchanged; apply and trigger focus pass. |
| Font and row metrics | At12/14/20px, native folder rows40/40/48 and bookmark rows52/56/76. Hidden-list middle anchor retains index/offset within1 CSSpx, bottom row and checkbox remain reachable, and unsaved notes/selection survive. |
| Actual monitor DPI | OS `GetDpiForWindow`144/120 matches WebView DPR1.5/1.25 and physical client pixels. Each scale covers light/dark at1100×760 and640×480 CSSpx, with20px installed YaHei. General reset, font-picker apply/cancel, library76px row and draft-confirmation controls are measured and reachable. No OS scaling setting or simulated DPI was used. |
| Side effects and permissions | Request-path observer calibrated with `get_bridge_state`. Appearance interactions contain no unexpected model/fetch/index/Chrome write calls and zero remote font requests. All81 registered commands, including the font command, are denied in a real independent remote preview. |
| History and export | Actual history→backup-export portal opens the OS Save dialog. Cancel produces the truthful canceled receipt; no export file is created. |
| Restart and storage | New PID restores dark/installed YaHei/20px and actual YaHei glyphs. Reset only changes v2. Legacy system/yahei/song fixtures preserve v1 bytes and exact12/13/15px without startup writes. A synthetic missing family remains saved, shows a missing notice only after successful enumeration and renders actual local fallback glyphs. |

The two e2e measurement/synchronization fixes made after the native build change only tests. [Final source manifest](final-source.json) records that later test state; the production fingerprint and executable remain identical. Browser evidence and native evidence retain their own original source identities.

## Retained failed attempt

[First attempt](native/run-1791992232007-8daa54be/result.json) passed its first five controls, then timed out trying to fill a search input hidden by the640×480 detail replacement view. The harness was corrected to click the existing “关闭详情，返回列表” control before changing the search query. The product was not changed. The first fixture exited normally with no owned process/listener remaining; its FAIL receipt and screenshots are retained. The second complete run above passed.

## Limits

This proves the current executable, not the identity of the user's older attached screenshot. That older executable identity remains UNVERIFIED. Browser simulations of failure/empty catalogs and business states are recorded separately. B10K performance has its own fresh-process receipt. Original task13/V12, task15/V18, non-Windows support and historical sleep evidence are unchanged.
