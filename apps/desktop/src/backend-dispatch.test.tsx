import { afterEach, expect, it, vi } from 'vitest';
import { invoke, isTauri } from '@tauri-apps/api/core';
import type * as Backend from './backend';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(), isTauri: vi.fn() }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn() }));

const cases = [
  { command: 'content_preview', cancelCommand: 'cancel_content_preview', module: '@markbridge/protocol/bridge', parser: 'parseContentPreview',
    start: (backend: typeof Backend) => backend.readContentPreview('profile-a', '10', 'request-a'), cancel: (backend: typeof Backend) => backend.cancelContentPreview('request-a') },
  { command: 'suggest_ai', cancelCommand: 'cancel_ai', module: '@markbridge/protocol/ai', parser: 'parseAiSuggestion',
    start: (backend: typeof Backend) => backend.suggestAi('profile-a', '10', 'request-a'), cancel: (backend: typeof Backend) => backend.cancelAi('request-a') },
  { command: 'propose_organization', cancelCommand: 'cancel_ai', module: '@markbridge/protocol/organization', parser: 'parseOrganizationPlan',
    start: (backend: typeof Backend) => backend.proposeOrganization('profile-a', ['10'], 'request-a'), cancel: (backend: typeof Backend) => backend.cancelAi('request-a') },
  { command: 'check_links', cancelCommand: 'cancel_link_check', module: '@markbridge/protocol/maintenance', parser: 'parseMaintenanceReport',
    start: (backend: typeof Backend) => backend.checkLinks('profile-a', ['10'], 'request-a'), cancel: (backend: typeof Backend) => backend.cancelLinkCheck('request-a') },
];

afterEach(() => {
  for (const entry of cases) vi.doUnmock(entry.module);
  vi.resetAllMocks();
  vi.resetModules();
});

for (const entry of cases) {
  it(`dispatches ${entry.command} before its cancellation while the protocol chunk is pending`, async () => {
    vi.resetModules();
    vi.mocked(isTauri).mockReturnValue(true);
    const response = { requestId: 'request-a' };
    vi.mocked(invoke).mockResolvedValue(response);
    let release!: () => void;
    const loaded = new Promise<void>(resolve => { release = resolve; });
    const parse = vi.fn((value: unknown) => value);
    vi.doMock(entry.module, async () => { await loaded; return { [entry.parser]: parse }; });
    const backend = await import('./backend');
    const pending = entry.start(backend);
    try {
      await entry.cancel(backend);
      expect(vi.mocked(invoke).mock.calls.map(([command]) => command)).toEqual([entry.command, entry.cancelCommand]);
      expect(invoke).toHaveBeenCalledWith(entry.cancelCommand, { requestId: 'request-a' });
      expect(parse).not.toHaveBeenCalled();
    } finally {
      release();
      await pending;
    }
    expect(parse).toHaveBeenCalledExactlyOnceWith(response);
  });
}
