export type UiFont = { kind: 'preset'; value: 'system' | 'yahei' | 'song' } | { kind: 'installed'; family: string };
export type UiPreferences = { version: 2; theme: 'system' | 'light' | 'dark'; font: UiFont; fontSizePx: number };

export const LEGACY_UI_PREFERENCES_KEY = 'markbridge.ui-preferences.v1';
export const UI_PREFERENCES_KEY = 'markbridge.ui-preferences.v2';
export const DEFAULT_UI_PREFERENCES: UiPreferences = { version: 2, theme: 'system', font: { kind: 'preset', value: 'system' }, fontSizePx: 14 };
export const fontPresetLabels = { system: '系统字体', yahei: '微软雅黑', song: '宋体' };
const fonts = {
  system: '"Segoe UI Variable Text", "Segoe UI", "Microsoft YaHei UI", "Microsoft YaHei", sans-serif',
  yahei: '"Microsoft YaHei UI", "Microsoft YaHei", "Segoe UI", sans-serif',
  song: '"Times New Roman", "SimSun", serif',
};

const defaults = (): UiPreferences => ({ ...DEFAULT_UI_PREFERENCES, font: { kind: 'preset', value: 'system' } });
export const validFontSize = (value: number) => Number.isInteger(value) && value >= 12 && value <= 20;
export function validFontFamily(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && [...value].length <= 256 && !/[\p{Cc}\p{Cs}]/u.test(value);
}
function normalizeFont(value: unknown): UiFont {
  if (value && typeof value === 'object') {
    if ('kind' in value && value.kind === 'installed' && 'family' in value && validFontFamily(value.family)) return { kind: 'installed', family: value.family };
    if ('kind' in value && value.kind === 'preset' && 'value' in value && (value.value === 'yahei' || value.value === 'song')) return { kind: 'preset', value: value.value };
  }
  return { kind: 'preset', value: 'system' };
}
export function parseUiPreferences(raw: string | null): UiPreferences {
  try {
    const value: unknown = raw == null ? null : JSON.parse(raw);
    if (!value || typeof value !== 'object' || !('version' in value) || value.version !== 2) return defaults();
    const fields = value as Record<string, unknown>;
    return {
      version: 2,
      theme: fields.theme === 'light' || fields.theme === 'dark' ? fields.theme : 'system',
      font: normalizeFont(fields.font),
      fontSizePx: typeof fields.fontSizePx === 'number' && validFontSize(fields.fontSizePx) ? fields.fontSizePx : 14,
    };
  } catch { return defaults(); }
}

function migrateLegacy(raw: string | null): UiPreferences {
  try {
    const value: unknown = raw == null ? null : JSON.parse(raw);
    if (!value || typeof value !== 'object' || !('version' in value) || value.version !== 1) return defaults();
    const fields = value as Record<string, unknown>;
    return { version: 2, theme: fields.theme === 'light' || fields.theme === 'dark' ? fields.theme : 'system', font: { kind: 'preset', value: fields.font === 'yahei' || fields.font === 'song' ? fields.font : 'system' }, fontSizePx: fields.fontSize === 'small' ? 12 : fields.fontSize === 'large' ? 15 : 13 };
  } catch { return defaults(); }
}

export function readUiPreferences(storage?: Pick<Storage, 'getItem'>): UiPreferences {
  try {
    const source = storage ?? window.localStorage;
    const current = source.getItem(UI_PREFERENCES_KEY);
    return current === null ? migrateLegacy(source.getItem(LEGACY_UI_PREFERENCES_KEY)) : parseUiPreferences(current);
  } catch { return defaults(); }
}

export function saveUiPreferences(value: UiPreferences, storage?: Pick<Storage, 'setItem'>): boolean {
  try { (storage ?? window.localStorage).setItem(UI_PREFERENCES_KEY, JSON.stringify(parseUiPreferences(JSON.stringify(value)))); return true; }
  catch { return false; }
}

export function fontFamilyCss(font: UiFont): string {
  if (font.kind === 'preset') return fonts[font.value];
  // A family is one CSS string, never a declaration, URL, or comma-separated list.
  if (!validFontFamily(font.family)) return fonts.system;
  return `'${font.family.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}', ${fonts.system}`;
}

export function resolveAppearanceMetrics(fontSizePx: number) {
  const text = validFontSize(fontSizePx) ? fontSizePx : 14;
  const caption = Math.max(12, text - 2);
  const ceilTo4 = (value: number) => Math.ceil(value / 4) * 4;
  return { text, caption, listTitle: text + 1, section: text + 2, heading: text + 6, folderRow: Math.max(40, ceilTo4(1.6 * text + 16)), bookmarkRow: Math.max(48, ceilTo4(1.6 * (text + 1) + 1.5 * caption + 12)), control: Math.max(40, ceilTo4(1.6 * text + 16)) };
}

export function applyUiPreferences(value: UiPreferences, darkSystem: boolean, root: HTMLElement = document.documentElement) {
  root.dataset.theme = value.theme === 'system' ? darkSystem ? 'dark' : 'light' : value.theme;
  root.dataset.font = value.font.kind === 'preset' ? value.font.value : 'installed';
  root.dataset.fontSize = String(value.fontSizePx);
  const size = resolveAppearanceMetrics(value.fontSizePx);
  root.style.setProperty('--font-family', fontFamilyCss(value.font));
  for (const [name, pixels] of Object.entries({ 'text-size': size.text, 'text-caption': size.caption, 'text-label': size.listTitle, 'text-section': size.section, 'text-prominent': size.section, 'text-dialog': size.heading, 'text-heading': size.heading, 'control-height': size.control })) root.style.setProperty(`--${name}`, `${pixels}px`);
}
