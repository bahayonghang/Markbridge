import { describe, expect, it } from 'vitest';
import { parseSemanticModelCheck, parseSemanticQuery, parseSemanticQueryResult, parseSemanticScope, parseSemanticScopeReview, parseSemanticSettings, parseSemanticStatus } from './semantic';

const settings = { enabled: false, endpointLabel: null, model: null, inputRecipeVersion: 1, maxInputChars: 8192, maxInputBytes: 32768 };
const index = { indexId: 'index', profileId: 'profile', sourceEpoch: 1, generation: 1, phase: 'ready', model: 'embed', digest: 'a'.repeat(64), dimension: 2, total: 1, ready: 1, pending: 0, storedBytes: 8, failure: null, failureMessage: null };
const query = { requestId: 'q', profileId: 'profile', sourceEpoch: 1, indexId: 'index', generation: 1, text: 'synthetic', topK: 5 };

describe('semantic DTO validation', () => {
  it('accepts default-off status and a consistent ready index', () => {
    expect(parseSemanticSettings(settings)).toEqual(settings);
    expect(parseSemanticStatus({ settings, index })).toEqual({ settings, index });
  });
  it('rejects invalid dimensions, progress, recipe, secret fields and zero generations', () => {
    for (const patch of [{ dimension: 0 }, { dimension: 4097 }, { total: 10001 }, { pending: 1 }, { storedBytes: 12 }, { generation: 0 }, { model: 'm'.repeat(129) }, { secret: 'canary' }]) {
      expect(() => parseSemanticStatus({ settings, index: { ...index, ...patch } })).toThrow('INVALID_SEMANTIC_STATUS');
    }
    expect(() => parseSemanticSettings({ ...settings, maxInputChars: 999 })).toThrow();
  });
  it('requires a unique nonempty selection or explicit folder and bounded scope review', () => {
    const scope = { profileId: 'profile', sourceEpoch: 1, expectedRevision: 1, selectedChromeIds: ['1'], folderId: null };
    expect(parseSemanticScope(scope)).toEqual(scope);
    for (const patch of [{ selectedChromeIds: [] }, { selectedChromeIds: ['1', '1'] }, { folderId: '0' }]) expect(() => parseSemanticScope({ ...scope, ...patch })).toThrow();
    const review = { reviewId: 'review', profileId: 'profile', sourceEpoch: 1, expectedRevision: 1, count: 1, clippedCount: 0, upperBytes: 16384, model: 'embed', inputRecipeVersion: 1, maxInputChars: 8192, maxInputBytes: 32768 };
    expect(parseSemanticScopeReview(review)).toEqual(review);
    for (const patch of [{ count: 0 }, { count: 10001 }, { clippedCount: 2 }, { upperBytes: 8 }]) expect(() => parseSemanticScopeReview({ ...review, ...patch })).toThrow();
  });
  it('rejects blank/oversized query and untrusted vector payloads or inconsistent hits', () => {
    expect(parseSemanticQuery(query)).toEqual(query);
    for (const patch of [{ text: '  ' }, { text: 'x'.repeat(4097) }, { topK: 0 }, { topK: 51 }, { generation: 0 }]) expect(() => parseSemanticQuery({ ...query, ...patch })).toThrow();
    const result = { ...query, hits: [{ bookmarkId: 'bookmark', chromeId: '1', title: 'synthetic', score: 0.5 }], failure: null, failureMessage: null };
    const valid = { requestId: result.requestId, profileId: result.profileId, sourceEpoch: result.sourceEpoch, indexId: result.indexId, generation: result.generation, hits: result.hits, failure: result.failure, failureMessage: result.failureMessage };
    expect(parseSemanticQueryResult(valid)).toEqual(valid);
    for (const patch of [{ vector: [1, 0] }, { failure: 'CANCELLED', failureMessage: 'cancelled' }, { hits: [...valid.hits, ...valid.hits] }, { hits: [{ ...valid.hits[0], score: 1.01 }] }]) expect(() => parseSemanticQueryResult({ ...valid, ...patch })).toThrow();
  });
  it('requires metadata-only model check facts to agree', () => {
    const check = { available: true, model: 'embed', digest: 'a'.repeat(64), dimension: 2, failure: null, failureMessage: null };
    expect(parseSemanticModelCheck(check)).toEqual(check);
    for (const patch of [{ available: false }, { digest: null }, { dimension: 4097 }, { failure: 'REMOTE_MODEL' }]) expect(() => parseSemanticModelCheck({ ...check, ...patch })).toThrow();
  });
});

it('rejects unpaired UTF-16 surrogates but accepts valid scalar pairs at query boundary', () => {
  expect(parseSemanticQuery({ ...query, text: '😀'.repeat(4096) }).text).toHaveLength(8192);
  for (const text of ['\uD800', '\uDC00', 'prefix\uD800suffix']) expect(() => parseSemanticQuery({ ...query, text })).toThrow('INVALID_SEMANTIC_QUERY');
  expect(() => parseSemanticStatus({ settings, index: { ...index, model: '\uD800' } })).toThrow('INVALID_SEMANTIC_STATUS');
  expect(() => parseSemanticQueryResult({ requestId: 'q', profileId: 'profile', sourceEpoch: 1, indexId: 'index', generation: 1, hits: [{ bookmarkId: 'b', chromeId: '1', title: '\uDC00', score: 0 }], failure: null, failureMessage: null })).toThrow('INVALID_SEMANTIC_RESULT');
});
