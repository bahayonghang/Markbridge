/* Generated from crates/protocol. Run pnpm protocol:generate. */

/**
 * A required JSON field whose value can be null. Unlike Option, absence is rejected.
 */
export type RequiredNullable2 = Counter | null;
export type Counter = number;
/**
 * A required JSON field whose value can be null. Unlike Option, absence is rejected.
 */
export type RequiredNullable3 = SourceEpoch | null;
export type SourceEpoch = number;
/**
 * A required JSON field whose value can be null. Unlike Option, absence is rejected.
 */
export type RequiredNullable = Id | null;
export type Id = string;
export type FolderScope = 'children' | 'subtree' | 'all';
export type Title = string;

export interface LibraryQuery {
  expectedRevision: RequiredNullable2;
  expectedSourceEpoch: RequiredNullable3;
  folderId: RequiredNullable;
  folderScope: FolderScope;
  includeNote: boolean;
  includeSummary: boolean;
  limit: Counter;
  offset: Counter;
  query: Title;
  /**
   * @maxItems 64
   */
  tagIds: Id[];
}
