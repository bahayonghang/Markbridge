/* Generated from crates/protocol. Run pnpm protocol:generate. */

export type InstalledFontCatalog =
  | {
      /**
       * @maxItems 10000
       */
      families: InstalledFontFamily[];
      status: 'ready';
    }
  | {
      reason: FontCatalogUnavailableReason;
      status: 'unavailable';
    };
export type FontCatalogUnavailableReason = 'unsupported_platform' | 'enumeration_failed' | 'catalog_limit';

export interface InstalledFontFamily {
  displayName: string;
  family: string;
}
