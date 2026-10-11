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
 * Flat nodes from a cache `tree` read. `chromeId` and `parentId` are unchanged.
 */
export interface LibraryNodes {
  /**
   * @maxItems 100000
   */
  nodes: BookmarkNode[];
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
