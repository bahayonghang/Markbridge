/* Generated from crates/protocol. Run pnpm protocol:generate. */

export type Counter = number;

/**
 * Folder and bookmark totals from a cache `count` read.
 */
export interface LibraryCount {
  bookmarks: Counter;
  folders: Counter;
}
