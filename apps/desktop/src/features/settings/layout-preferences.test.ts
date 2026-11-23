import { describe, expect, it, vi } from 'vitest';
import {
  clampSidebarWidth,
  DEFAULT_LAYOUT_PREFERENCES,
  DEFAULT_SIDEBAR_WIDTH_PX,
  FIELD_INSET_PX,
  LAYOUT_PREFERENCES_KEY,
  MAX_SIDEBAR_WIDTH_PX,
  maxSidebarWidth,
  MIN_MAIN_WIDTH_PX,
  MIN_SIDEBAR_WIDTH_PX,
  parseLayoutPreferences,
  readLayoutPreferences,
  saveLayoutPreferences,
} from './layout-preferences';
import { LEGACY_UI_PREFERENCES_KEY, UI_PREFERENCES_KEY } from './ui-preferences';

describe('sidebar layout v1 preferences', () => {
  it('exposes the agreed constants and default preference shape', () => {
    expect(LAYOUT_PREFERENCES_KEY).toBe('markbridge.layout-preferences.v1');
    expect(DEFAULT_SIDEBAR_WIDTH_PX).toBe(256);
    expect(MIN_SIDEBAR_WIDTH_PX).toBe(200);
    expect(MAX_SIDEBAR_WIDTH_PX).toBe(420);
    expect(MIN_MAIN_WIDTH_PX).toBe(480);
    expect(FIELD_INSET_PX).toBe(14);
    expect(DEFAULT_LAYOUT_PREFERENCES).toEqual({
      version: 1,
      sidebarWidthPx: 256,
      sidebarCollapsed: false,
    });
  });

  it('computes dynamic max width and clamps sidebar widths safely', () => {
    expect(maxSidebarWidth()).toBe(420);
    expect(maxSidebarWidth(Number.NaN)).toBe(420);
    expect(maxSidebarWidth(1440)).toBe(420);
    expect(maxSidebarWidth(960)).toBe(420);
    expect(maxSidebarWidth(900)).toBe(378);
    expect(maxSidebarWidth(860)).toBe(338);
    expect(maxSidebarWidth(700)).toBe(200);

    expect(clampSidebarWidth(180)).toBe(200);
    expect(clampSidebarWidth(480)).toBe(420);
    expect(clampSidebarWidth(299.6)).toBe(300);
    expect(clampSidebarWidth(Number.NaN)).toBe(256);
    expect(clampSidebarWidth(Number.POSITIVE_INFINITY)).toBe(256);
    expect(clampSidebarWidth(Number.NEGATIVE_INFINITY)).toBe(256);

    expect(clampSidebarWidth(400, 860)).toBe(338);
    expect(clampSidebarWidth(256, 700)).toBe(200);
    expect(clampSidebarWidth(Number.NaN, 700)).toBe(200);
  });

  it.each([
    null,
    '{broken',
    'null',
    '[]',
    '123',
    '{"version":2,"sidebarWidthPx":320,"sidebarCollapsed":true}',
    '{}',
  ])('falls back to defaults for malformed or unknown-version input %s', (raw) => {
    expect(parseLayoutPreferences(raw)).toEqual(DEFAULT_LAYOUT_PREFERENCES);
  });

  it('normalizes invalid fields independently and strips unknown properties', () => {
    expect(parseLayoutPreferences(JSON.stringify({ version: 1, sidebarWidthPx: 199, sidebarCollapsed: true, extra: 'drop' }))).toEqual({
      version: 1,
      sidebarWidthPx: 256,
      sidebarCollapsed: true,
    });
    expect(parseLayoutPreferences(JSON.stringify({ version: 1, sidebarWidthPx: 421, sidebarCollapsed: true }))).toEqual({
      version: 1,
      sidebarWidthPx: 256,
      sidebarCollapsed: true,
    });
    expect(parseLayoutPreferences(JSON.stringify({ version: 1, sidebarWidthPx: -10, sidebarCollapsed: true }))).toEqual({
      version: 1,
      sidebarWidthPx: 256,
      sidebarCollapsed: true,
    });
    expect(parseLayoutPreferences(JSON.stringify({ version: 1, sidebarWidthPx: 0, sidebarCollapsed: true }))).toEqual({
      version: 1,
      sidebarWidthPx: 256,
      sidebarCollapsed: true,
    });
    expect(parseLayoutPreferences(JSON.stringify({ version: 1, sidebarWidthPx: '300', sidebarCollapsed: true }))).toEqual({
      version: 1,
      sidebarWidthPx: 256,
      sidebarCollapsed: true,
    });
    expect(parseLayoutPreferences(JSON.stringify({ version: 1, sidebarWidthPx: null, sidebarCollapsed: true }))).toEqual({
      version: 1,
      sidebarWidthPx: 256,
      sidebarCollapsed: true,
    });
    expect(parseLayoutPreferences(JSON.stringify({ version: 1, sidebarWidthPx: 320, sidebarCollapsed: 'true' }))).toEqual({
      version: 1,
      sidebarWidthPx: 320,
      sidebarCollapsed: false,
    });
    expect(parseLayoutPreferences(JSON.stringify({ version: 1, sidebarWidthPx: 320, sidebarCollapsed: 1 }))).toEqual({
      version: 1,
      sidebarWidthPx: 320,
      sidebarCollapsed: false,
    });
    expect(parseLayoutPreferences(JSON.stringify({ version: 1, sidebarWidthPx: 320, sidebarCollapsed: null }))).toEqual({
      version: 1,
      sidebarWidthPx: 320,
      sidebarCollapsed: false,
    });
    expect(parseLayoutPreferences(JSON.stringify({ version: 1, sidebarWidthPx: 280.4, sidebarCollapsed: true, extra: 1 }))).toEqual({
      version: 1,
      sidebarWidthPx: 280,
      sidebarCollapsed: true,
    });
  });

  it('reads only layout preferences without writing or touching UI preference keys', () => {
    const raw = JSON.stringify({ version: 1, sidebarWidthPx: 336, sidebarCollapsed: true });
    const storage = {
      getItem: vi.fn((key: string) => (key === LAYOUT_PREFERENCES_KEY ? raw : null)),
      setItem: vi.fn(),
    };
    expect(readLayoutPreferences(storage)).toEqual({
      version: 1,
      sidebarWidthPx: 336,
      sidebarCollapsed: true,
    });
    expect(storage.getItem).toHaveBeenCalledExactlyOnceWith(LAYOUT_PREFERENCES_KEY);
    expect(storage.getItem).not.toHaveBeenCalledWith(UI_PREFERENCES_KEY);
    expect(storage.getItem).not.toHaveBeenCalledWith(LEGACY_UI_PREFERENCES_KEY);
    expect(storage.setItem).not.toHaveBeenCalled();

    expect(readLayoutPreferences({ getItem() { throw new Error('blocked'); } })).toEqual(DEFAULT_LAYOUT_PREFERENCES);
  });

  it('saves normalized values solely to layout preferences and handles storage errors safely', () => {
    const storage = { setItem: vi.fn() };
    const saved = saveLayoutPreferences(
      { version: 1, sidebarWidthPx: 999, sidebarCollapsed: true },
      storage,
    );
    expect(saved).toBe(true);
    expect(storage.setItem).toHaveBeenCalledExactlyOnceWith(
      LAYOUT_PREFERENCES_KEY,
      JSON.stringify({ version: 1, sidebarWidthPx: 420, sidebarCollapsed: true }),
    );
    expect(storage.setItem).not.toHaveBeenCalledWith(UI_PREFERENCES_KEY, expect.anything());

    expect(
      saveLayoutPreferences(DEFAULT_LAYOUT_PREFERENCES, {
        setItem() { throw new Error('quota'); },
      }),
    ).toBe(false);
  });
});
