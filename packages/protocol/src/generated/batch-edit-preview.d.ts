/* Generated from crates/protocol. Run pnpm protocol:generate. */

export type Counter = number;
/**
 * A required JSON field whose value can be null. Unlike Option, absence is rejected.
 */
export type RequiredNullable = string | null;
export type EditField = 'title' | 'url' | 'parent' | 'position' | 'order' | 'existence';
export type Id = string;
export type Title = string;
export type SourceEpoch = number;

export interface BatchEditPreview {
  affected: Counter;
  destinationPath: RequiredNullable;
  expectedRevision: Counter;
  /**
   * @minItems 1
   * @maxItems 1000
   */
  items: [BatchEditItem, ...BatchEditItem[]];
  planHash: Id;
  planId: Id;
  profileId: Id;
  requiresSecondConfirm: boolean;
  selectedCount: Counter;
  sourceEpoch: SourceEpoch;
  writable: boolean;
}
export interface BatchEditItem {
  affected: Counter;
  /**
   * @maxItems 50
   */
  changes: EditFieldChange[];
  chromeId: Id;
  path: string;
  title: Title;
}
export interface EditFieldChange {
  after: RequiredNullable;
  before: RequiredNullable;
  field: EditField;
}
