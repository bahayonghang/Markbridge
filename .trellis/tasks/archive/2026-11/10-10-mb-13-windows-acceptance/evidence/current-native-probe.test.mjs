import assert from 'node:assert/strict';
import test from 'node:test';
import { startProbe } from './current-native-probe.mjs';

test('a stale preview cannot consume the current page job or complete its reply', async () => {
  const probe = await startProbe();
  try {
    const page = async path => {
      const html = await (await fetch(`${probe.base}${path}`)).text();
      const pageId = html.match(/const pageId="([a-f0-9-]+)"/)?.[1];
      assert.ok(pageId);
      return { path, pageId };
    };
    const oldA = await page('/a'), newA = await page('/a'), pageB = await page('/b');
    assert.notEqual(oldA.pageId, newA.pageId);
    const post = async value => {
      const response = await fetch(`${probe.base}/report`, { method: 'POST', body: JSON.stringify(value) });
      assert.equal(response.status, 200);
    };
    await post({ kind: 'hello', ...oldA });
    const since = probe.reports.length;
    await post({ kind: 'hello', ...newA });
    assert.deepEqual(await probe.hello('/a', since), { kind: 'hello', ...newA });

    let completed = false;
    const result = probe.job(newA, 'read').then(value => { completed = true; return value; });
    const next = async target => (await fetch(`${probe.base}/next?path=${encodeURIComponent(target.path)}&pageId=${target.pageId}`)).json();
    assert.equal(await next(oldA), null);
    assert.equal(await next(pageB), null);
    const job = await next(newA);
    assert.equal(job.action, 'read');
    assert.equal(job.pageId, newA.pageId);
    assert.equal(await next(newA), null);

    await post({ kind: 'job', id: job.id, ...oldA, local: 'wrong-generation' });
    await post({ kind: 'job', id: job.id, ...pageB, local: 'wrong-profile' });
    assert.equal(completed, false);
    const reply = { kind: 'job', id: job.id, ...newA, local: 'current-profile', cookie: '', main: null };
    await post(reply);
    assert.deepEqual(await result, reply);
  } finally {
    await probe.close();
  }
});
