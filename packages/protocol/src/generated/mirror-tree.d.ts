/* Generated from crates/protocol. Run pnpm protocol:generate. */

export type MirrorAssociation = 'independent' | 'confirmed';
export type DisplayName = string;
/**
 * A required JSON field whose value can be null. Unlike Option, absence is rejected.
 */
export type RequiredNullable2 = ErrorCode | null;
export type ErrorCode =
  | (
      | 'INVALID_MESSAGE'
      | 'UNSUPPORTED_VERSION'
      | 'FRAME_TOO_LARGE'
      | 'LIMIT_EXCEEDED'
      | 'INVALID_TREE'
      | 'UNPAIRED'
      | 'READ_ONLY'
      | 'WRONG_PROFILE'
      | 'STALE_PROPOSAL'
      | 'PROTECTED_NODE'
      | 'UNCERTAIN_WRITE'
      | 'FETCH_DENIED'
      | 'INVALID_AI_OUTPUT'
      | 'STORAGE_ERROR'
      | 'STORAGE_NEWER_SCHEMA'
      | 'MIGRATION_FAILED'
      | 'CONFLICT'
      | 'CANCELLED'
    )
  | 'PATH_UNAVAILABLE';
export type MirrorFileStatus = 'current' | 'stale' | 'unavailable';
/**
 * A required JSON field whose value can be null. Unlike Option, absence is rejected.
 */
export type RequiredNullable = Counter | null;
export type Counter = number;
export type Id = string;
export type TimeSource = 'chrome_api' | 'chrome_file';
export type FolderType = 'bookmarks-bar' | 'other' | 'mobile' | 'managed';
export type NodeKind = 'folder' | 'bookmark';
export type Position = number;
export type Title = string;
export type Unmodifiable = 'managed';
export type Url = string;

export interface MirrorTree {
  association: MirrorAssociation;
  canWriteBrowser: false;
  displayName: DisplayName;
  errorCode: RequiredNullable2;
  fileStatus: MirrorFileStatus;
  lastSyncedAt: RequiredNullable;
  mirrorSourceId: Id;
  /**
   * @maxItems 100000
   */
  nodes: BookmarkNode[];
  revision: Counter;
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
