import { describe, expect, it } from 'vitest';
import fixture from '../../../tests/fixtures/protocol/startup-state.json';
import { parseStartupState } from './index';

describe('startup IPC validation', () => {
  it('accepts the Rust fixture', () => {
    expect(parseStartupState(fixture)).toEqual(fixture);
  });
  it.each([
    null, {}, { ...fixture, protocolVersion: 2 }, { ...fixture, state: 'live' },
    { ...fixture, token: 'forbidden' }, { ...fixture, protocolVersion: '1' },
    { ...fixture, protocolVersion: -1 }, { ...fixture, protocolVersion: 1.5 },
    { ...fixture, protocolVersion: 256 },
  ])('rejects incompatible or unexpected input: %j', (value) => {
    expect(() => parseStartupState(value)).toThrow('INVALID_STARTUP_STATE');
  });
});
