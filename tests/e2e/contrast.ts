import type { Locator } from '@playwright/test';

type Color = [number, number, number, number];
export type Layer = {
  color: string;
  image: string;
  fieldStart: string;
  fieldEnd: string;
  blobStart: string;
  blobEnd: string;
  blobMid: string;
  isField: boolean;
  backdropFilter: string;
  isPaper: boolean;
  isRow?: boolean;
  isOverlay?: boolean;
};

function parseColor(value: string): Color {
  const trimmed = value.trim();
  if (trimmed === 'transparent') return [0, 0, 0, 0];
  if (/^#[\da-f]{6}$/i.test(trimmed)) return [1, 3, 5].map(offset => parseInt(trimmed.slice(offset, offset + 2), 16)).concat(1) as Color;
  if (!/^rgba?\([\d.,\s]+\)$/.test(trimmed)) throw new Error(`UNSUPPORTED_CONTRAST_COLOR: ${value}`);
  const values = trimmed.match(/[\d.]+/g)!.map(Number);
  if (values.length !== 3 && values.length !== 4) throw new Error(`INVALID_CONTRAST_COLOR: ${value}`);
  return [values[0], values[1], values[2], values[3] ?? 1];
}

function blend(front: Color, back: Color): Color {
  const alpha = front[3] + back[3] * (1 - front[3]);
  if (!alpha) return [0, 0, 0, 0];
  return [0, 1, 2].map(i => (front[i] * front[3] + back[i] * back[3] * (1 - front[3])) / alpha).concat(alpha) as Color;
}

function css(color: Color) { return `rgb(${color.slice(0, 3).join(', ')})`; }

function sameRgb(a: Color, b: Color) {
  return Math.abs(a[0] - b[0]) < 1 && Math.abs(a[1] - b[1]) < 1 && Math.abs(a[2] - b[2]) < 1;
}

export function splitTopLevel(value: string): string[] {
  const parts: string[] = [];
  let depth = 0, start = 0;
  for (let i = 0; i < value.length; i += 1) {
    const ch = value[i];
    if (ch === '(') depth += 1;
    else if (ch === ')') depth -= 1;
    else if (ch === ',' && depth === 0) {
      parts.push(value.slice(start, i).trim());
      start = i + 1;
    }
  }
  const tail = value.slice(start).trim();
  if (tail) parts.push(tail);
  return parts;
}

function parseFieldImage(layer: Layer) {
  const parts = splitTopLevel(layer.image);
  if (!layer.isField || parts.length !== 4) throw new Error(`UNSUPPORTED_CONTRAST_BACKGROUND: ${layer.image}`);
  const blobTokens = [layer.blobStart, layer.blobEnd, layer.blobMid];
  const blobs = parts.slice(0, 3).map((part, index) => {
    if (!/^radial-gradient\(/.test(part) || !/\s70%\)$/.test(part)) throw new Error(`UNSUPPORTED_CONTRAST_BACKGROUND: ${part}`);
    const stops = part.match(/(?:rgba?\([^)]+\)|transparent)/g);
    if (stops?.length !== 2) throw new Error(`UNSUPPORTED_CONTRAST_BACKGROUND: ${part}`);
    const fill = parseColor(stops[0]);
    const fade = parseColor(stops[1]);
    if (fade[3] !== 0) throw new Error(`UNSUPPORTED_CONTRAST_BACKGROUND: ${part}`);
    const expected = parseColor(blobTokens[index]);
    if (!sameRgb(fill, expected) || Math.abs(fill[3] - expected[3]) >= 0.01 || Math.abs(expected[3] - 0.7) >= 0.01) {
      throw new Error('CONTRAST_FIELD_TOKEN_DRIFT');
    }
    return expected;
  });
  const linear = parts[3];
  const linearStops = linear.match(/rgba?\([^)]+\)/g);
  if (!/^linear-gradient\(160deg,/.test(linear) || linearStops?.length !== 2 || linear !== `linear-gradient(160deg, ${linearStops[0]}, ${linearStops[1]})`) {
    throw new Error(`UNSUPPORTED_CONTRAST_BACKGROUND: ${linear}`);
  }
  const start = parseColor(layer.fieldStart), end = parseColor(layer.fieldEnd);
  if (start[3] !== 1 || end[3] !== 1 || css(start) !== css(parseColor(linearStops[0])) || css(end) !== css(parseColor(linearStops[1]))) {
    throw new Error('CONTRAST_FIELD_TOKEN_DRIFT');
  }
  return { start, end, blobs };
}

export function contrastRatio(foreground: string, background: string): number {
  const back = parseColor(background);
  if (back[3] !== 1) throw new Error('CONTRAST_BACKGROUND_NOT_COMPOSITED');
  const luminance = (color: Color) => color.slice(0, 3).map(channel => channel / 255)
    .map(channel => channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4)
    .reduce((sum, channel, i) => sum + channel * [.2126, .7152, .0722][i], 0);
  const a = luminance(blend(parseColor(foreground), back)), b = luminance(back);
  return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
}

export function compositeBackgrounds(layers: Layer[]): string[] {
  const hasAnyField = layers.some(layer => layer.isField && layer.image !== 'none');
  const samples = hasAnyField
    ? [
      ...[0, 0.25, 0.5, 0.75, 1].map(position => ({ position, blobIndex: null as number | null })),
      ...[0, 1, 2].flatMap(blobIndex => [0, 0.5, 1].map(position => ({ position, blobIndex }))),
    ]
    : [{ position: 0, blobIndex: null as number | null }];

  return samples.map(({ position, blobIndex }) => {
    let background: Color = [0, 0, 0, 0];
    let hasField = false;
    for (const layer of layers) {
      if (layer.backdropFilter !== 'none') {
        if (!layer.isOverlay || layer.isPaper || layer.isRow) {
          throw new Error(`UNSUPPORTED_CONTRAST_BACKDROP: ${layer.backdropFilter}`);
        }
      }
      background = blend(parseColor(layer.color), background);
      if (layer.image !== 'none') {
        if (!layer.isField || hasField) throw new Error(`UNSUPPORTED_CONTRAST_BACKGROUND: ${layer.image}`);
        const { start, end, blobs } = parseFieldImage(layer);
        const linearColor = start.map((channel, i) => channel + (end[i] - channel) * position) as Color;
        background = blend(linearColor, background);
        if (blobIndex !== null) background = blend(blobs[blobIndex], background);
        hasField = true;
      }
    }
    if (background[3] !== 1) throw new Error('VISIBLE_BACKGROUND_NOT_FOUND');
    return css(background);
  });
}

export async function renderedContrastColors(locator: Locator) {
  const result = await locator.evaluate(node => {
    function layers(element: Element | null) {
      const collected = [];
      for (let current = element; current; current = current.parentElement) {
        const style = getComputedStyle(current);
        if (Number(style.opacity) !== 1 || style.filter !== 'none' || style.mixBlendMode !== 'normal') throw new Error('UNSUPPORTED_CONTRAST_COMPOSITING');
        collected.unshift({
          color: style.backgroundColor,
          image: style.backgroundImage,
          fieldStart: style.getPropertyValue('--field-start').trim(),
          fieldEnd: style.getPropertyValue('--field-end').trim(),
          blobStart: style.getPropertyValue('--blob-start-fill').trim(),
          blobEnd: style.getPropertyValue('--blob-end-fill').trim(),
          blobMid: style.getPropertyValue('--blob-mid-fill').trim(),
          isField: current.id === 'root',
          backdropFilter: style.backdropFilter,
          isPaper: current.classList.contains('app-sidebar') || current.classList.contains('app-main'),
          isRow: current.classList.contains('library-row'),
          isOverlay: current.matches(
            '.detail-pane:not([hidden]) > .pane-heading, .detail-pane:not([hidden]) .detail-tabs, .confirmation-dialog[open], .font-picker[open], .selection-path[open] > p, .folder-pane.is-open:not([hidden])',
          ),
        });
      }
      return collected;
    }
    const style = getComputedStyle(node);
    return { ink: style.color, fill: layers(node), outside: layers(node.parentElement), border: style.borderColor, borderStyle: style.borderStyle, outline: style.outlineColor, outlineStyle: style.outlineStyle, outlineWidth: style.outlineWidth };
  });
  return { ...result, fill: compositeBackgrounds(result.fill), outside: compositeBackgrounds(result.outside) };
}
