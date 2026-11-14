import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { semanticQueryObserver } from './semantic-query-observer.mjs';

const expected = { profileId: 'semantic-fixture-a', sourceEpoch: 1, indexId: 'index-a', generation: 1, text: 'fixture query' };
const query = { ...expected, requestId: 'sq-fixture', topK: 5 };
const result = { requestId: query.requestId, profileId: query.profileId, sourceEpoch: 1, indexId: query.indexId, generation: 1,
  failure: null, failureMessage: null, hits: [{ bookmarkId: 'bookmark-a', chromeId: 'b1', title: 'Fixture', score: 0.9 }] };

function nativePage() {
  const events = new EventEmitter();
  const page = {
    waitForResponse(predicate) {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { events.off('response', receive); reject(new Error('timeout')); }, 30);
        function receive(response) { if (predicate(response)) { clearTimeout(timer); events.off('response', receive); resolve(response); } }
        events.on('response', receive);
      });
    },
    respond(command, value, payload = {}, { ok = true, nativeOk = true, origin = 'http://ipc.localhost' } = {}) {
      events.emit('response', { url: () => `${origin}/${command}`, ok: () => ok,
        headers: () => ({ 'tauri-response': nativeOk ? 'ok' : 'error' }), json: async () => structuredClone(value),
        request: () => ({ method: () => 'POST', postDataJSON: () => structuredClone(payload) }) });
    },
  };
  const internals = {};
  Object.defineProperty(internals, 'invoke', { value: async (command, payload = {}) => {
    const value = command === 'get_bridge_state' ? { profiles: [] } : result;
    page.respond(command, value, payload);
    return structuredClone(value);
  } });
  return { page, internals, observer: semanticQueryObserver(page) };
}

test('calibrated native request/response observation works with immutable invoke and top-five UI request', async () => {
  const { page, internals, observer } = nativePage();
  const original = internals.invoke;
  assert.equal(Object.getOwnPropertyDescriptor(internals, 'invoke').writable, false);
  assert.throws(() => { internals.invoke = () => {}; }, TypeError);
  assert.deepEqual(await observer.calibrate(command => internals.invoke(command)), { command: 'get_bridge_state', observedResponse: true });
  const observed = await observer.query(expected, () => internals.invoke('semantic_query', { query }));
  assert.deepEqual(observed, result);
  assert.equal(internals.invoke, original);
  // A response from an ordinary HTTP page is not a native IPC observation.
  await assert.rejects(observer.query(expected, () => page.respond('semantic_query', result, { query }, { origin: 'https://example.invalid' })), /IPC_OBSERVER_RESPONSE_MISSING/);
});

test('uncalibrated and empty observers cannot become passing evidence', async () => {
  const { observer } = nativePage();
  let submitted = false;
  await assert.rejects(observer.query(expected, () => { submitted = true; }), /IPC_OBSERVER_NOT_CALIBRATED/);
  assert.equal(submitted, false);
  await assert.rejects(observer.calibrate(async () => ({ profiles: [] })), /IPC_OBSERVER_RESPONSE_MISSING/);
  await assert.rejects(observer.query(expected, () => {}), /IPC_OBSERVER_NOT_CALIBRATED/);
});

test('calibration rejects mismatched responses and Tauri error callbacks', async () => {
  const { page, observer } = nativePage();
  await assert.rejects(observer.calibrate(async () => {
    page.respond('get_bridge_state', { profiles: [] }); return { profiles: ['different'] };
  }), /IPC_OBSERVER_CALIBRATION_MISMATCH/);
  await assert.rejects(observer.calibrate(() => page.respond('get_bridge_state', {}, {}, { nativeOk: false })), /IPC_OBSERVER_COMMAND_FAILED/);
});

test('query observation rejects stale identities, wrong input/topK, malformed results and duplicate hits', async () => {
  const { page, internals, observer } = nativePage();
  await observer.calibrate(command => internals.invoke(command));
  for (const change of [{ text: 'different' }, { profileId: 'other' }, { sourceEpoch: 2 }, { indexId: 'other' }, { generation: 2 }, { topK: 50 }]) {
    await assert.rejects(observer.query(expected, () => page.respond('semantic_query', result, { query: { ...query, ...change } })), /UI_QUERY_REQUEST_MISMATCH/);
  }
  for (const change of [{ requestId: 'old' }, { profileId: 'other' }, { sourceEpoch: 2 }, { indexId: 'other' }, { generation: 2 },
    { failure: 'CANCELLED', failureMessage: 'cancelled', hits: [] }, { hits: [result.hits[0], result.hits[0]] },
    { hits: [{ ...result.hits[0], score: 'invalid' }] }]) {
    await assert.rejects(observer.query(expected, () => page.respond('semantic_query', { ...result, ...change }, { query })), /UI_RESULT_IDENTITY_INVALID/);
  }
});

test('no-argument evaluator exits NOT_RUN without loading native drivers or a model', async () => {
  const { stdout, stderr } = await promisify(execFile)(process.execPath, [fileURLToPath(new URL('./evaluate-real-model.mjs', import.meta.url))], { windowsHide: true, timeout: 15000 });
  assert.match(stdout, /^V18 NOT_RUN:/);
  assert.equal(stderr, '');
});
