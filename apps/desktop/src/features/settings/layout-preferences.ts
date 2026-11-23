export type LayoutPreferences = {
  version: 1;
  sidebarWidthPx: number;
  sidebarCollapsed: boolean;
};

export const LAYOUT_PREFERENCES_KEY = 'markbridge.layout-preferences.v1';
export const DEFAULT_SIDEBAR_WIDTH_PX = 256;
export const MIN_SIDEBAR_WIDTH_PX = 200;
export const MAX_SIDEBAR_WIDTH_PX = 420;
export const MIN_MAIN_WIDTH_PX = 480;
export const FIELD_INSET_PX = 14;

export const DEFAULT_LAYOUT_PREFERENCES: LayoutPreferences = {
  version: 1,
  sidebarWidthPx: DEFAULT_SIDEBAR_WIDTH_PX,
  sidebarCollapsed: false,
};

const defaults = (): LayoutPreferences => ({ ...DEFAULT_LAYOUT_PREFERENCES });

/** Compute the upper sidebar width bound that preserves at least 480px for the main paper. */
export function maxSidebarWidth(viewportWidth?: number): number {
  if (typeof viewportWidth !== 'number' || !Number.isFinite(viewportWidth)) {
    return MAX_SIDEBAR_WIDTH_PX;
  }
  const available = Math.floor(viewportWidth - 3 * FIELD_INSET_PX - MIN_MAIN_WIDTH_PX);
  return Math.min(MAX_SIDEBAR_WIDTH_PX, Math.max(MIN_SIDEBAR_WIDTH_PX, available));
}

/** Clamp a sidebar width into [200, maxSidebarWidth(viewportWidth)] as an integer pixel value. */
export function clampSidebarWidth(widthPx: number, viewportWidth?: number): number {
  const upper = maxSidebarWidth(viewportWidth);
  const candidate = Number.isFinite(widthPx) ? Math.round(widthPx) : DEFAULT_SIDEBAR_WIDTH_PX;
  return Math.min(upper, Math.max(MIN_SIDEBAR_WIDTH_PX, candidate));
}

/** Parse persisted layout preferences safely with independent per-field fallbacks. */
export function parseLayoutPreferences(raw: string | null): LayoutPreferences {
  try {
    const value: unknown = raw == null ? null : JSON.parse(raw);
    if (!value || typeof value !== 'object' || Array.isArray(value) || !('version' in value) || value.version !== 1) {
      return defaults();
    }
    const fields = value as Record<string, unknown>;
    const rawWidth = fields.sidebarWidthPx;
    const sidebarWidthPx =
      typeof rawWidth === 'number' &&
      Number.isFinite(rawWidth) &&
      rawWidth >= MIN_SIDEBAR_WIDTH_PX &&
      rawWidth <= MAX_SIDEBAR_WIDTH_PX
        ? Math.round(rawWidth)
        : DEFAULT_SIDEBAR_WIDTH_PX;
    const sidebarCollapsed = typeof fields.sidebarCollapsed === 'boolean' ? fields.sidebarCollapsed : false;
    return {
      version: 1,
      sidebarWidthPx,
      sidebarCollapsed,
    };
  } catch {
    return defaults();
  }
}

/** Read layout preferences from storage, silently falling back to defaults on any error. */
export function readLayoutPreferences(storage?: Pick<Storage, 'getItem'>): LayoutPreferences {
  try {
    const source = storage ?? window.localStorage;
    return parseLayoutPreferences(source.getItem(LAYOUT_PREFERENCES_KEY));
  } catch {
    return defaults();
  }
}

/** Persist normalized layout preferences solely under markbridge.layout-preferences.v1. */
export function saveLayoutPreferences(value: LayoutPreferences, storage?: Pick<Storage, 'setItem'>): boolean {
  try {
    const normalized: LayoutPreferences = {
      version: 1,
      sidebarWidthPx: clampSidebarWidth(value.sidebarWidthPx),
      sidebarCollapsed: Boolean(value.sidebarCollapsed),
    };
    (storage ?? window.localStorage).setItem(LAYOUT_PREFERENCES_KEY, JSON.stringify(normalized));
    return true;
  } catch {
    return false;
  }
}
