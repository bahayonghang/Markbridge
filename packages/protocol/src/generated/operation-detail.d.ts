/* Generated from crates/protocol. Run pnpm protocol:generate. */

export type Id = string;
export type SourceEpoch = number;
/**
 * A required JSON field whose value can be null. Unlike Option, absence is rejected.
 */
export type RequiredNullable3 = BookmarkNode | null;
export type TimeSource = 'chrome_api' | 'chrome_file';
export type Counter = number;
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
/**
 * A required JSON field whose value can be null. Unlike Option, absence is rejected.
 */
export type RequiredNullable4 = Receipt | null;
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
export type OperationState =
  | 'planned'
  | 'applying'
  | 'applied'
  | 'uncertain'
  | 'partial'
  | 'failed'
  | 'rolling_back'
  | 'rolled_back'
  | 'rollback_conflict';
/**
 * A required JSON field whose value can be null. Unlike Option, absence is rejected.
 */
export type RequiredNullable2 = Id | null;
export type EditField = 'title' | 'url' | 'parent' | 'position' | 'order' | 'existence';
/**
 * A required JSON field whose value can be null. Unlike Option, absence is rejected.
 */
export type RequiredNullable = ErrorCode | null;
export type HistoryKind = 'create' | 'update' | 'move' | 'delete' | 'reorder' | 'mixed' | 'undo';

export interface OperationDetail {
  profileId: Id;
  /**
   * @maxItems 1000
   */
  restored: RestoredIdentity[];
  sourceEpoch: SourceEpoch;
  /**
   * @maxItems 1000
   */
  steps: HistoryStep[];
  summary: OperationSummary;
  undoOf: RequiredNullable2;
}
export interface RestoredIdentity {
  bookmarkId: Id;
  newChromeId: Id;
  oldChromeId: Id;
}
export interface HistoryStep {
  before: RequiredNullable3;
  /**
   * @maxItems 100000
   */
  deletedDescendants?: BookmarkNode[];
  mutation: Mutation;
  receipt: RequiredNullable4;
  requestId: Id;
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
export interface Receipt {
  after?: BookmarkNode | null;
  /**
   * @maxItems 100000
   */
  afterChildIds?: Id[] | null;
  before?: BookmarkNode | null;
  /**
   * @maxItems 100000
   */
  beforeChildIds?: Id[] | null;
  errorCode?: ErrorCode | null;
  operationId: Id;
  requestId: Id;
  state: OperationState;
}
export interface OperationSummary {
  affected: Counter;
  /**
   * @maxItems 50
   */
  conflicts: OperationConflict[];
  createdAt?: Counter | null;
  errorCode: RequiredNullable;
  isBatch?: boolean;
  kind?: HistoryKind | null;
  operationId: Id;
  reviewed?: boolean;
  state: OperationState;
}
export interface OperationConflict {
  chromeId: RequiredNullable2;
  field: EditField;
  requestId: Id;
}
