import { expect, it } from 'vitest';
import { parseInstalledFontCatalog } from './ui-fonts';

const font = { family: 'Microsoft YaHei', displayName: '微软雅黑' };
const ready = { status: 'ready', families: [font] };

it('accepts bounded scalar names, empty lists, and only stable failure reasons', () => {
  expect(parseInstalledFontCatalog(ready)).toEqual(ready);
  expect(parseInstalledFontCatalog({ status: 'ready', families: [] })).toEqual({ status: 'ready', families: [] });
  const astral = { status: 'ready', families: [{ family: '𠮷'.repeat(256), displayName: '𠮷'.repeat(256) }] };
  expect(parseInstalledFontCatalog(astral)).toEqual(astral);
  expect(parseInstalledFontCatalog({ status: 'ready', families: Array.from({ length: 10000 }, () => font) }).status).toBe('ready');
  for (const reason of ['unsupported_platform', 'enumeration_failed', 'catalog_limit']) {
    expect(parseInstalledFontCatalog({ status: 'unavailable', reason })).toEqual({ status: 'unavailable', reason });
  }
});

it('rejects control characters, broken Unicode, oversized lists and cross-variant fields', () => {
  for (const family of ['', 'x\n', 'x\r', 'x\t', 'x\u0000', 'x\u007f', 'x\u0085', '\ud800', '\udfff', 'x'.repeat(257), '𠮷'.repeat(257)]) {
    for (const field of ['family', 'displayName']) {
      expect(() => parseInstalledFontCatalog({ status: 'ready', families: [{ ...font, [field]: family }] })).toThrow('INVALID_INSTALLED_FONT_CATALOG');
    }
  }
  for (const value of [
    { status: 'ready', families: Array.from({ length: 10001 }, () => font) },
    { status: 'ready', families: [font], reason: 'enumeration_failed' },
    { status: 'unavailable', reason: 'enumeration_failed', families: [] },
    { status: 'unavailable', reason: 'raw OS error' },
    { status: 'ready' },
  ]) expect(() => parseInstalledFontCatalog(value)).toThrow('INVALID_INSTALLED_FONT_CATALOG');
});

it('rejects paths, bytes and any unrecognized fields at every object boundary', () => {
  for (const field of ['path', 'bytes', 'url', 'file', 'token']) {
    for (const value of [
      { ...ready, [field]: 'private' },
      { status: 'ready', families: [{ ...font, [field]: 'private' }] },
      { status: 'unavailable', reason: 'enumeration_failed', [field]: 'private' },
    ]) expect(() => parseInstalledFontCatalog(value)).toThrow('INVALID_INSTALLED_FONT_CATALOG');
  }
});
