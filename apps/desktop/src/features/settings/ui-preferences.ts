export type UiPreferences = {
  version: 1;
  theme: 'system' | 'light' | 'dark';
  font: 'system' | 'yahei' | 'song';
  fontSize: 'small' | 'standard' | 'large';
};

export const UI_PREFERENCES_KEY = 'markbridge.ui-preferences.v1';
export const DEFAULT_UI_PREFERENCES: UiPreferences = { version: 1, theme: 'system', font: 'system', fontSize: 'standard' };
export const appearanceSizes = {
  small: { text: 12, folderRow: 40, bookmarkRow: 48, control: 40 },
  standard: { text: 13, folderRow: 40, bookmarkRow: 52, control: 40 },
  large: { text: 15, folderRow: 48, bookmarkRow: 60, control: 44 },
} as const;
const fonts = {
  system: '"Segoe UI Variable Text", "Segoe UI", "Microsoft YaHei UI", "Microsoft YaHei", sans-serif',
  yahei: '"Microsoft YaHei UI", "Microsoft YaHei", "Segoe UI", sans-serif',
  song: '"Times New Roman", "SimSun", serif',
};

export function parseUiPreferences(raw: string | null): UiPreferences {
  try {
    const value: unknown = raw == null ? null : JSON.parse(raw);
    if (!value || typeof value !== 'object' || !('version' in value) || value.version !== 1) return { ...DEFAULT_UI_PREFERENCES };
    const fields = value as Record<string, unknown>;
    return {
      version: 1,
      theme: fields.theme === 'light' || fields.theme === 'dark' ? fields.theme : 'system',
      font: fields.font === 'yahei' || fields.font === 'song' ? fields.font : 'system',
      fontSize: fields.fontSize === 'small' || fields.fontSize === 'large' ? fields.fontSize : 'standard',
    };
  } catch { return { ...DEFAULT_UI_PREFERENCES }; }
}

export function readUiPreferences(storage?: Pick<Storage, 'getItem'>): UiPreferences {
  try { return parseUiPreferences((storage ?? window.localStorage).getItem(UI_PREFERENCES_KEY)); }
  catch { return { ...DEFAULT_UI_PREFERENCES }; }
}

export function saveUiPreferences(value: UiPreferences, storage?: Pick<Storage, 'setItem'>): boolean {
  try { (storage ?? window.localStorage).setItem(UI_PREFERENCES_KEY, JSON.stringify(value)); return true; }
  catch { return false; }
}

export function applyUiPreferences(value: UiPreferences, darkSystem: boolean, root: HTMLElement = document.documentElement) {
  root.dataset.theme = value.theme === 'system' ? darkSystem ? 'dark' : 'light' : value.theme;
  root.dataset.font = value.font;
  root.dataset.fontSize = value.fontSize;
  const size = appearanceSizes[value.fontSize];
  root.style.setProperty('--font-family', fonts[value.font]);
  root.style.setProperty('--text-size', `${size.text}px`);
  root.style.setProperty('--control-height', `${size.control}px`);
}
