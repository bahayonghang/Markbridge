import { describe, expect, it, vi } from 'vitest';
import { applyUiPreferences, DEFAULT_UI_PREFERENCES, fontFamilyCss, LEGACY_UI_PREFERENCES_KEY, parseUiPreferences, readUiPreferences, resolveAppearanceMetrics, saveUiPreferences, UI_PREFERENCES_KEY, validFontFamily } from './ui-preferences';

describe('local appearance v2 preferences', () => {
  it.each([null, '{broken', 'null', '[]', '{"version":99,"theme":"dark"}'])('uses defaults without modifying invalid or unknown-version data %s', raw => {
    const storage = { getItem: vi.fn(() => raw), setItem: vi.fn() };
    expect(readUiPreferences(storage)).toEqual(DEFAULT_UI_PREFERENCES);
    expect(storage.getItem).toHaveBeenCalledWith(UI_PREFERENCES_KEY);
    expect(storage.setItem).not.toHaveBeenCalled();
  });
  it.each(['system', 'yahei', 'song'] as const)('migrates all old sizes for %s without writing either key', font => {
    for (const [fontSize, fontSizePx] of [['small', 12], ['standard', 13], ['large', 15]]) {
      const raw = JSON.stringify({ version: 1, theme: 'dark', font, fontSize });
      const storage = { getItem: vi.fn(key => key === LEGACY_UI_PREFERENCES_KEY ? raw : null), setItem: vi.fn() };
      expect(readUiPreferences(storage)).toEqual({ version: 2, theme: 'dark', font: { kind: 'preset', value: font }, fontSizePx });
      expect(storage.setItem).not.toHaveBeenCalled();
    }
  });
  it('does not fall back to v1 when v2 exists but is invalid', () => {
    const storage = { getItem: vi.fn(key => key === UI_PREFERENCES_KEY ? '{"version":99}' : '{"version":1,"theme":"dark"}') };
    expect(readUiPreferences(storage)).toEqual(DEFAULT_UI_PREFERENCES);
    expect(storage.getItem).toHaveBeenCalledExactlyOnceWith(UI_PREFERENCES_KEY);
  });
  it('normalizes unknown fields and defaults invalid fields independently', () => {
    expect(parseUiPreferences(JSON.stringify({ version: 2, theme: 'dark', font: { kind: 'unknown' }, fontSizePx: 99, extra: 'omit' }))).toEqual({ ...DEFAULT_UI_PREFERENCES, theme: 'dark' });
    expect(parseUiPreferences(JSON.stringify({ version: 2, theme: 'dark', font: { kind: 'installed', family: 'Book Font', extra: 'omit' }, fontSizePx: 17 }))).toEqual({ version: 2, theme: 'dark', font: { kind: 'installed', family: 'Book Font' }, fontSizePx: 17 });
  });
  it.each([11, 21, 12.5, '14', null])('rejects invalid size %s', fontSizePx => {
    expect(parseUiPreferences(JSON.stringify({ ...DEFAULT_UI_PREFERENCES, fontSizePx })).fontSizePx).toBe(14);
  });
  it.each(['', ' ', 'x'.repeat(257), String.fromCharCode(0), String.fromCharCode(0xd800)])('rejects invalid font family', family => {
    expect(validFontFamily(family)).toBe(false);
    expect(parseUiPreferences(JSON.stringify({ ...DEFAULT_UI_PREFERENCES, font: { kind: 'installed', family } })).font).toEqual(DEFAULT_UI_PREFERENCES.font);
  });
  it('escapes an installed name as one CSS string including quotes, commas and backslashes', () => {
    const family = "A'B" + String.fromCharCode(92) + 'C, url(remote); color:red';
    const css = fontFamilyCss({ kind: 'installed', family });
    expect(css).toBe("'A" + String.fromCharCode(92) + "'B" + String.fromCharCode(92, 92) + 'C, url(remote); color:red' + "', " + fontFamilyCss({ kind: 'preset', value: 'system' }));
    expect(validFontFamily('字体'.repeat(128))).toBe(true);
  });
  it.each(Array.from({ length: 9 }, (_, index) => index + 12))('shares all text and row geometry at %spx', size => {
    const metrics = resolveAppearanceMetrics(size);
    const root = document.createElement('div');
    applyUiPreferences({ ...DEFAULT_UI_PREFERENCES, fontSizePx: size }, false, root);
    expect(root.style.getPropertyValue('--text-size')).toBe(`${size}px`);
    expect(root.style.getPropertyValue('--control-height')).toBe(`${metrics.control}px`);
    expect(root.style.getPropertyValue('--text-caption')).toBe(`${metrics.caption}px`);
    expect(metrics.bookmarkRow).toBeGreaterThanOrEqual(1.6 * metrics.listTitle + 1.5 * metrics.caption + 12);
    expect(metrics.folderRow).toBeGreaterThanOrEqual(1.6 * size + 16);
  });
  it('pins the accepted boundary metrics', () => {
    expect([12, 14, 20].map(n => { const m = resolveAppearanceMetrics(n); return [m.folderRow, m.bookmarkRow, m.control]; })).toEqual([[40, 52, 40], [40, 56, 40], [48, 76, 48]]);
  });
  it('maintains strict descending typography tokens at 12, 14, and 20px', () => {
    for (const size of [12, 14, 20]) {
      const m = resolveAppearanceMetrics(size);
      expect(m.heading).toBeGreaterThan(m.section);
      expect(m.section).toBeGreaterThan(m.listTitle);
      expect(m.listTitle).toBeGreaterThan(m.text);
      const root = document.createElement('div');
      applyUiPreferences({ ...DEFAULT_UI_PREFERENCES, fontSizePx: size }, false, root);
      const px = (name: string) => parseFloat(root.style.getPropertyValue(name));
      expect(px('--text-heading')).toBeGreaterThan(px('--text-section'));
      expect(px('--text-section')).toBeGreaterThan(px('--text-label'));
      expect(px('--text-label')).toBeGreaterThan(px('--text-size'));
    }
  });
  it('applies system color and truthfully reports unavailable read/write storage', () => {
    const root = document.createElement('div'); applyUiPreferences(DEFAULT_UI_PREFERENCES, true, root);
    expect(root.dataset.theme).toBe('dark');
    expect(readUiPreferences({ getItem() { throw new Error('blocked'); } })).toEqual(DEFAULT_UI_PREFERENCES);
    expect(saveUiPreferences(DEFAULT_UI_PREFERENCES, { setItem() { throw new Error('quota'); } })).toBe(false);
  });
  it('writes only v2 while preserving legacy and unrelated records', () => {
    const storage = { setItem: vi.fn() };
    const value = { ...DEFAULT_UI_PREFERENCES, theme: 'dark' as const, font: { kind: 'preset' as const, value: 'yahei' as const }, fontSizePx: 12 };
    expect(saveUiPreferences(value, storage)).toBe(true);
    expect(storage.setItem).toHaveBeenCalledExactlyOnceWith(UI_PREFERENCES_KEY, JSON.stringify(value));
  });
});
