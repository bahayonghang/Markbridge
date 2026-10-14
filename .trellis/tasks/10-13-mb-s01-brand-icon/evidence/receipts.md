# S01 implementation receipts

Date: 2026-10-13 (America/New_York). Product scope is the approved S01 icon
integration. No commit, archive, installer, signing or publication was performed.

## Assets and visual review

Root generated A, B and refined A using built-in image_gen and selected refined
A after showing the candidates. See `../assets/generation.json`,
`icon-comparison.html`, `icon-comparison.png` and `root-visual-review.md`.
The HTML comparison renders all three at 16/24/32/48/128/256 CSS pixels on
white and #171B22 backgrounds without image filters or recoloring.

`assets/brand/markbridge-master.png` is byte-identical to selected-a.png:
1254×1254 RGBA, alpha 0–255, SHA-256
`26ee24eb8b7763c26d74572304f8033ebcc5405e253fd14767d65598cce16e5b`.
The selected raster uses a flat blue/white visual treatment with antialiasing;
no exact mathematical two- or three-color pixel count is claimed.

`export-icons.py` uses the installed Tauri CLI in a task-local temporary output
directory and retains only Windows PNG/ICO. Pillow only resizes the unchanged
master for the local 128px Vite image and extension 16/32/48/128 PNGs. No artwork
was drawn, recolored or cleaned with Python. A sandbox temp-output failure was
resolved by using the planned task-local temporary directory.

`inspect-icons.py` and `asset-inspection.json` record dimensions, hashes,
transparency and ICO frames. Final transparent corners are zero; 16px resampling
has at most alpha 3 at an edge from antialiasing, without a visible matte.
The extension manifest is identical to HEAD after removing only `icons` and
`action.default_icon`; permissions, CSP, popup, options and worker are unchanged.
The production asset scanner already accepts these PNGs, so it was not modified.

## Current checks

| Check | Result | Evidence |
|---|---|---|
| Asset alpha/dimensions/ICO/manifest references | PASS | asset-inspection.json |
| A/B and refined A small-size review | PASS | icon-comparison.png, root-visual-review.md |
| pnpm lint | PASS, exit 0 | lint.log |
| pnpm typecheck | PASS, exit 0 | typecheck.log |
| pnpm test | PASS, exit 0; 217 Vitest + 21 Node tests | test.log |
| pnpm build | PASS, exit 0; production scan passed | build.log |
| pnpm exec playwright test tests/e2e/shell.spec.ts | PASS, exit 0; 12 tests | browser-shell.log, browser-shell/ |
| pnpm build:native | PASS, exit 0; remapped artifact scan passed | build-native.log |
| git diff --check | PASS, exit 0 | command result; CRLF conversion warnings only |
| New exe/native titlebar/sidebar/taskbar/temporary Chrome extension | PASS after visual review | native/run-1791949706426-73a68df7/ |

The initial sandbox test failed because Vitest's worker cache and Rust fixture
files under sandbox TEMP were unavailable (`test-sandbox.log`). An initial
sandbox browser run stalled before tests and was interrupted
(`browser-shell-sandbox.log`). The current unsandboxed reruns passed; the failed
attempts are preserved. Ordinary build/lint/typecheck and asset comparison ran
in the workspace sandbox. Rust/native and the browser reruns used the approved
task-isolated escalation.

Pinned pnpm 12.12.0 was invoked from this existing cached executable directory,
prepended to PATH for each command so nested scripts use the same version:

```text
C:\Users\lyh\AppData\Local\pnpm\package-manager-store\v11\links\@pnpm\exe.win32-x64\12.12.0\97591cf70181dc9a82d65ec409f03f2a987b90ee8de786cb970420ee5d7dd719\node_modules\@pnpm\exe.win32-x64\pnpm.exe
```

The Scoop 12.13.0 shim stalled while switching versions; it was interrupted.
No package-manager version, lockfile or project configuration was changed.
Playwright used the installed browser cache via a command-local
`PLAYWRIGHT_BROWSERS_PATH=C:\Users\lyh\AppData\Local\ms-playwright`.

## Native evidence

Final run: `run-1791949706426-73a68df7`, Windows 11 Pro 10.0.26300,
WebView2 Edg/155.0.4283.45, Chrome/155.0.8059.39. Executable:
`target/x86_64-pc-windows-msvc/release/markbridge-desktop.exe`, 25,361,920 bytes,
SHA-256 `ef06b936da825542c990bbb2125f620075172992ac25d4e680bd58adb663b41e`.

The guarded existing task13 driver requires its historical temporary prefix and
`install` subdirectory. This run copies the portable exe there; it does not run
an installer, register a product, or create a shortcut:

```text
root:    C:\Users\lyh\AppData\Local\Temp\markbridge-task13-native-s01-Q9Ztbw
exe:     <root>\install\markbridge-desktop.exe
data:    <root>\app-data
Chrome:  <root>\chrome-a
```

Native ownership checks bind the app PID to that exact copied executable and
confirm WebView storage under `<root>\app-data\main-webview`. No pairing, bridge
listener or credentials were created. The native helper observes the owned
window and the exact owned title's taskbar button only. Client 1375×950 physical,
GetDpiForWindow 120, WebView viewport 1100×760 CSS, devicePixelRatio 1.25.
Titlebar, sidebar, taskbar and Chrome extension card show the same brand.
All four Chrome icon resources decode with the declared sizes and match
repository SHA-256 values. Actual Chrome is headless; its extension card is the
observed surface, not a pinned action toolbar. See the final run's visual review.

Three prior native runs remain preserved. The first failed on the test helper's
PowerShell5 title encoding; the second on an unnecessarily required optional
large WM_GETICON handle. The third was rejected by visual review because its
taskbar selector matched File Explorer. The final helper passes the title as a
Unicode argument, emits UTF-8, handles the absent optional large icon honestly,
uses physical DPI-aware geometry, and matches the exact app title. Every attempt
closed owned processes normally; the final run records Chrome/app exit 0 and
empty process/listener lists. Temporary data is retained for evidence, not
recursively deleted or installed into the daily environment.

S01 is ready for independent Trellis review. The original model gates V12/V18
and other task acceptance states are unaffected.
