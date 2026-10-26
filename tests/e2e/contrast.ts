import type { Locator } from '@playwright/test';

type Color = [number, number, number, number];
type Layer = { color: string; image: string; fieldStart: string; fieldEnd: string; isField: boolean; backdropFilter: string; isPaper: boolean };

function parseColor(value: string): Color {
  if (/^#[\da-f]{6}$/i.test(value)) return [1, 3, 5].map(offset => parseInt(value.slice(offset, offset + 2), 16)).concat(1) as Color;
  if (!/^rgba?\([\d.,\s]+\)$/.test(value)) throw new Error(`UNSUPPORTED_CONTRAST_COLOR: ${value}`);
  const values = value.match(/[\d.]+/g)!.map(Number);
  if (values.length !== 3 && values.length !== 4) throw new Error(`INVALID_CONTRAST_COLOR: ${value}`);
  return [values[0], values[1], values[2], values[3] ?? 1];
}

function blend(front: Color, back: Color): Color {
  const alpha = front[3] + back[3] * (1 - front[3]);
  if (!alpha) return [0, 0, 0, 0];
  return [0, 1, 2].map(i => (front[i] * front[3] + back[i] * back[3] * (1 - front[3])) / alpha).concat(alpha) as Color;
}

function css(color: Color) { return `rgb(${color.slice(0, 3).join(', ')})`; }

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
  return [0, .25, .5, .75, 1].map(position => {
    let background: Color = [0, 0, 0, 0];
    let hasField = false, hasPaperFilter = false;
    for (const layer of layers) {
      if (layer.backdropFilter !== 'none') {
        if (!layer.isPaper || !hasField || hasPaperFilter || layer.backdropFilter !== 'blur(20px) saturate(1.15)') throw new Error(`UNSUPPORTED_CONTRAST_BACKDROP: ${layer.backdropFilter}`);
        // Blur mixes the controlled field's colors; sample its full range, including both endpoints.
        // CSS saturate() operates on sRGB before the translucent paper is painted over the backdrop.
        const gray = background[0] * .213 + background[1] * .715 + background[2] * .072;
        background = background.map((channel, i) => i === 3 ? channel : Math.max(0, Math.min(255, gray + 1.15 * (channel - gray)))) as Color;
        hasPaperFilter = true;
      }
      background = blend(parseColor(layer.color), background);
      if (layer.image !== 'none') {
        // Only the application's controlled, two-stop field is supported. Fail closed for images or new gradients.
        const stops = layer.image.match(/rgba?\([^)]+\)/g);
        if (!layer.isField || !/^linear-gradient\(160deg,/.test(layer.image) || stops?.length !== 2
          || layer.image !== `linear-gradient(160deg, ${stops[0]}, ${stops[1]})`) throw new Error(`UNSUPPORTED_CONTRAST_BACKGROUND: ${layer.image}`);
        const start = parseColor(layer.fieldStart), end = parseColor(layer.fieldEnd);
        if (start[3] !== 1 || end[3] !== 1 || css(start) !== css(parseColor(stops[0])) || css(end) !== css(parseColor(stops[1]))) throw new Error('CONTRAST_FIELD_TOKEN_DRIFT');
        background = blend(start.map((channel, i) => channel + (end[i] - channel) * position) as Color, background);
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
      const result = [];
      for (let current = element; current; current = current.parentElement) {
        const style = getComputedStyle(current);
        if (Number(style.opacity) !== 1 || style.filter !== 'none' || style.mixBlendMode !== 'normal') throw new Error('UNSUPPORTED_CONTRAST_COMPOSITING');
        result.unshift({ color: style.backgroundColor, image: style.backgroundImage, fieldStart: style.getPropertyValue('--field-start').trim(), fieldEnd: style.getPropertyValue('--field-end').trim(), isField: current.id === 'root', backdropFilter: style.backdropFilter, isPaper: current.classList.contains('workspace') });
      }
      return result;
    }
    const style = getComputedStyle(node);
    return { ink: style.color, fill: layers(node), outside: layers(node.parentElement), border: style.borderColor, borderStyle: style.borderStyle, outline: style.outlineColor, outlineStyle: style.outlineStyle, outlineWidth: style.outlineWidth };
  });
  return { ...result, fill: compositeBackgrounds(result.fill), outside: compositeBackgrounds(result.outside) };
}
