/* Generated from crates/protocol. Run pnpm protocol:generate. */

export type Counter = number;
/**
 * A required JSON field whose value can be null. Unlike Option, absence is rejected.
 */
export type RequiredNullable2 = Id | null;
export type Id = string;
export type EditField = 'title' | 'url' | 'parent' | 'position' | 'order' | 'existence';
/**
 * A required JSON field whose value can be null. Unlike Option, absence is rejected.
 */
export type RequiredNullable = ErrorCode | null;
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
export type SourceEpoch = number;
export type TimeSource = 'chrome_api' | 'chrome_file';
export type FolderType = 'bookmarks-bar' | 'other' | 'mobile' | 'managed';
export type NodeKind = 'folder' | 'bookmark';
export type Position = number;
export type Title = string;
export type Unmodifiable = 'managed';
export type Url = string;
export type Mutation =
  | {
      kind: 'create';
      parentId: Id;
      position: Position;
      title: Title;
      url?: Url | null;
    }
  | {
      kind: 'update';
      title?: Title | null;
      url?: Url | null;
    }
  | {
      kind: 'move';
      parentId: Id;
      position: Position;
    }
  | {
      /**
       * @maxItems 100000
       */
      childIds: Id[];
      kind: 'reorder';
    }
  | {
      kind: 'delete';
    };

export interface UndoPreview {
  affected: Counter;
  /**
   * @maxItems 1000
   */
  conflicts: OperationConflict[];
  errorCode: RequiredNullable;
  expectedRevision: Counter;
  operationId: Id;
  profileId: Id;
  sourceEpoch: SourceEpoch;
  /**
   * @maxItems 1000
   */
  steps: OperationStep[];
  writable: boolean;
}
export interface OperationConflict {
  chromeId: RequiredNullable2;
  field: EditField;
  requestId: Id;
}
export interface OperationStep {
  expectedBefore?: BookmarkNode | null;
  /**
   * @maxItems 100000
   */
  expectedChildIds?: Id[] | null;
  /**
   * Optional reviewed subtree for daily grouped move/delete operations.
   *
   * @minItems 1
   * @maxItems 100000
   */
  expectedSubtree?: [BookmarkNode, ...BookmarkNode[]] | null;
  payload: Mutation;
  requestId: Id;
  target?: Id | null;
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
