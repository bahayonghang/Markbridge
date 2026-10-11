/* Generated from crates/protocol. Run pnpm protocol:generate. */

export type WireMessage =
  | {
      payload: PairPayload;
      profileId: Id;
      protocolVersion: Version;
      requestId: RequiredNullable;
      seq: RequiredNullable2;
      sessionId: Id;
      type: 'pair';
    }
  | {
      payload: PairResultPayload;
      profileId: Id;
      protocolVersion: Version;
      requestId: RequiredNullable;
      seq: RequiredNullable2;
      sessionId: Id;
      type: 'pair_result';
    }
  | {
      payload: HelloPayload;
      profileId: Id;
      protocolVersion: Version;
      requestId: RequiredNullable;
      seq: RequiredNullable2;
      sessionId: Id;
      type: 'hello';
    }
  | {
      payload: HelloResultPayload;
      profileId: Id;
      protocolVersion: Version;
      requestId: RequiredNullable;
      seq: RequiredNullable2;
      sessionId: Id;
      type: 'hello_result';
    }
  | {
      payload: EmptyPayload;
      profileId: Id;
      protocolVersion: Version;
      requestId: RequiredNullable;
      seq: RequiredNullable2;
      sessionId: Id;
      type: 'ping';
    }
  | {
      payload: EmptyPayload;
      profileId: Id;
      protocolVersion: Version;
      requestId: RequiredNullable;
      seq: RequiredNullable2;
      sessionId: Id;
      type: 'pong';
    }
  | {
      payload: EmptyPayload;
      profileId: Id;
      protocolVersion: Version;
      requestId: RequiredNullable;
      seq: RequiredNullable2;
      sessionId: Id;
      type: 'get_tree';
    }
  | {
      payload: TreeSnapshot;
      profileId: Id;
      protocolVersion: Version;
      requestId: RequiredNullable;
      seq: RequiredNullable2;
      sessionId: Id;
      type: 'tree_full';
    }
  | {
      payload: EventPayload;
      profileId: Id;
      protocolVersion: Version;
      requestId: RequiredNullable;
      seq: RequiredNullable2;
      sessionId: Id;
      type: 'event';
    }
  | {
      payload: ResyncPayload;
      profileId: Id;
      protocolVersion: Version;
      requestId: RequiredNullable;
      seq: RequiredNullable2;
      sessionId: Id;
      type: 'resync_required';
    }
  | {
      payload: ApplyPayload;
      profileId: Id;
      protocolVersion: Version;
      requestId: RequiredNullable;
      seq: RequiredNullable2;
      sessionId: Id;
      type: 'apply_operation';
    }
  | {
      payload: Receipt;
      profileId: Id;
      protocolVersion: Version;
      requestId: RequiredNullable;
      seq: RequiredNullable2;
      sessionId: Id;
      type: 'operation_receipt';
    }
  | {
      payload: StatusPayload;
      profileId: Id;
      protocolVersion: Version;
      requestId: RequiredNullable;
      seq: RequiredNullable2;
      sessionId: Id;
      type: 'get_operation_status';
    };
export type Credential = string;
export type DisplayName = string;
export type Id = string;
export type Version = number;
/**
 * A required JSON field whose value can be null. Unlike Option, absence is rejected.
 */
export type RequiredNullable = Id | null;
/**
 * A required JSON field whose value can be null. Unlike Option, absence is rejected.
 */
export type RequiredNullable2 = Counter | null;
export type Counter = number;
export type ErrorCode =
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
  | 'CANCELLED';
export type SourceEpoch = number;
export type TimeSource = 'chrome_api' | 'chrome_file';
export type FolderType = 'bookmarks-bar' | 'other' | 'mobile' | 'managed';
export type NodeKind = 'folder' | 'bookmark';
export type Position = number;
export type Title = string;
export type Unmodifiable = 'managed';
export type Url = string;
export type BookmarkEvent =
  | {
      kind: 'created';
      node: BookmarkNode;
    }
  | {
      chromeId: Id;
      kind: 'changed';
      title: Title;
      url?: Url | null;
    }
  | {
      chromeId: Id;
      kind: 'moved';
      oldParentId: Id;
      oldPosition: Position;
      parentId: Id;
      position: Position;
    }
  | {
      chromeId: Id;
      kind: 'removed';
      parentId: Id;
      position: Position;
      /**
       * @maxItems 100000
       */
      subtree: BookmarkNode[];
    }
  | {
      /**
       * @maxItems 100000
       */
      childIds: Id[];
      kind: 'reordered';
      parentId: Id;
    }
  | {
      kind: 'import_began';
    }
  | {
      kind: 'import_ended';
    };
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

export interface PairPayload {
  credential: Credential;
  displayName: DisplayName;
  instanceId: Id;
}
export interface PairResultPayload {
  accepted: boolean;
  credential?: Credential | null;
  errorCode?: ErrorCode | null;
}
export interface HelloPayload {
  credential: Credential;
  instanceId: Id;
}
export interface HelloResultPayload {
  accepted: boolean;
  errorCode?: ErrorCode | null;
  sourceEpoch: SourceEpoch;
}
export interface EmptyPayload {}
export interface TreeSnapshot {
  barrierSeq: Counter;
  /**
   * @maxItems 100000
   */
  nodes: BookmarkNode[];
  revision: Counter;
  sourceEpoch: SourceEpoch;
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
export interface EventPayload {
  event: BookmarkEvent;
  sourceEpoch: SourceEpoch;
}
export interface ResyncPayload {
  reason: ErrorCode;
}
export interface ApplyPayload {
  expectedRevision: Counter;
  operationId: Id;
  sourceEpoch: SourceEpoch;
  /**
   * @minItems 1
   * @maxItems 1000
   */
  steps: [OperationStep, ...OperationStep[]];
}
export interface OperationStep {
  expectedBefore?: BookmarkNode | null;
  /**
   * @maxItems 100000
   */
  expectedChildIds?: Id[] | null;
  payload: Mutation;
  requestId: Id;
  target?: Id | null;
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
export interface StatusPayload {
  operationId: Id;
}
