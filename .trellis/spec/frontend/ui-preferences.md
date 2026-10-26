# Local appearance and installed fonts

## Scope and ownership

`apps/desktop/src/features/settings/ui-preferences.ts` owns pure visual preferences for the trusted main WebView. App owns one preference state; GeneralSettings consumes it and owns a session-only font catalog cache. Rust enumerates the Windows font collection through the main-only `list_installed_fonts` command; `backend.ts` validates its generated DTO. No font directory, path, font bytes, network font, SQLite migration, extension message or widened preview capability is involved. Remote previews, extension pages and OS dialogs do not inherit these preferences.

## Preference contract

```ts
type UiFont = { kind: 'preset'; value: 'system' | 'yahei' | 'song' } | { kind: 'installed'; family: string };
type UiPreferences = { version: 2; theme: 'system' | 'light' | 'dark'; font: UiFont; fontSizePx: number };
parseUiPreferences(raw: string | null): UiPreferences;
readUiPreferences(storage?: Pick<Storage, 'getItem'>): UiPreferences;
saveUiPreferences(value: UiPreferences, storage?: Pick<Storage, 'setItem'>): boolean;
fontFamilyCss(font: UiFont): string;
resolveAppearanceMetrics(fontSizePx: number): AppearanceMetrics;
applyUiPreferences(value: UiPreferences, darkSystem: boolean, root?: HTMLElement): void;
```

Read `markbridge.ui-preferences.v2` first. Only when that key is absent, read `markbridge.ui-preferences.v1` and migrate in memory: preserve theme and preset font, map small/standard/large to 12/13/15px. New users and reset use system theme, system preset, 14px. Invalid or unknown v2 uses defaults without reading v1 or overwriting either record. Invalid fields default independently; unknown fields are dropped from the normalized in-memory value. An installed family is nonblank, at most256 Unicode scalars, with no controls or unpaired surrogates. Size must be an integer12..20.

`main.tsx` reads and applies before React render. Startup, media changes and enumeration never save. Explicit theme selection, font application, valid size commit and reset write only v2. v1 remains byte-for-byte unchanged for code rollback; old code cannot see newer v2 changes. Storage failures keep the session value and the existing truthful save-failure alert. Reset also clears an invalid size input draft, even if the active size already equals14.

Installed family is escaped as one single-quoted CSS string, with backslashes and quotes escaped, followed by a fixed local system fallback. It is never a stylesheet, selector, URL or unquoted family list. Apply saved values synchronously without waiting for enumeration. Only a successful catalog can establish that the saved family is missing; failure cannot. Missing families remain saved and use fallback until reinstalled. Code/ports retain their monospace role.

## Picker and catalog lifecycle

`createFontCatalogSession` is owned by the mounted GeneralSettings instance, not a module singleton. No settings-entry enumeration occurs. Opening the picker reads/cache-hits; refresh explicitly invokes a new census. Concurrent reads share one physical IPC. Closing invalidates UI and cache updates; reopening during an old request waits for it to settle, then obtains a fresh census. Queued consumers share a generation-bound promise and closing that generation prevents new closed-picker work. React StrictMode effect replay retains the same physical request; deferred release checks whether any consumer remains before invalidating.

The modal uses native dialog focus containment and returns focus to the trigger on cancel/Escape/apply. Presets are separate from installed families. Sort installed families by localized display name then canonical family; search both. List names stay in the current stable UI font; only the selected candidate sample uses its font. Candidates never write preferences or change global appearance. Apply is explicit. Refresh preserves the query and candidate; missing installed candidates cannot be applied. Failure, unsupported platform, catalog bound, empty and no matches have distinct stable copy. A1000-entry catalog keeps bounded DOM using VirtualRows; row IDs use fixture-independent index keys rather than raw family names.

## Shared typography and geometry

The pure metrics function is the only text/row/control calculation. With n an integer12..20:

- body n; caption max(12,n-2); list title n+1; section n+2; page heading n+6.
- folder row and control minimum: max(40,ceilTo4(1.6*n+16)).
- bookmark row: max(48,ceilTo4(1.6*(n+1)+1.5*max(12,n-2)+12)).

| Body | Folder | Bookmark | Control |
|---|---:|---:|---:|
|12|40|52|40|
|14|40|56|40|
|20|48|76|48|

Root typography CSS variables and RowHeightsContext consume the same result. CSS does not maintain separate rem scale ratios. Library title/caption line heights follow1.6/1.5. Header uses min-height and padding; status text may grow. No zoom, transform text scaling, or per-bookmark measurement. Captions never fall below12px. The airy-glass colors and semantic interaction states follow root DESIGN.md. Paper material never changes the shared typography/row geometry; dark mode is a project adaptation.

VirtualRows preserves visible row/pixel anchor during geometry changes, including hidden library panels; a list already at bottom stays at bottom. Use a1 CSSpx fractional scroll tolerance. Hidden zero-size measurement cannot replace remembered state. Actual keyboard navigation reveals its new active row. Preserve checkbox focus, query, selection and drafts. Font-picker row geometry reuses the same bookmark metric.

## Required checks and evidence

Unit tests cover all12..20 values, exact boundary formula, all legacy presets and sizes, malformed/unknown records, Unicode validation, CSS escaping, read/write denial, key isolation, system-media cleanup, single-flight cancellation/queued-close/StrictMode and invalid draft reset. Browser tests cover keyboard/focus, preview/apply/cancel, refresh/empty/failure/missing recovery,1000-family bounded DOM, read-only migration, theme changes, actual computed colors, six required viewports plus2549x1356,12/14/20px and20px640x480. Keep24/120-row hidden anchors/bottom/drafts/checkbox regressions.

A mock font name does not establish local installation or actual glyph rendering. Native evidence separately proves real DirectWrite CJK/Latin families, platform-font glyph mapping, current executable process restart, main/preview denial, calibrated IPC side effects and actual125/150%DPI. Never substitute document.fonts.check or computed CSS stack for actual font mapping. C02/C04 established this contract; current airy-glass acceptance is recorded in G03 native and independent-check receipts. Historical S03/C02/C04 evidence is not current-product proof.
