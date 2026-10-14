# Local appearance preferences

## 1. Scope / trigger

`apps/desktop/src/features/settings/ui-preferences.ts` owns pure visual preferences for the trusted main WebView. LocalStorage integration requires an explicit storage contract. `App` owns one preference state; `GeneralSettings` consumes values and a change callback. No SQLite, Rust command, protocol field, remote font request or permission is added. Remote preview windows and extension pages do not consume this module.

## 2. Signatures

```ts
type UiPreferences = {
  version: 1;
  theme: 'system' | 'light' | 'dark';
  font: 'system' | 'yahei' | 'song';
  fontSize: 'small' | 'standard' | 'large';
};
parseUiPreferences(raw: string | null): UiPreferences;
readUiPreferences(storage?: Pick<Storage, 'getItem'>): UiPreferences;
saveUiPreferences(value: UiPreferences, storage?: Pick<Storage, 'setItem'>): boolean;
applyUiPreferences(value: UiPreferences, darkSystem: boolean, root?: HTMLElement): void;
```

## 3. Contracts

The sole key is `markbridge.ui-preferences.v1`. Default record: `{"version":1,"theme":"system","font":"system","fontSize":"standard"}`. Parsing accepts only the listed enums and returns a fresh normalized object. Reads and startup application never write or delete storage, including unknown versions. Save only after explicit selection or restoring default appearance, and affect only this key.

`main.tsx` reads and applies preferences before `createRoot().render`, passing the same initial values to `App`. Application sets `data-theme` to resolved light/dark, `data-font`, `data-font-size` and bounded CSS variables. For system mode, subscribe to `matchMedia('(prefers-color-scheme: dark)')` changes with cleanup; fixed themes ignore media changes. Changing settings applies in this session even if storage fails. Do not display saved success on a failed write.

Font presets use local fallbacks: system prefers Segoe UI/微软雅黑, yahei prefers 微软雅黑, song prefers Times New Roman/SimSun. Missing fonts fall back without scanning or downloading. Controls inherit the selected family; code/ports retain their monospace role.

`appearanceSizes` is the single geometry source. Apply its text/control CSS variables; `RowHeightsContext` distributes its folder/bookmark heights to `VirtualRows`, whose inline CSS top/height and spacer arithmetic use those same values. Do not introduce unused mirror variables or maintain independent CSS and JS scales.

| Size | Body px | Folder row px | Bookmark row px | Control minimum px |
|---|---:|---:|---:|---:|
| small | 12 | 40 | 48 | 40 |
| standard | 13 | 40 | 52 | 40 |
| large | 15 | 48 | 60 | 44 |

Font roles change with this scale, including auxiliary text, titles and inputs. Use neither CSS zoom nor transform scaling. Preserve the visible virtual-row anchor across typography changes, including while the library is hidden. If the visible list was already at its scroll bottom, preserve that bottom instead so increasing row height cannot hide the last item. Determine bottom proximity with `Math.abs(scrollHeight - clientHeight - scrollTop) <= 1`; actual Windows DPI can produce fractional CSS scroll positions. Hidden zero-height measurements must not replace the stored anchor or bottom state. Actual keyboard navigation must still reveal its active row. Keep query, source, selection and drafts mounted.

## 4. Validation & error matrix

| Input / failure | Behavior |
|---|---|
| Missing key, invalid JSON, non-object or missing version | Defaults; no startup write or crash |
| Version 1 with invalid/missing enum field | Default that field; retain valid fields |
| Unknown version | Defaults; preserve original stored string until an explicit user change |
| `getItem` throws or storage unavailable | Defaults; application starts |
| `setItem` throws | Return false; apply session values; show `当前外观已应用，但未能保存。重启后可能恢复默认。` |
| Restore default appearance | Save the default record to this key only; preserve bookmarks and AI/semantic settings |

## 5. Good / base / bad cases

- Good: dark/song/large reloads in the same isolated main WebView data directory with matching controls, text and row geometry.
- Base: no record starts system/system/standard without persisting a synthetic default.
- Bad: `font: 'url(...)'` never enters CSS; unknown version 2 is not overwritten on startup; storage failure never reports durable success.

## 6. Tests required

`features/settings/ui-preferences.test.tsx` and `App.test.tsx` cover normalization, all invalid inputs, preserved unknown-version record, denied read/write and cleanup of system listeners. `tests/e2e/appearance.spec.ts` asserts ordinary Settings opens General while existing shortcuts target their categories; all three fields change actual computed styles, explicit theme ignores emulated media changes and reset affects only appearance. Verify no implicit model/fetch/index/browser mutations.

Virtual-row regressions must scroll away from the previous active row, change size in General and return to the same visible item/offset. Separately, navigate to the last item, confirm any dirty-draft discard, change standard/large size through hidden settings, and assert the last item remains visible and the list remains at its bottom; cover both 24 and 120 rows. Also check keyboard reveal, checkbox focus and retained drafts. Native scroll comparisons use a 1 CSS px tolerance rather than exact integer equality. Cover six CSS viewports, large at640×480, both palettes and relevant disabled/error/confirmation states with measured contrast. Native receipts separately prove real process exit/restart persistence and owned-window actual125/150%DPI, with executable hash, OS DPI, WebView ratio, dimensions and isolated paths. Emulated media/process scaling is labelled and cannot replace actual monitor DPI evidence.

## 7. Wrong vs correct

Wrong: write defaults in a render/effect, accept arbitrary stored strings as CSS, change only root font size while fixed px rows stay unchanged, or reveal the old active row when restoring a hidden resized list.

Correct: read/normalize before rendering, save only explicit changes, apply bounded semantic tokens and the shared geometry mapping, retain the user's visible scroll anchor, and use keyboard navigation as the deliberate active-row reveal trigger.
