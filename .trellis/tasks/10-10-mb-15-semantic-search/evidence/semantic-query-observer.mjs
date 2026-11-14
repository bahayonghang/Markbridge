import assert from 'node:assert/strict';
import validateResult from '../../../../packages/protocol/src/generated/semantic-result.validator.js';

function isCommand(response, command) {
  const url = new URL(response.url());
  return (url.hostname === 'ipc.localhost' || url.protocol === 'ipc:') && url.pathname === `/${command}`;
}

// Observe native fetch IPC without changing Tauri's non-writable invoke property.
export function semanticQueryObserver(page) {
  let calibrated = false;
  async function observe(command, action) {
    const pending = page.waitForResponse(response => isCommand(response, command), { timeout: 20000 })
      .catch(() => { throw new Error('IPC_OBSERVER_RESPONSE_MISSING'); });
    const [response, returned] = await Promise.all([pending, action()]);
    assert.ok(response.ok() && response.headers()['tauri-response'] === 'ok', 'IPC_OBSERVER_COMMAND_FAILED');
    return { response, value: await response.json(), returned };
  }
  return {
    async calibrate(invoke) {
      calibrated = false;
      const { value, returned } = await observe('get_bridge_state', () => invoke('get_bridge_state'));
      assert.ok(value && typeof value === 'object' && JSON.stringify(value) === JSON.stringify(returned), 'IPC_OBSERVER_CALIBRATION_MISMATCH');
      calibrated = true;
      return { command: 'get_bridge_state', observedResponse: true };
    },
    async query(expected, submit) {
      assert.ok(calibrated, 'IPC_OBSERVER_NOT_CALIBRATED');
      const { response, value } = await observe('semantic_query', submit);
      const query = response.request().postDataJSON()?.query;
      assert.ok(response.request().method() === 'POST' && query && typeof query.requestId === 'string' && query.requestId.length > 0
        && query.profileId === expected.profileId && query.sourceEpoch === expected.sourceEpoch && query.indexId === expected.indexId
        && query.generation === expected.generation && query.topK === 5 && query.text === expected.text, 'UI_QUERY_REQUEST_MISMATCH');
      assert.ok(validateResult(value) && value.failure === null && value.failureMessage === null && value.requestId === query.requestId
        && value.profileId === query.profileId && value.sourceEpoch === query.sourceEpoch && value.indexId === query.indexId
        && value.generation === query.generation && value.hits.length <= 5
        && new Set(value.hits.map(hit => hit.bookmarkId)).size === value.hits.length, 'UI_RESULT_IDENTITY_INVALID');
      return value;
    },
  };
}
