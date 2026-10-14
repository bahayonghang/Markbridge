import { afterEach, expect, it, vi } from 'vitest';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { semanticSettings, saveSemanticConfig, checkSemanticModel, reviewSemanticScope, startSemanticIndex, semanticStatus,
  pauseSemanticIndex, resumeSemanticIndex, deleteSemanticIndex, querySemantic, cancelSemanticQuery } from './backend';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(), isTauri: vi.fn() }));
afterEach(() => vi.resetAllMocks());
const settings = { enabled: false, endpointLabel: null, model: null, inputRecipeVersion: 1, maxInputChars: 8192, maxInputBytes: 32768 };
const scope = { profileId: 'profile-a', sourceEpoch: 1, expectedRevision: 8, selectedChromeIds: ['10'], folderId: null };
const query = { requestId: 'sq-test', profileId: 'profile-a', sourceEpoch: 1, indexId: 'index-a', generation: 1, text: '键盘阅读', topK: 5 };

it('all semantic browser-preview entrypoints reject without native invocation', async () => {
  vi.mocked(isTauri).mockReturnValue(false);
  const commands = [semanticSettings(), saveSemanticConfig({ enabled: false, endpoint: null, model: null }), checkSemanticModel('http://localhost:11434', 'local'),
    reviewSemanticScope(scope), startSemanticIndex('review-a'), semanticStatus('profile-a', 1), pauseSemanticIndex('profile-a', 1),
    resumeSemanticIndex('profile-a', 1), deleteSemanticIndex('profile-a', 1), querySemantic(query), cancelSemanticQuery('profile-a', 'sq-test')];
  await Promise.all(commands.map(command => expect(command).rejects.toThrow('NATIVE_BRIDGE_UNAVAILABLE')));
  expect(invoke).not.toHaveBeenCalled();
});

it('settings reads and disabled saves issue only their exact IPC command', async () => {
  vi.mocked(isTauri).mockReturnValue(true); vi.mocked(invoke).mockResolvedValue(settings);
  expect(await semanticSettings()).toEqual(settings);
  await saveSemanticConfig({ enabled: false, endpoint: null, model: null });
  expect(invoke).toHaveBeenNthCalledWith(1, 'semantic_settings');
  expect(invoke).toHaveBeenNthCalledWith(2, 'save_semantic_config', { config: { enabled: false, endpoint: null, model: null } });
  expect(invoke).toHaveBeenCalledTimes(2);
});

it('semantic scope/config/query input validation prevents extra private fields from reaching IPC', async () => {
  vi.mocked(isTauri).mockReturnValue(true);
  const privateConfig = { enabled: false, endpoint: null, model: null, secret: 'private' };
  await expect(saveSemanticConfig(privateConfig)).rejects.toThrow('INVALID_SEMANTIC_CONFIG');
  const privateScope = { ...scope, note: 'private' };
  await expect(reviewSemanticScope(privateScope)).rejects.toThrow('INVALID_SEMANTIC_SCOPE');
  const privateQuery = { ...query, url: 'https://example.com/private' };
  await expect(querySemantic(privateQuery)).rejects.toThrow('INVALID_SEMANTIC_QUERY');
  await expect(querySemantic({ ...query, text: '' })).rejects.toThrow('INVALID_SEMANTIC_QUERY');
  expect(invoke).not.toHaveBeenCalled();
});

it('query sends versioned identity and text only and rejects vectors/URLs returned in hits', async () => {
  vi.mocked(isTauri).mockReturnValue(true);
  const result = { requestId: query.requestId, profileId: query.profileId, sourceEpoch: query.sourceEpoch, indexId: query.indexId, generation: query.generation,
    hits: [{ bookmarkId: 'bm-a', chromeId: '10', title: 'Keyboard navigation', score: 0.8 }], failure: null, failureMessage: null };
  vi.mocked(invoke).mockResolvedValue(result);
  expect(await querySemantic(query)).toEqual(result);
  expect(invoke).toHaveBeenCalledWith('semantic_query', { query });
  for (const field of [{ vector: [0.2, 0.8] }, { url: 'https://example.com/private' }, { note: 'private' }]) {
    vi.mocked(invoke).mockResolvedValue({ ...result, hits: [{ ...result.hits[0], ...field }] });
    await expect(querySemantic(query)).rejects.toThrow('INVALID_SEMANTIC_RESULT');
  }
});

it('status mutations bind profile and epoch, and cancel binds the original query request', async () => {
  vi.mocked(isTauri).mockReturnValue(true); vi.mocked(invoke).mockResolvedValue({ settings, index: null });
  for (const command of [semanticStatus, pauseSemanticIndex, resumeSemanticIndex, deleteSemanticIndex]) await command('profile-a', 2);
  await startSemanticIndex('review-a');
  await cancelSemanticQuery('profile-a', 'sq-test');
  expect(vi.mocked(invoke).mock.calls).toEqual([
    ['semantic_status', { profileId: 'profile-a', sourceEpoch: 2 }], ['semantic_pause', { profileId: 'profile-a', sourceEpoch: 2 }],
    ['semantic_resume', { profileId: 'profile-a', sourceEpoch: 2 }], ['semantic_delete_index', { profileId: 'profile-a', sourceEpoch: 2 }],
    ['semantic_start_index', { reviewId: 'review-a' }], ['semantic_cancel_query', { profileId: 'profile-a', requestId: 'sq-test' }],
  ]);
});
