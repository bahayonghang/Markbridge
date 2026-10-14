import { afterEach, expect, it, vi } from 'vitest';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { listInstalledFonts } from './backend';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(), isTauri: vi.fn() }));
afterEach(() => vi.resetAllMocks());

it('requires the native bridge and issues only the no-argument font command', async () => {
  vi.mocked(isTauri).mockReturnValue(false);
  await expect(listInstalledFonts()).rejects.toThrow('NATIVE_BRIDGE_UNAVAILABLE');
  expect(invoke).not.toHaveBeenCalled();
  vi.mocked(isTauri).mockReturnValue(true);
  const catalog = { status: 'ready', families: [{ family: 'Microsoft YaHei', displayName: '微软雅黑' }] };
  vi.mocked(invoke).mockResolvedValue(catalog);
  expect(await listInstalledFonts()).toEqual(catalog);
  expect(invoke).toHaveBeenCalledExactlyOnceWith('list_installed_fonts');
});

it('validates unknown replies and preserves stable unavailable states', async () => {
  vi.mocked(isTauri).mockReturnValue(true);
  for (const reason of ['enumeration_failed', 'unsupported_platform', 'catalog_limit']) {
    const catalog = { status: 'unavailable', reason };
    vi.mocked(invoke).mockResolvedValue(catalog);
    expect(await listInstalledFonts()).toEqual(catalog);
  }
  vi.mocked(invoke).mockResolvedValue({ status: 'ready', families: [{ family: 'Font', displayName: 'Font', path: 'C:/private' }] });
  await expect(listInstalledFonts()).rejects.toThrow('INVALID_INSTALLED_FONT_CATALOG');
  vi.mocked(invoke).mockRejectedValue(new Error('READ_ONLY'));
  await expect(listInstalledFonts()).rejects.toThrow('READ_ONLY');
});
