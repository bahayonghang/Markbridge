import { afterEach, expect, it, vi } from 'vitest';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { setWindowTheme } from './backend';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(), isTauri: vi.fn() }));
afterEach(() => vi.resetAllMocks());

it('skips native window theme sync outside the Tauri desktop runtime', async () => {
  vi.mocked(isTauri).mockReturnValue(false);
  for (const theme of ['system', 'light', 'dark'] as const) {
    await expect(setWindowTheme(theme)).resolves.toBeUndefined();
  }
  expect(invoke).not.toHaveBeenCalled();
});

it('invokes set_window_theme with system, light, or dark inside Tauri', async () => {
  vi.mocked(isTauri).mockReturnValue(true);
  vi.mocked(invoke).mockResolvedValue(undefined);
  await expect(setWindowTheme('system')).resolves.toBeUndefined();
  await expect(setWindowTheme('light')).resolves.toBeUndefined();
  await expect(setWindowTheme('dark')).resolves.toBeUndefined();
  expect(vi.mocked(invoke).mock.calls).toEqual([
    ['set_window_theme', { theme: 'system' }],
    ['set_window_theme', { theme: 'light' }],
    ['set_window_theme', { theme: 'dark' }],
  ]);
});

it('silently ignores native invoke failures during best-effort theme sync', async () => {
  vi.mocked(isTauri).mockReturnValue(true);
  vi.mocked(invoke).mockRejectedValueOnce(new Error('STORAGE_ERROR'));
  await expect(setWindowTheme('dark')).resolves.toBeUndefined();
  vi.mocked(invoke).mockRejectedValueOnce('READ_ONLY');
  await expect(setWindowTheme('light')).resolves.toBeUndefined();
});
