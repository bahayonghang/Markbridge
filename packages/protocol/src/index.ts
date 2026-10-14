import validate from './generated/startup-state.validator.js';
import type { StartupState } from './generated/startup-state';

export type { StartupState } from './generated/startup-state';

export function parseStartupState(value: unknown): StartupState {
  if (!validate(value)) throw new Error('INVALID_STARTUP_STATE');
  return value;
}

export * from './wire';
export * from './bridge';
export * from './ai';
export * from './organization';
export * from './maintenance';
export * from './batch-edit';
export * from './history';
export * from './diagnostics';

export * from './semantic';
