# Installed UI font catalog

## 1. Scope and trigger

C02 adds a read-only Windows font-family catalog for the trusted main window. The frontend requests it only when opening or explicitly refreshing the font picker; ordinary startup/settings rendering does not enumerate. This catalog does not change the extension wire protocol, SQLite, fonts, files or system settings.

## 2. Signatures

`list_installed_fonts(window: WebviewWindow) -> Result<InstalledFontCatalog, ErrorCode>` has no caller arguments. `trusted(&window)?` runs before `spawn_blocking(fonts::installed_fonts)`. The worker creates, uses and drops all DirectWrite objects, returning only owned DTO strings. Frontend `backend.listInstalledFonts()` validates unknown IPC through the lazy `@markbridge/protocol/ui-fonts` parser.

## 3. Contract

- `IDWriteFactory3::GetSystemFontCollection(false, ..., true)` excludes downloadable fonts and refreshes the local collection. No font download queue, custom font loader or font-file API is used.
- A ready reply contains only `{status: 'ready', families: [{family, displayName}]}`. Canonical family prefers en-US, otherwise the first name; display prefers zh-CN, otherwise the canonical name.
- Names are nonempty, at most 256 Unicode scalars, and contain no control characters or malformed Unicode. Bound the UTF-16 allocation before reading. The raw collection cannot exceed 10,000 families; never silently truncate it.
- Sort/deduplicate by Windows ordinal case-insensitive comparison. Return font families, not a separate option for each weight/style. GDI family counts can differ because GDI includes legacy per-face family aliases and truncates some names to 31 UTF-16 units.
- Frontend display sorting, session-only caching, single-flight requests, candidate selection and stale-result rejection remain frontend responsibilities. Neither the command nor its adapter persists the catalog.
- Font paths, bytes, loader handles and raw native errors never cross IPC or enter logs. There is no telemetry or filesystem capability expansion. Existing preview capabilities remain unchanged.

## 4. Validation and errors

| Case | Outcome |
|---|---|
| Caller label is not exactly main | `READ_ONLY` before enumeration |
| Native collection/read/UTF-16 failure or blocking-worker join failure | `unavailable / enumeration_failed` |
| More than 10,000 raw families or a name over 256 scalars | `unavailable / catalog_limit`; no partial catalog |
| Non-Windows build | `unavailable / unsupported_platform`; not native platform acceptance |
| Empty valid collection | `ready` with an empty list |
| Extra path/byte fields, invalid bounds/status or malformed Unicode | Serde/generated Ajv boundary rejects the DTO |

`crates/protocol/src/ui_fonts.rs` owns the DTO and schema bounds. `scripts/protocol.mjs` and `export-schema` register its generated schema/declarations/standalone validator. Do not hand-edit generated output or replace validation with type assertions.

## 5. Good / base / bad

Good: explicitly open the picker, receive localized family names, preview one candidate, and apply it after the user's action. Base: failed enumeration leaves the current font and preferences untouched. Bad: infer missing fonts from a failed directory read, return font paths, include downloadable entries, or list every bold/italic face as a new family.

## 6. Required checks

Rust tests cover bounded metadata, stable failure variants and Windows ordinal deduplication. Protocol tests cover additional fields, scalar bounds, broken Unicode and catalog limits; adapter tests assert the exact no-argument command and unknown-response validation. The existing registered-command guard test explicitly includes `list_installed_fonts`.

`fonts::tests::installed_font_catalog_native_smoke` and `font_catalog_gdi_census` are explicit ignored-by-default Windows probes; they print only counts and bounded samples. Real main-window IPC, rendered glyph mapping, preview denial, and restart evidence are separate task acceptance checks. Mock lists or `document.fonts.check()` do not establish those facts.

## 7. Wrong / correct

Wrong: use a hand-maintained font list or equate a CSS stack with a verified rendered font. Correct: enumerate installed local families through the trusted native service, validate the DTO, and use native WebView platform-font evidence for actual rendering.
