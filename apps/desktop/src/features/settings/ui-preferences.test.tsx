import { describe, expect, it, vi } from 'vitest';
import { applyUiPreferences, DEFAULT_UI_PREFERENCES, parseUiPreferences, readUiPreferences, saveUiPreferences, UI_PREFERENCES_KEY } from './ui-preferences';

describe('local appearance preferences', () => {
  it.each([null, '{broken', 'null', '[]', '{"version":2,"theme":"dark"}'])('uses defaults without modifying invalid or unknown-version data %s', raw => {
    const storage = { getItem: vi.fn(() => raw), setItem: vi.fn() };
    expect(readUiPreferences(storage)).toEqual(DEFAULT_UI_PREFERENCES);
    expect(storage.getItem).toHaveBeenCalledWith(UI_PREFERENCES_KEY);
    expect(storage.setItem).not.toHaveBeenCalled();
  });
  it('defaults fields independently and never injects arbitrary font strings', () => {
    expect(parseUiPreferences('{"version":1,"theme":"dark","font":"url(remote)","fontSize":"huge"}')).toEqual({ ...DEFAULT_UI_PREFERENCES, theme: 'dark' });
    const root = document.createElement('div');
    applyUiPreferences(parseUiPreferences('{"version":1,"theme":"light","font":"song","fontSize":"large"}'), true, root);
    expect(root.dataset.theme).toBe('light');
    expect(root.style.getPropertyValue('--text-size')).toBe('15px');
    expect(root.style.getPropertyValue('--font-family')).toContain('SimSun');
  });
  it('applies system color and truthfully reports unavailable read/write storage', () => {
    const root = document.createElement('div');
    applyUiPreferences(DEFAULT_UI_PREFERENCES, true, root);
    expect(root.dataset.theme).toBe('dark');
    expect(readUiPreferences({ getItem() { throw new Error('blocked'); } })).toEqual(DEFAULT_UI_PREFERENCES);
    expect(saveUiPreferences(DEFAULT_UI_PREFERENCES, { setItem() { throw new Error('quota'); } })).toBe(false);
  });
  it('writes only its own versioned key with valid user choices', () => {
    const storage = { setItem: vi.fn() };
    const value = { ...DEFAULT_UI_PREFERENCES, theme: 'dark' as const, font: 'yahei' as const, fontSize: 'small' as const };
    expect(saveUiPreferences(value, storage)).toBe(true);
    expect(storage.setItem).toHaveBeenCalledExactlyOnceWith(UI_PREFERENCES_KEY, JSON.stringify(value));
  });
});
