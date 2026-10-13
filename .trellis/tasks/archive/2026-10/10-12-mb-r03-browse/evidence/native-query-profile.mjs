// Diagnostic IPC timing, deliberately separate from input-to-render acceptance.
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { evidence, environment, launch } from './native-driver.mjs';
const prior = JSON.parse(await readFile(join(evidence, 'native-performance-final-747b0c37.json'), 'utf8'));
const report = { runId: randomUUID().slice(0, 8), scope: 'diagnostic IPC only; not native performance acceptance', environment: await environment(), samples: {} };
const app = await launch(prior.isolationRoot);
try {
  await app.page.locator('#library-search').waitFor();
  for (const [name, patch] of Object.entries({ marker: { folderScope: 'all', folderId: null, query: 'MB05MARK' }, children: { folderScope: 'children', folderId: '0', query: '' } })) {
    report.samples[name] = [];
    for (let sample = 0; sample < 10; sample++) {
      report.samples[name].push(await app.page.evaluate(async patch => {
        const started = performance.now();
        const value = await window.__TAURI_INTERNALS__.invoke('cache_query', { profileId: 'pb10k', request: { ...patch, tagIds: [], includeSummary: false, includeNote: false, offset: 0, limit: 200, expectedRevision: null, expectedSourceEpoch: null } });
        return { ms: performance.now() - started, count: value.total };
      }, patch));
    }
  }
  report.status = 'PASS';
} catch { report.status = 'FAIL'; process.exitCode = 1; }
finally {
  await app.close();
  await writeFile(join(evidence, `native-query-profile-${report.runId}.json`), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report));
}
