import validate from './generated/installed-font-catalog.validator.js';
import type { InstalledFontCatalog } from './generated/installed-font-catalog';
export type { InstalledFontCatalog, InstalledFontFamily } from './generated/installed-font-catalog';

export function parseInstalledFontCatalog(value: unknown): InstalledFontCatalog {
  if (!validate(value)) throw new Error('INVALID_INSTALLED_FONT_CATALOG');
  return value;
}
