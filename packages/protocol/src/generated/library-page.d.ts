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
 * One page from a cache `list` read.
 */
export interface LibraryPage {
  /**
   * @maxItems 100000
   */
  items: BookmarkNode[];
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
