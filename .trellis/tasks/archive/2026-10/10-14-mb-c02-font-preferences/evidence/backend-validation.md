# C02 backend and protocol validation — 2026-10-14

Scope: installed-font command, Windows local DirectWrite metadata, Rust DTO generation and frontend IPC adapter. Existing C01 and concurrent frontend edits were preserved. No commit, installer, font installation, daily Chrome access or task-state mutation was performed by this worker.

Source base is `100010394c4891434efed395d02ccf28aff49eba` plus the scoped file SHA256 inventory in [backend-source.json](backend-source.json). The final census assertion was rerun successfully at 2026-10-14 15:05 UTC. Native release executable identity belongs to the main harness receipt, not these debug tests.

## Implementation

- `fonts.rs` calls DirectWrite Factory3 with `includeDownloadableFonts=false` and `checkForUpdates=true`, on a blocking worker after the exact main-window trust guard.
- Canonical en-US / display zh-CN preference, bounded UTF-16 allocation, 256-scalar/control validation, 10,000-family raw collection limit, Windows ordinal case-insensitive deduplication.
- Rust Serde/Schemars DTO → generated TypeScript/JSON Schema/CSP-safe Ajv validator → lazy validated `listInstalledFonts()` adapter. No protocol-version, extension-message or database migration.
- Only the already-locked `windows 0.62.2` dependency was added to the Windows desktop target. Cargo.lock changes by one desktop dependency entry; no package versions changed.
- New command is registered and asserted by the existing caller-guard inventory test. No capability or CSP changes.

## Executed checks

| Command | Result |
|---|---|
| `cargo test -p markbridge-desktop installed_font_catalog_native_smoke -- --ignored --nocapture` | PASS, 1 real Windows metadata probe |
| `cargo test -p markbridge-desktop font_catalog_gdi_census -- --ignored --nocapture` | PASS, 1 real Windows metadata comparison; counts below |
| `pnpm protocol:generate` | PASS, generated four new catalog files |
| `pnpm protocol:check` | PASS, generated artifacts match Rust |
| `pnpm exec vitest run packages/protocol/src/ui-fonts.test.ts apps/desktop/src/backend-fonts.test.tsx` | PASS, 5 tests in 2 files |
| `cargo test --locked -p markbridge-protocol -p markbridge-desktop` | PASS, desktop 35 + protocol 16; 2 explicit native probes ignored in this normal suite and separately run above |
| `cargo clippy --locked -p markbridge-desktop -p markbridge-protocol --all-targets -- -D warnings` | PASS |
| `cargo fmt --all -- --check` | PASS |
| `git diff --check` | PASS |
| `cargo build --locked -p markbridge-core --example seed_profile_cache --target x86_64-pc-windows-msvc` | PASS, unchanged isolated native-fixture helper |

All commands above exited 0. Raw `rtk proxy` execution was used for command output. Whole-workspace frontend lint/typecheck/build/tests are owned by the frontend worker/main and recorded separately.

The seed helper is `target/x86_64-pc-windows-msvc/debug/examples/seed_profile_cache.exe`, SHA256 `87f724db424992401b2be189eef8ae8cb9a5b4cc0e7f109eaea9f8eb7adfa41c`. Building it did not run it or mutate any profile. Main owns its isolated execution.

## Native metadata evidence

DirectWrite returned **302 raw families / 302 unique families**. Explicit bounded samples:

| Canonical family | Display name |
|---|---|
| Arial | Arial |
| Microsoft YaHei | 微软雅黑 |
| Microsoft YaHei UI | Microsoft YaHei UI |
| SimSun | 宋体 |
| Segoe UI | Segoe UI |

The independent read-only `System.Drawing.Text.InstalledFontCollection` census returned **753 raw / 752 unique Windows-ordinal names**. Comparing canonical/display names initially found **477** GDI-only names. All **477** mapped to DirectWrite per-face `WIN32_FAMILY_NAMES` metadata, allowing GDI's 31 UTF-16-unit truncation; **0 unresolved**. This is family/legacy-alias grouping, not an omitted local font catalog. Bounded examples: GDI `Anthropic Mono Web Extrabold`, `Light`, `Medium`, and `Semibold` map to the single `Anthropic Mono Web` family; `Anthropic Sans Web Display Ligh` maps to the full `Anthropic Sans Web Display Light` name. These are user-installed metadata observations, not bundled assets or application defaults.

The GDI comparison holds both catalogs in memory and emits only counts plus bounded samples. It does not persist or print either complete catalog. Runtime-dependent probes are intentionally ignored by the ordinary test command.

## Remaining acceptance boundaries

The metadata probes are actual Windows enumeration, but are not proof of WebView glyph selection, trusted/remote-window IPC behavior, restart persistence, or DPI/layout acceptance. Main owns the fresh release build and isolated native harness for those checks. Non-Windows native behavior remains NOT_RUN; no macOS/Linux support claim is added.
