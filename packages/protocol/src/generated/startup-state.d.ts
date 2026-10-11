/* Generated from crates/protocol. Run pnpm protocol:generate. */

export type StartupConnection = 'unpaired';

/**
 * Foundation IPC state. Task 02 owns the paired transport protocol.
 */
export interface StartupState {
  protocolVersion: number;
  state: StartupConnection;
}
