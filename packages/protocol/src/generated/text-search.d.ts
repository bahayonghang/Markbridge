/* Generated from crates/protocol. Run pnpm protocol:generate. */

export type Id = string;

export interface TextSearchPage {
  /**
   * @maxItems 50
   */
  hits: TextHit[];
  profileId: Id;
  query: string;
}
export interface TextHit {
  bookmarkId: Id;
  chromeId: Id;
  note: string;
  summary: string;
  title: string;
}
