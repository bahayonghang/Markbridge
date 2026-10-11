/* Generated from crates/protocol. Run pnpm protocol:generate. */

export type Counter = number;
export type Id = string;
/**
 * A required JSON field whose value can be null. Unlike Option, absence is rejected.
 */
export type RequiredNullable2 = string | null;
/**
 * A required JSON field whose value can be null. Unlike Option, absence is rejected.
 */
export type RequiredNullable = Id | null;
export type TimeSource = 'chrome_api' | 'chrome_file';
export type FolderType = 'bookmarks-bar' | 'other' | 'mobile' | 'managed';
export type NodeKind = 'folder' | 'bookmark';
export type Position = number;
export type Title = string;
export type Unmodifiable = 'managed';
export type Url = string;

/**
 * Tags, notes, and encoding state for one profile. Matches are empty when no tag filter is set.
 */
export interface TagCatalog {
  affected: Counter;
  encodingEnabled: boolean;
  /**
   * @maxItems 1000
   */
  entries: TagEntry[];
  filterTagId: RequiredNullable;
  journalId: RequiredNullable;
  /**
   * @maxItems 100000
   */
  matches: BookmarkNode[];
  mergeRequired: boolean;
  profileId: Id;
  sourceTagId: RequiredNullable;
  /**
   * @maxItems 100000
   */
  tags: TagItem[];
  targetTagId: RequiredNullable;
}
export interface TagEntry {
  bookmarkId: Id;
  chromeId: Id;
  conflict: boolean;
  lastEncodedTitle: RequiredNullable2;
  note: string;
  rawTitle: RequiredNullable2;
  /**
   * @maxItems 50
   */
  tagIds: Id[];
}
export interface BookmarkNode {
  chromeId: Id;
  dateAdded?: SourceTime | null;
  dateLastUsed?: SourceTime | null;
  folderType?: FolderType | null;
  kind: NodeKind;
  parentId?: Id | null;
  position: Position;
  title: Title;
  unmodifiable?: Unmodifiable | null;
  url?: Url | null;
}
export interface SourceTime {
  source: TimeSource;
  unixMillis: Counter;
}
export interface TagItem {
  count: Counter;
  name: string;
  tagId: Id;
}
