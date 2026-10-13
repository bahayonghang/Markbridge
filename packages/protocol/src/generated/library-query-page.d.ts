/* Generated from crates/protocol. Run pnpm protocol:generate. */

export type Id = string;
export type TimeSource = 'chrome_api' | 'chrome_file';
export type Counter = number;
export type FolderType = 'bookmarks-bar' | 'other' | 'mobile' | 'managed';
export type NodeKind = 'folder' | 'bookmark';
export type Position = number;
export type Title = string;
export type Unmodifiable = 'managed';
export type Url = string;
/**
 * A required JSON field whose value can be null. Unlike Option, absence is rejected.
 */
export type RequiredNullable = Counter | null;
export type SourceEpoch = number;

export interface LibraryQueryPage {
  /**
   * @maxItems 200
   */
  items: BookmarkNode[];
  nextOffset: RequiredNullable;
  offset: Counter;
  revision: Counter;
  sourceEpoch: SourceEpoch;
  total: Counter;
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
