---
version: alpha
name: 轻盈毛玻璃
description: "轻盈毛玻璃 is airy frosted glass: a light field, white paper, and two semantic colors, one for input and one for output, in a colourway picked for the project."
colors:
  field-start: "#E8F3FF"
  field-end: "#E5F3E7"
  blob-start: "#D2E7FE"
  blob-end: "#CAE5CE"
  blob-mid: "#D6EDEE"
  sheet: "rgba(255,255,255,0.62)"
  sheet-solid: "rgba(255,255,255,0.96)"
  sheet-edge: "rgba(255,255,255,0.70)"
  overlay: "rgba(255,255,255,0.82)"
  well: "rgba(36,48,58,0.04)"
  control-fill: "rgba(36,48,58,0.08)"
  control-edge: "rgba(36,48,58,0.54)"
  on-input: "#FFFFFF"
  ink: "#24303A"
  muted: "#5C6B76"
  input: "#1F6CB0"
  input-wash: "#EBF5FF"
  output: "#317A45"
  output-wash: "#EBF8EC"
  field-start-dark: "#121A22"
  field-end-dark: "#0B1F10"
  blob-start-dark: "#1B2B3C"
  blob-end-dark: "#053616"
  blob-mid-dark: "#06292B"
  sheet-dark: "rgba(28,37,48,0.60)"
  sheet-solid-dark: "rgba(28,37,48,0.96)"
  sheet-edge-dark: "rgba(255,255,255,0.08)"
  overlay-dark: "rgba(30,40,52,0.84)"
  well-dark: "rgba(231,237,243,0.04)"
  control-fill-dark: "rgba(231,237,243,0.08)"
  control-edge-dark: "rgba(255,255,255,0.36)"
  on-input-dark: "#1C2530"
  ink-dark: "#E7EDF3"
  muted-dark: "#A3AFBD"
  input-dark: "#82C0FF"
  input-wash-dark: "#233242"
  output-dark: "#7CD18F"
  output-wash-dark: "#233527"
typography:
  display-num:
    fontFamily: 'Figtree, "PingFang SC", "Noto Sans SC", sans-serif'
    fontSize: 32px
    fontWeight: 700
    letterSpacing: -0.02em
    fontVariantNumeric: tabular-nums
  title:
    fontFamily: 'Figtree, "PingFang SC", "Noto Sans SC", sans-serif'
    fontSize: 16px
    fontWeight: 650
    letterSpacing: 0
  body:
    fontFamily: 'Figtree, "PingFang SC", "Noto Sans SC", sans-serif'
    fontSize: 14px
    fontWeight: 400
    lineHeight: 1.7
    letterSpacing: 0
  meta:
    fontFamily: 'Figtree, "PingFang SC", "Noto Sans SC", sans-serif'
    fontSize: 12px
    fontWeight: 400
    letterSpacing: 0
rounded:
  check: 4px
  control: 12px
  image: 12px
  well: 16px
  sheet: 20px
  pill: 999px
spacing:
  min: 8px
  sm: 12px
  md: 16px
  lg: 24px
  xl: 32px
  xxl: 48px
material:
  field-angle: 160deg
  blob-opacity: 0.70
  blob-fade: 70%
  blob-max: 3
  overlay-blur: 20px
  overlay-blur-min: 16px
  overlay-blur-max: 24px
  overlay-saturate: 1.15
  backdrop-max: 6
elevation:
  sheet-highlight: "inset 0 1px 0 rgba(255,255,255,0.55)"
  sheet-shadow: "0 12px 40px -16px rgba(30,60,90,0.14)"
  overlay-highlight: "inset 0 1px 0 rgba(255,255,255,0.65)"
  overlay-shadow: "0 24px 64px -24px rgba(30,60,90,0.22)"
  sheet-highlight-dark: "inset 0 1px 0 rgba(255,255,255,0.06)"
  sheet-shadow-dark: "0 12px 40px -16px rgba(0,0,0,0.45)"
  overlay-highlight-dark: "inset 0 1px 0 rgba(255,255,255,0.08)"
  overlay-shadow-dark: "0 24px 64px -24px rgba(0,0,0,0.60)"
motion:
  press-scale: 0.98
  press-duration: 120ms
---
<!-- design-atlas: entry=style:airy-glass; source=first-party; license=MIT -->
<!-- palette: sky; reason: explicit --palette sky -->
<!-- customized: Markbridge Windows workbench; dual floating sky papers with translucent interiors, <=6 frosted overlays, softened 0.10 dividers, dark depth refinement, 7px thin scrollbars, local user fonts, 12-20px resolveAppearanceMetrics virtual-row geometry, accessible fallbacks -->

## Overview

轻盈毛玻璃 is airy frosted glass for a workbench, and it holds with no blur at all. It has four layers: the field, paper, wells, and overlays. The field is bright, low-chroma air: a gradient from `{colors.field-start}` to `{colors.field-end}`, with up to three soft blobs on it. Translucent white paper floats on the field, and the field shows between the papers and at the window edge. Read status, then the number, then the action. There is no marketing hero.

语义色只有两个. `{colors.input}` means input or completion. `{colors.output}` means output. Text sits on paper or on a well. `{colors.ink}` may also sit directly on the field, for example as a page title.

Blur is not the material. Paper, wells, and the field never blur. This file does not define a component library. Do not import the glassmorphism palette, fonts, or radii.

The file carries two groups, light and dark. The sections below describe the light group, and Dark Group describes the dark one. A token whose name ends in `-dark` replaces the token of the same name without the suffix. Follow the system appearance, and let an explicit choice by the user win over it.

Markbridge retains its product name, blue brand mark, and `light` / `dark` / `system` theme setting. `#root` paints the 160deg sky field with 3 non-blurred radial blobs at 0.70 alpha (`--blob-*-fill`), while `.app-sidebar` and `.app-main` float as two separate non-blurred papers. Inside those papers, `.list-pane`, `.detail-pane`, ordinary `.library-row` items, inputs/selects/textareas, `.font-catalog-list`, and `.folder-picker-list` stay transparent so `--sheet` and field blobs read cleanly through (with `--row-hover` wash on hover, `--selected` on active/checked rows, and `--disabled-surface` on disabled fields). Frosted `blur(20px) saturate(1.15)` over `--overlay` is strictly limited to the 6 scroll-over overlays when open/visible (`<= 6` concurrent per viewport) with opaque `--sheet-solid` (`Canvas`) / `backdrop-filter: none` fallbacks; internal `--line` dividers soften to `0.10` alpha while dark paper depth rises (outer edge `rgba(255,255,255,0.12)`, top highlight `0.10`, outer drop-shadow `rgba(0,0,0,0.48)`) and `7px` transparent-track rounded scrollbars replace thick native scrollbars. Inside the `20px`-radius (`12px`-padded) `.app-sidebar`, `.nav-button`, `.connection-pill`, and `.folder-pane .library-row` use concentric `--radius-sidebar-item: 8px` and nested `24×24px` `.tree-chevron` uses `6px`. Root `DESIGN.md` and `apps/desktop/src/styles.css` remain the sole visual contract and token layer.

## Colourway

The colourway is a dial. `apply` sets it from the project: an accent token the project already has, then the project content, then the default. The roles, the material, and the contrast gates are the same in every colourway. Only the hex values below change: nine in the light group and nine in the dark group.

<!-- palette:begin colourway -->
Colourway: `sky` (天蓝 → 鼠尾草绿 / sky to sage).

- Field: `#E8F3FF` to `#E5F3E7`.
- Blobs: `#D2E7FE`, `#CAE5CE`, `#D6EDEE`, each at opacity 0.70.
- Input: `#1F6CB0` on `#EBF5FF`.
- Output: `#317A45` on `#EBF8EC`.
- Other colourways: `mint`, `sky`, `apricot`, `slate`, or `hue:<0-359>`.
<!-- palette:end colourway -->

<!-- palette:begin colourway-dark -->
Dark group of `sky`.

- Field: `#121A22` to `#0B1F10`.
- Blobs: `#1B2B3C`, `#053616`, `#06292B`, each at opacity 0.70.
- Input: `#82C0FF` on `#233242`.
- Output: `#7CD18F` on `#233527`.
<!-- palette:end colourway-dark -->

To switch, rerun `apply --force --palette <preset|hue:N>`. It rewrites both groups together. Do not edit one hex by hand. The contrast tables under Accessibility are measured for this colourway only.

## Colors

Field, the bottom layer:

- `{colors.field-start}` (`#E8F3FF`) to `{colors.field-end}` (`#E5F3E7`), about 160deg. Both ends stay low-chroma (OKLCH C at most 0.03) in every colourway.
- At most 3 blobs: `{colors.blob-start}` (`#D2E7FE`), `{colors.blob-end}` (`#CAE5CE`), and `{colors.blob-mid}` (`#D6EDEE`), each at opacity 0.70 (`{material.blob-opacity}`).
- A blob is a radial falloff: its color at the center, transparent at 70% of the radius (`{material.blob-fade}`). Draw the falloff as a radial gradient, or as an image of one where the stack has no radial gradient. Do not use a blur filter for it.
- Put `{colors.blob-start}` near the corner where the field starts, `{colors.blob-end}` near the corner where it ends, and `{colors.blob-mid}` near a third corner. Each blob is about a third to a half of the window wide.

Paper, for the sidebar and for cards. Paper does not blur:

- Fill `{colors.sheet}` (`rgba(255,255,255,0.62)`).
- 1px edge `{colors.sheet-edge}` (`rgba(255,255,255,0.70)`). This is a light edge, not an opaque fence, and not a control boundary.
- A 1px highlight along the top, inside the edge: `{elevation.sheet-highlight}`.
- One soft shadow with a negative spread: `{elevation.sheet-shadow}`.

Paper and the field have almost the same lightness. The Accessibility table reports the ratio. The layers separate through the blobs that show between the papers, the white edge, the highlight, and the shadow. They do not separate through a lighter or darker fill.

Wells are flat fills inside paper. A well does not blur and has no gray outline:

- `{colors.input-wash}` (`#EBF5FF`) is the input and completion well.
- `{colors.output-wash}` (`#EBF8EC`) is the output well.
- `{colors.well}` (`rgba(36,48,58,0.04)`) is the neutral well: `{colors.ink}` at low opacity over paper.

Overlays are popovers, menus, dialogs, and sticky bars:

- Fill `{colors.overlay}` (`rgba(255,255,255,0.82)`), the same 1px `{colors.sheet-edge}`, the highlight `{elevation.overlay-highlight}`, and one heavier shadow, `{elevation.overlay-shadow}`.
- An overlay may blur only when content scrolls beneath it. Then the overlay takes `backdrop-filter: blur(20px) saturate(1.15)`. The allowed overlay blur is 16px to 24px. The default is 20px. Saturation stays 1.15.
- Where the stack has no backdrop blur, raise the overlay fill to `{colors.sheet-solid}` (`rgba(255,255,255,0.96)`).

Controls:

- `{colors.control-edge}` (`rgba(36,48,58,0.54)`) is the 1px boundary of inputs, checkboxes, radios, and switches.
- `{colors.control-fill}` (`rgba(36,48,58,0.08)`) fills a secondary button, a neutral tag, and the track of a segmented control. Its label is `{colors.ink}`.
- `{colors.on-input}` (`#FFFFFF`) is the label, the check mark, and the switch thumb on a `{colors.input}` fill.

Text:

- `{colors.ink}` (`#24303A`) for titles and body. It is the same neutral in every colourway. It sits on paper, on a well, on `{colors.control-fill}`, or directly on the field.
- `{colors.muted}` (`#5C6B76`) for 12px secondary text. It is also fixed. It sits on paper or on a well. The Accessibility table says whether this colourway lets it sit on the field.
- `{colors.input}` (`#1F6CB0`) for input, completion, links, and the focus ring. It sits on paper or on `{colors.input-wash}`.
- `{colors.output}` (`#317A45`) for output and secondary figures. It sits on paper or on `{colors.output-wash}`.

减少透明度时 (`prefers-reduced-transparency: reduce`),以及系统高对比度时,纸和浮层都改为 `{colors.sheet-solid}` (`rgba(255,255,255,0.96)`),浮层不再模糊. 保持同一色相,只提高不透明度. 纸的填充是 0.62. 轻来自底场的色斑、纸之间露出的底场、白描边、内高光和柔影,不来自模糊.

## Dark Group

The dark group is the same material with the lightness turned over: a dark field, dark paper, and light text. Paper and the field still have almost the same lightness, and the layers still separate through the blobs, the edge, the highlight, and the shadow. Every rule in this file holds for the dark group unless this section changes it.

Use the dark group when the system appearance is dark (`prefers-color-scheme: dark`). An explicit choice by the user wins over the system appearance, in both directions. Typography, radii, spacing, `material`, and motion have no dark twin: both groups use the same values.

| Role | Light token | Dark token | Dark value |
| --- | --- | --- | --- |
| Field ends | `{colors.field-start}`, `{colors.field-end}` | `{colors.field-start-dark}`, `{colors.field-end-dark}` | `#121A22`, `#0B1F10` |
| Blobs | `{colors.blob-start}`, `{colors.blob-end}`, `{colors.blob-mid}` | `{colors.blob-start-dark}`, `{colors.blob-end-dark}`, `{colors.blob-mid-dark}` | `#1B2B3C`, `#053616`, `#06292B` |
| Paper fill | `{colors.sheet}` | `{colors.sheet-dark}` | `rgba(28,37,48,0.60)` |
| Opaque fallback | `{colors.sheet-solid}` | `{colors.sheet-solid-dark}` | `rgba(28,37,48,0.96)` |
| Paper edge | `{colors.sheet-edge}` | `{colors.sheet-edge-dark}` | `rgba(255,255,255,0.08)` |
| Paper highlight | `{elevation.sheet-highlight}` | `{elevation.sheet-highlight-dark}` | `inset 0 1px 0 rgba(255,255,255,0.06)` |
| Paper shadow | `{elevation.sheet-shadow}` | `{elevation.sheet-shadow-dark}` | `0 12px 40px -16px rgba(0,0,0,0.45)` |
| Overlay fill | `{colors.overlay}` | `{colors.overlay-dark}` | `rgba(30,40,52,0.84)` |
| Overlay highlight | `{elevation.overlay-highlight}` | `{elevation.overlay-highlight-dark}` | `inset 0 1px 0 rgba(255,255,255,0.08)` |
| Overlay shadow | `{elevation.overlay-shadow}` | `{elevation.overlay-shadow-dark}` | `0 24px 64px -24px rgba(0,0,0,0.60)` |
| Neutral well | `{colors.well}` | `{colors.well-dark}` | `rgba(231,237,243,0.04)` |
| Control fill | `{colors.control-fill}` | `{colors.control-fill-dark}` | `rgba(231,237,243,0.08)` |
| Control boundary | `{colors.control-edge}` | `{colors.control-edge-dark}` | `rgba(255,255,255,0.36)` |
| Label on an input fill | `{colors.on-input}` | `{colors.on-input-dark}` | `#1C2530` |
| Text | `{colors.ink}` | `{colors.ink-dark}` | `#E7EDF3` |
| Secondary text | `{colors.muted}` | `{colors.muted-dark}` | `#A3AFBD` |
| Input and its well | `{colors.input}`, `{colors.input-wash}` | `{colors.input-dark}`, `{colors.input-wash-dark}` | `#82C0FF`, `#233242` |
| Output and its well | `{colors.output}`, `{colors.output-wash}` | `{colors.output-dark}`, `{colors.output-wash-dark}` | `#7CD18F`, `#233527` |

What the dark group changes:

- Paper is `{colors.sheet-dark}`: a dark color of its own, at 0.60. It is not white at a low alpha. White at a low alpha only grays the field, and it leaves no color for the opaque fallback.
- The paper edge and the two highlights stay white, at a far lower alpha. The two shadows are black and heavier.
- Both field ends stay dark and low-chroma: OKLCH L at most 0.23, C at most 0.045. A blob is lighter than both ends, and a blob stays at C 0.08 or less.
- An overlay is lighter than paper, so it is the weaker surface for light text. The dark contrast table measures text and the control boundary on the worst overlay as well as on the worst paper.
- `{colors.well-dark}` is `{colors.ink-dark}` at 0.04 over paper. The two semantic wells are dark tints of their accent, a little lighter than the paper color.
- `{colors.input-dark}` and `{colors.output-dark}` are light enough to be text on dark paper. A fill of `{colors.input-dark}` takes a dark label, check mark, and switch thumb: `{colors.on-input-dark}`, which is the paper color.
- Under 减少透明度 and under system high contrast, paper and overlays use `{colors.sheet-solid-dark}`: the paper color at 0.96. An overlay with no backdrop blur uses it too.

The recipe below is written for an explicit dark choice: `data-theme="dark"` on the root. Bind the same values when `prefers-color-scheme: dark` matches and the root carries no `data-theme="light"`. Radii, the press scale, and the rule for which overlay may blur come from the light recipe under Elevation & Depth.

```css
:root[data-theme="dark"] .field {
  background:
    radial-gradient(42rem 32rem at 12% 6%, color-mix(in srgb, #1B2B3C 70%, transparent), transparent 70%),
    radial-gradient(40rem 32rem at 92% 96%, color-mix(in srgb, #053616 70%, transparent), transparent 70%),
    radial-gradient(30rem 24rem at 82% 10%, color-mix(in srgb, #06292B 70%, transparent), transparent 70%),
    linear-gradient(160deg, #121A22, #0B1F10);
}
:root[data-theme="dark"] .sheet {
  background: rgba(28,37,48,0.60);
  border-color: rgba(255,255,255,0.08);
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.06), 0 12px 40px -16px rgba(0,0,0,0.45);
}
:root[data-theme="dark"] .well {
  background: rgba(231,237,243,0.04);
}
:root[data-theme="dark"] .overlay {
  background: rgba(30,40,52,0.84);
  border-color: rgba(255,255,255,0.08);
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.08), 0 24px 64px -24px rgba(0,0,0,0.60);
}
@supports not (backdrop-filter: blur(1px)) {
  :root[data-theme="dark"] .overlay {
    background: rgba(28,37,48,0.96);
  }
}
@media (prefers-reduced-transparency: reduce), (prefers-contrast: more) {
  :root[data-theme="dark"] .sheet,
  :root[data-theme="dark"] .overlay {
    background: rgba(28,37,48,0.96);
  }
}
```

## Typography

Family: `Figtree, "PingFang SC", "Noto Sans SC", sans-serif`. Do not use Inter, Plus Jakarta Sans, or DM Sans.

Markbridge adapts typography to local-first desktop execution: no network font (including Figtree) is downloaded. Instead, it uses the local system font stack (`"Segoe UI Variable Text", "Segoe UI", "Microsoft YaHei UI", "Microsoft YaHei", sans-serif`) and user-installed fonts (`12–20px`, `v2` preferences with `v1` read-only migration), keeping monospace for code/ports. `resolveAppearanceMetrics` is the sole geometry contract for virtual rows and controls: body `line-height: 1.6`, list title `1.6`, caption `1.5` (minimum `12px`), and `12/14/20px` map to folder rows `40/40/48px`, bookmark rows `52/56/76px`, and control heights `40/40/48px`.

| Role | Token | Size | Weight | Notes |
| --- | --- | --- | --- | --- |
| Large numbers | `{typography.display-num}` | 32px | 700 | `tabular-nums`. Latin digits may use -0.02em |
| Title | `{typography.title}` | 16px | 650 | No negative tracking |
| Body | `{typography.body}` | 14px | 400 | Chinese running text line-height 1.7 (Markbridge virtual-row contract uses 1.6 / caption 1.5) |
| Secondary | `{typography.meta}` | 12px | 400 | Color `{colors.muted}` |

The -0.02em tracking belongs only to large Latin numerals. Chinese running text does not use negative letter-spacing.

## Layout

Spacing is 8 / 12 / 16 / 24 / 32 / 48 (`{spacing.min}` through `{spacing.xxl}`). The minimum gap is 8px.

At least two papers sit directly on the field, for example a sidebar and one or more cards. Leave the field visible between the papers and between a paper and the window edge: a gap of at least `{spacing.md}` (16px). Do not cover the window with one paper. Do not nest paper inside paper. Group content inside a paper with wells.

Markbridge wide-shell dual floating papers activate at `min-width: 960px` and `min-height: 551px`: `#root` uses `14px` outer padding, `.workspace` is a transparent grid separating a resizable `.app-sidebar` (`256px` default, `200–420px` via the `14px` `.sidebar-splitter`, collapsible to a `64px` icon rail) and `.app-main` (`minmax(480px, 1fr)`), both rendered as separate non-blurred `20px`-radius papers (`{colors.sheet}`, `1px` `{colors.sheet-edge}`, `{elevation.sheet-highlight}`, `{elevation.sheet-shadow}`, zero `backdrop-filter` on papers, wells, or virtual rows). Paper interiors (`.list-pane`, `.detail-pane`, ordinary `.library-row`, text inputs/selects/textareas, `.font-catalog-list`, `.folder-picker-list`) use `background: transparent` with translucent `--row-hover` (`0.05` light / `0.06` dark), softened `0.10`-alpha `--line` dividers, and refined dark outer edge (`rgba(255,255,255,0.12)`), top highlight (`rgba(255,255,255,0.10)`), outer shadow (`rgba(0,0,0,0.48)`), and dark radial blob spread (preserving exact `sky` hexes & `0.70` alpha). Inside the `20px`-radius `.app-sidebar` (`12px` inner padding), `.nav-button`, `.connection-pill`, and `.folder-pane .library-row` use concentric `--radius-sidebar-item: 8px` (`20px - 12px = 8px`), while nested `24×24px` `.tree-chevron` uses `6px`. The left sidebar places all 5 primary navigation buttons (`书签`, `整理`, `语义检索`, `操作历史`, `设置`) consecutively at the top, mounts `.sidebar-library` only when `section === 'library'`, omits `<footer className="status-bar">`, and places a `.connection-pill` button (`WorkspaceIcon`, no decorative status dot) at the bottom navigating directly to Settings -> `Chrome 连接`.

Exactly 6 scroll-over overlays use `--overlay` and `backdrop-filter: blur(20px) saturate(1.15)` strictly when visible/open (`<= 6` per viewport): `.detail-pane:not([hidden]) > .pane-heading`, `.detail-pane:not([hidden]) .detail-tabs`, `.confirmation-dialog[open]`, `.font-picker[open]`, `.selection-path[open] > p`, and `.folder-pane.is-open:not([hidden])`. Internal scroll containers use custom `7px` transparent-track rounded-pill scrollbars (`--scrollbar-thumb` / `--scrollbar-thumb-hover`), wrapped with `@supports not selector(::-webkit-scrollbar)` for standard `scrollbar-width: thin` fallback without overriding WebKit scrollbars. Below `960px` width or `551px` height (down to the `640×480` minimum window), outer padding and paper gap collapse to `0px`, `border-radius` becomes `0px`, papers switch to opaque `{colors.sheet-solid}` (`0.96`) with `box-shadow: none` and `backdrop-filter: none`, `.app-sidebar` keeps a `1px solid var(--line)` right divider (`64px` icon rail below `800px`), and `@supports not (backdrop-filter: blur(1px))`, `prefers-reduced-transparency: reduce`, `prefers-contrast: more`, and `forced-colors: active` enforce opaque `--sheet-solid` (`Canvas`) / `backdrop-filter: none` fallbacks with >= 4.5:1 text contrast and >= 3:1 focus/control boundaries.

A page title may sit directly on the field in `{colors.ink}`.

Order on the workbench is status, number, action. Do not add a marketing hero.

When the paper padding is 8px, an inner image uses a 12px radius, because outer radius = inner radius + padding.

Icons are linear, about a 1.5px stroke, in `currentColor`. Do not add illustrated characters.

## Elevation & Depth

Depth has four sources: the field and its blobs showing between the papers, the white edge, the top highlight, and one soft shadow with a negative spread. Do not stack outer shadows or add a glow.

```css
.field {
  background:
    radial-gradient(42rem 32rem at 12% 6%, color-mix(in srgb, #D2E7FE 70%, transparent), transparent 70%),
    radial-gradient(40rem 32rem at 92% 96%, color-mix(in srgb, #CAE5CE 70%, transparent), transparent 70%),
    radial-gradient(30rem 24rem at 82% 10%, color-mix(in srgb, #D6EDEE 70%, transparent), transparent 70%),
    linear-gradient(160deg, #E8F3FF, #E5F3E7);
}
.sheet {
  background: rgba(255,255,255,0.62);
  border: 1px solid rgba(255,255,255,0.70);
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.55), 0 12px 40px -16px rgba(30,60,90,0.14);
  border-radius: 20px;
}
.well {
  background: rgba(36,48,58,0.04);
  border-radius: 16px;
}
.overlay {
  background: rgba(255,255,255,0.82);
  border: 1px solid rgba(255,255,255,0.70);
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.65), 0 24px 64px -24px rgba(30,60,90,0.22);
  border-radius: 16px;
}
.overlay.is-scrolled-under {
  backdrop-filter: blur(20px) saturate(1.15);
}
@supports not (backdrop-filter: blur(1px)) {
  .overlay {
    background: rgba(255,255,255,0.96);
  }
}
@media (prefers-reduced-transparency: reduce), (prefers-contrast: more) {
  .sheet,
  .overlay {
    background: rgba(255,255,255,0.96);
  }
  .overlay.is-scrolled-under {
    backdrop-filter: none;
  }
}
.sheet:active {
  transform: scale(0.98);
  transition: transform 120ms;
}
@media (prefers-reduced-motion: reduce) {
  .sheet:active {
    transform: none;
  }
}
```

The 1px border is the light edge only. CSS `border-style: solid` here only paints the translucent color. It is not an opaque fence and it is not the control boundary.

The inset highlight and the outer shadow are one `box-shadow` value in CSS. On a stack that draws them apart, keep the outer shadow outside the paper, so it does not darken the paper fill.

Pointer press uses `transform: scale(0.98)` for about 120ms, and animates `transform` only. Keyboard state changes do not animate. `prefers-reduced-motion: reduce` cancels the scale. Do not animate the overlay blur radius.

One viewport holds at most 6 overlays that use `backdrop-filter`. Do not nest paper inside paper. Paper, wells, list rows, and tables never blur.

## Shapes

| Token | Radius | Use |
| --- | --- | --- |
| `{rounded.check}` | 4px | Checkbox |
| `{rounded.control}` | 12px | Text input, textarea, select |
| `{rounded.image}` | 12px | Image inside paper when padding is 8px |
| `{rounded.well}` | 16px | Wells, popovers, menus |
| `{rounded.sheet}` | 20px | Paper, dialogs |
| `{rounded.pill}` | 999px | Buttons, tags, segmented controls, switches |

Buttons and tags are pills. Paper is 20px. With 8px padding, the inner image is 12px so that outer = inner + padding. Markbridge customization: inside the 20px-radius, 12px-padded `.app-sidebar`, sidebar items (`.nav-button`, `.connection-pill`, `.folder-pane .library-row`) apply the same concentric rule (`--radius-sidebar-item: 8px`, since `20px - 12px = 8px`) and the nested `24×24px` `.tree-chevron` uses `6px`; standalone buttons and tags outside the sidebar remain `999px` pills.

## Accessibility

Meet WCAG 2.2 AA on the worst specified background, not on an average of the field. The field has eight backgrounds: its two ends, and each blob at opacity 0.70 over each end. Paper is white 0.62 over one of them. A neutral well is `{colors.ink}` 0.04 over that paper. A row marked 最差 uses the background with the lowest ratio for that pair. Layers are mixed per sRGB channel, then WCAG 2.x relative luminance is used. An overlay is white 0.82 over the same backgrounds, which is lighter than paper, so text that passes on paper passes on an overlay.

These ratios were measured for this colourway. Do not replace them with a new calculation in this file. Change the colourway with `apply --force --palette`, which measures again.

<!-- palette:begin contrast -->
Inputs, checkboxes, radios, and switches draw their boundary in `{colors.control-edge}`. On the worst paper that edge is 3.16:1; the non-text minimum is 3:1. The 2px focus ring is `{colors.input}` (`#1F6CB0`): 5.48:1 on white and 5.01:1 on the worst paper. The white paper edge on the field start is 1.12:1, so it cannot be a control boundary.

`{colors.ink}` may sit directly on the field: 10.50:1 on the worst blob. `{colors.muted}` on the field is 4.28:1 at worst, below 4.5:1, so secondary text stays on paper or a well in this colourway.

| 前景 | 背景 | 比值 | 门槛 | 用途 |
| --- | --- | --- | --- | --- |
| `#24303A` | `#FFFFFF` | 13.47 | 4.5 | 正文,不透明回退 |
| `#24303A` | 白 0.62 叠 `#E8F3FF` | 12.85 | 4.5 | 正文,纸在底场起点上 |
| `#24303A` | 白 0.62 叠 `#E5F3E7` | 12.76 | 4.5 | 正文,纸在底场终点上 |
| `#5C6B76` | 白 0.62 叠 `#E8F3FF` | 5.25 | 4.5 | 次要文字,纸在底场起点上 |
| `#5C6B76` | 白 0.62 叠 `#E5F3E7` | 5.21 | 4.5 | 次要文字,纸在底场终点上 |
| `#24303A` | 白 0.62 叠 (`#CAE5CE` 0.70 叠 `#E5F3E7`) | 12.31 | 4.5 | 正文,最差的纸 |
| `#5C6B76` | 白 0.62 叠 (`#CAE5CE` 0.70 叠 `#E5F3E7`) | 5.02 | 4.5 | 次要文字,最差的纸 |
| `#5C6B76` | `#24303A` 0.04 叠 白 0.62 叠 (`#CAE5CE` 0.70 叠 `#E5F3E7`) | 4.68 | 4.5 | 次要文字,最差的纸上的中性内容块 |
| `#24303A` | `#CAE5CE` 0.70 叠 `#E5F3E7` | 10.50 | 4.5 | 正文直接落在底场上,最差的色斑 |
| `#5C6B76` | `#CAE5CE` 0.70 叠 `#E5F3E7` | 4.28 | 只报告 | 次要文字落在底场上,只报告,本色板不可 |
| `#24303A` 0.54 叠纸 | 白 0.62 叠 (`#CAE5CE` 0.70 叠 `#E8F3FF`) | 3.16 | 3 | 输入框、复选框、单选、开关的边界,最差的纸 |
| `#1F6CB0` | `#EBF5FF` | 4.97 | 4.5 | 输入或完成,正文与大号数字 |
| `#1F6CB0` | 白 0.62 叠 (`#CAE5CE` 0.70 叠 `#E5F3E7`) | 5.01 | 4.5 | 链接,最差的纸 |
| `#1F6CB0` | `#FFFFFF` | 5.48 | 4.5 | 主要按钮上的白字,不透明回退上的链接 |
| `#317A45` | `#EBF8EC` | 4.79 | 4.5 | 输出,正文与大号数字 |
| `#317A45` | 白 0.62 叠 (`#CAE5CE` 0.70 叠 `#E5F3E7`) | 4.80 | 4.5 | 输出色的文字,最差的纸 |
| `#317A45` | `#FFFFFF` | 5.25 | 4.5 | 输出色,不透明回退 |
| `#FFFFFF` | `#E8F3FF` | 1.12 | 只报告 | 白描边,不能当控件边界 |
| 白 0.62 叠 `#E8F3FF` | `#E8F3FF` | 1.07 | 只报告 | 纸与底场的明度比,只报告,层次不靠它 |
<!-- palette:end contrast -->

A lighter tint of `{colors.input}` or `{colors.output}` that falls under 4.5:1 on its well is not a token. Use the measured value and keep the well light.

### Dark group contrast

The dark group is measured the same way, on its own eight backgrounds. Paper is `{colors.sheet-dark}` over one of them, and a neutral well is `{colors.ink-dark}` 0.04 over that paper. An overlay is `{colors.overlay-dark}` over the same backgrounds. It is lighter than paper, so the text rows and the control boundary are measured on the worst overlay as well. The opaque fallback is the paper color.

<!-- palette:begin contrast-dark -->
In the dark group, inputs, checkboxes, radios, and switches draw their boundary in `{colors.control-edge-dark}`. That edge is 3.23:1 on the worst paper and 3.20:1 on the worst overlay; the non-text minimum is 3:1. The 2px focus ring is `{colors.input-dark}` (`#82C0FF`): 7.94:1 on the worst paper and 7.77:1 on the worst overlay. The paper edge on the field start is 1.37:1, so it cannot be a control boundary.

`{colors.ink-dark}` may sit directly on the field: 12.49:1 on the worst blob. `{colors.muted-dark}` on the field is 6.61:1 at worst, so 12px secondary text may sit on the field in this colourway.

| 前景 | 背景 | 比值 | 门槛 | 用途 |
| --- | --- | --- | --- | --- |
| `#E7EDF3` | `#1C2530` | 13.12 | 4.5 | 正文,不透明回退 |
| `#E7EDF3` | `#1C2530` 0.60 叠 `#121A22` | 13.80 | 4.5 | 正文,纸在底场起点上 |
| `#E7EDF3` | `#1C2530` 0.60 叠 `#0B1F10` | 13.73 | 4.5 | 正文,纸在底场终点上 |
| `#A3AFBD` | `#1C2530` 0.60 叠 `#121A22` | 7.31 | 4.5 | 次要文字,纸在底场起点上 |
| `#A3AFBD` | `#1C2530` 0.60 叠 `#0B1F10` | 7.27 | 4.5 | 次要文字,纸在底场终点上 |
| `#E7EDF3` | `#1C2530` 0.60 叠 (`#053616` 0.70 叠 `#121A22`) | 12.94 | 4.5 | 正文,最差的纸 |
| `#A3AFBD` | `#1C2530` 0.60 叠 (`#053616` 0.70 叠 `#121A22`) | 6.85 | 4.5 | 次要文字,最差的纸 |
| `#A3AFBD` | `#E7EDF3` 0.04 叠 `#1C2530` 0.60 叠 (`#053616` 0.70 叠 `#121A22`) | 6.16 | 4.5 | 次要文字,最差的纸上的中性内容块 |
| `#E7EDF3` | `#053616` 0.70 叠 `#0B1F10` | 12.49 | 4.5 | 正文直接落在底场上,最差的色斑 |
| `#A3AFBD` | `#053616` 0.70 叠 `#0B1F10` | 6.61 | 只报告 | 次要文字落在底场上,只报告,本色板可以 |
| 白 0.36 叠纸 | `#1C2530` 0.60 叠 (`#053616` 0.70 叠 `#0B1F10`) | 3.23 | 3 | 输入框、复选框、单选、开关的边界,最差的纸 |
| `#82C0FF` | `#233242` | 6.81 | 4.5 | 输入或完成,正文与大号数字 |
| `#82C0FF` | `#1C2530` 0.60 叠 (`#053616` 0.70 叠 `#121A22`) | 7.94 | 4.5 | 链接,最差的纸 |
| `#82C0FF` | `#1C2530` | 8.06 | 4.5 | 主要按钮上的深色字,不透明回退上的链接 |
| `#7CD18F` | `#233527` | 7.06 | 4.5 | 输出,正文与大号数字 |
| `#7CD18F` | `#1C2530` 0.60 叠 (`#053616` 0.70 叠 `#121A22`) | 8.26 | 4.5 | 输出色的文字,最差的纸 |
| `#7CD18F` | `#1C2530` | 8.38 | 4.5 | 输出色,不透明回退 |
| 白 0.08 叠纸 | `#121A22` | 1.37 | 只报告 | 纸的描边,不能当控件边界 |
| `#1C2530` 0.60 叠 (`#1B2B3C` 0.70 叠 `#0B1F10`) | `#1B2B3C` 0.70 叠 `#0B1F10` | 1.00 | 只报告 | 纸与底场的明度比,只报告,层次不靠它 |
| `#E7EDF3` | `#1E2834` 0.84 叠 (`#053616` 0.70 叠 `#121A22`) | 12.66 | 4.5 | 正文,最差的浮层 |
| `#A3AFBD` | `#1E2834` 0.84 叠 (`#053616` 0.70 叠 `#121A22`) | 6.70 | 4.5 | 次要文字,最差的浮层 |
| 白 0.36 叠浮层 | `#1E2834` 0.84 叠 (`#1B2B3C` 0.70 叠 `#121A22`) | 3.20 | 3 | 输入框、复选框、单选、开关的边界,最差的浮层 |
| `#82C0FF` | `#1E2834` 0.84 叠 (`#053616` 0.70 叠 `#121A22`) | 7.77 | 4.5 | 链接,最差的浮层 |
| `#7CD18F` | `#1E2834` 0.84 叠 (`#053616` 0.70 叠 `#121A22`) | 8.09 | 4.5 | 输出色的文字,最差的浮层 |
<!-- palette:end contrast-dark -->

A darker shade of `{colors.input-dark}` or `{colors.output-dark}` that falls under 4.5:1 on its well is not a token. Use the measured value and keep the well dark.

### Control boundaries

WCAG 1.4.11 asks for 3:1 on the visual information that identifies a control and its state. It does not ask for an outline on a control that a fill and a text label already identify.

| Control | Identified by | Boundary |
| --- | --- | --- |
| Text input, textarea, select | 1px `{colors.control-edge}` | Required: 3:1 on paper |
| Checkbox or radio, off | 1px `{colors.control-edge}` | Required: 3:1 on paper |
| Checkbox or radio, on | Fill `{colors.input}` with a mark in `{colors.on-input}` | The fill is the boundary |
| Switch, off | 1px `{colors.control-edge}` on the track, thumb in `{colors.muted}` | Required: 3:1 on paper |
| Switch, on | Track fill `{colors.input}`, thumb in `{colors.on-input}` | The fill is the boundary |
| Primary button | Fill `{colors.input}`, label `{colors.on-input}` | No outline |
| Secondary button | Fill `{colors.control-fill}`, label `{colors.ink}` | No outline |
| Tag | Fill `{colors.input-wash}` or `{colors.output-wash}` with its semantic color as the label, or fill `{colors.control-fill}` with label `{colors.ink}` | No outline |
| Segmented item | Track `{colors.control-fill}`. The selected item is `{colors.input-wash}` with label `{colors.input}`. Other items have label `{colors.ink}` | No outline |
| Focus ring, every control | 2px `{colors.input}`, offset 2px | Same in every state |

The table names the light tokens. In the dark group each one becomes its `-dark` twin, and the boundary must reach 3:1 on paper and on an overlay.

The inside of a text input, an unchecked box, and an off switch is paper. Give it no fill of its own, so the edge mixes over paper as measured. An icon-only button has no text label. Its icon is the identifying information and must reach 3:1 on its background. Do not draw a gray outline around a button, a tag, a segmented item, or a well.

## Writing Tone

State the status, then the number, then the action. Keep labels short. No slogan and no marketing headline. Do not tighten Chinese text to match the Latin number tracking.

## Do's and Don'ts

### Do

- Put text on paper or on a well. `{colors.ink}` may also sit directly on the field.
- Put at least two papers directly on the field, and leave the field visible between them and at the window edge.
- Give paper its four parts: the fill `{colors.sheet}`, the 1px `{colors.sheet-edge}`, the top highlight, and the one soft shadow.
- Use `{colors.input}` for input, completion, links, and the 2px focus ring.
- Use `{colors.output}` for output and secondary figures.
- Draw the boundary of inputs, checkboxes, radios, and switches in `{colors.control-edge}`.
- Use `{colors.sheet-solid}` for paper and overlays under 减少透明度 and under system high contrast.
- Ship the light group and the dark group together. Follow the system appearance, and let an explicit choice by the user win.
- Set numbers in `tabular-nums`.
- On pointer press, scale to 0.98 for about 120ms on `transform` only. Skip that motion for keyboard activation and for `prefers-reduced-motion`.

### Don't

- Don't blur paper, wells, list rows, or tables. Only an overlay with content scrolling beneath it may blur.
- Don't cover the window with one paper. Without the field showing, the material is a white page.
- Don't nest paper, and don't put more than 6 blurred overlays in one viewport.
- Don't draw a blob with a blur filter, and don't give a blob a new hex.
- Don't use the 1px `rgba(255,255,255,0.70)` edge as a control boundary or as an opaque fence. On the field it is far below 3:1. The Accessibility table has the ratio. The dark paper edge is not a control boundary either.
- Don't make dark paper from white at a low alpha. Dark paper is `{colors.sheet-dark}`.
- Don't put a `-dark` token on a light surface, or a light token on a dark one.
- Don't outline a button, a tag, a segmented item, or a well in gray. A fill and a text label identify them.
- Don't animate blur.
- Don't use Inter, Plus Jakarta Sans, or DM Sans.
- Don't set body text in a lighter tint of `{colors.input}` or `{colors.output}`. Under 4.5:1 on its well, it fails.
- Don't apply negative letter-spacing to Chinese running text.
- Don't add a second outer shadow, a neon glow, or a saturated neon gradient.
- Don't put `{colors.muted}`, `{colors.input}`, or `{colors.output}` text on the field. The one exception is `{colors.muted}` in a group whose contrast table allows it.
- Don't put accent-colored text on the neutral well. `{colors.input}` and `{colors.output}` are measured on paper and on their own wash.
- Don't turn this field gradient off as decoration, and don't paste it onto another DESIGN.md. Choosing this style means the gradient is the material.
- Don't change one hex of the colourway by hand, and don't raise the chroma of a field end. Switch the whole colourway with `apply --force --palette`.

## Responsive Behavior

| Condition | Paper | Overlay |
| --- | --- | --- |
| Transparency allowed, at every width | `{colors.sheet}`, no blur | `{colors.overlay}`. Blur 20px only when content scrolls beneath it |
| The stack has no backdrop blur | Unchanged | `{colors.sheet-solid}` |
| `prefers-reduced-transparency: reduce`, or system high contrast | 减少透明度时的不透明回退: `{colors.sheet-solid}` | `{colors.sheet-solid}`, blur none |

The dark group follows the same table with its `-dark` tokens.

At a narrow width the papers stack in one column. Keep the gap between them and the margin at the window edge, so the field still shows.

Pills stay pills. The focus ring stays 2px `{colors.input}`. Keyboard focus does not scale.

## Known Gaps

- No high-contrast palette. Under system high contrast, paper and overlays turn opaque and every color stays as it is.
- No chart palette.
- `{colors.ink}` and `{colors.muted}` do not tint with the colourway. On a warm field they read slightly cool.
- Contrast ratios above are measured on the eight field backgrounds of each group, on paper and the neutral well over them, on the two semantic wells, and on the opaque fallback: `#FFFFFF` in the light group, the paper color in the dark group. The dark group is also measured on overlays. They are not measured on photographs, not on content that shows through an overlay, and not on a well inside an overlay.
- The neutral well is 0.04. At 0.05, `{colors.muted}` on the worst paper is 4.50:1 in some derived colourways, which leaves no margin.
- Blob positions and sizes are a starting point for a desktop window. They are not tokens.
- If Figtree is unavailable, fall back to the system sans-serif and keep `"PingFang SC", "Noto Sans SC"` after the Latin family.
- Title weight 650 needs the Figtree variable font. Static Figtree files step by 100. If only a static file is available, use 600 for that role and do not add a second token.
- Line-height is specified for Chinese body text only (1.7). Other roles do not add a second line-height.
- Markbridge customization: local system/user-installed fonts replace Figtree; `resolveAppearanceMetrics` retains `1.6` body / `1.5` caption line-heights so `12/14/20px` virtual rows never drift; desktop wide dual-paper inset/gap uses `14px` (within `12–16px` tolerance) with translucent paper interiors (`.list-pane`, `.detail-pane`, ordinary `.library-row`, inputs/selects/textareas, `.font-catalog-list`, `.folder-picker-list`), softened `0.10` `--line`, dark depth refinement (`0.12` edge / `0.10` highlight / `0.48` outer drop-shadow), sidebar concentric inner radius (`--radius-sidebar-item: 8px` for `.nav-button` / `.connection-pill` / `.folder-pane .library-row` and `6px` for `.tree-chevron`), `7px` thin scrollbars, and 6 gated frosted overlays (`<= 6` per viewport), dropping to `0px` / `--sheet-solid` (`0.96`) / `backdrop-filter: none` under `<960px` or `<551px` (including `640×480`), `@supports not (backdrop-filter: blur(1px))`, `prefers-reduced-transparency: reduce`, `prefers-contrast: more`, and `forced-colors: active`; remote `preview-*` webviews, extension pages, and native OS window frames/dialogs remain unstyled by this theme.
