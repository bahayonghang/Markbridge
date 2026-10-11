/* Generated from crates/protocol. Run pnpm protocol:generate. */

export type DisplayName = string;

export interface ChromeProfileList {
  profiles: ChromeProfileChoice[];
}
export interface ChromeProfileChoice {
  bookmarksPresent: boolean;
  directoryKey: string;
  displayName: DisplayName;
}
