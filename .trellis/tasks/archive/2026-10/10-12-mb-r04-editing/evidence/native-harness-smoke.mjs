// Test the isolated R04 driver only; this does not accept R04 product behavior.
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fixtureRoot, launch, launchChrome, pair, cleanCredentials, workerRuntime, environment, evidence } from './native-driver.mjs';
const report = { runId: randomUUID().slice(0, 8), scope: 'R04 isolated native driver smoke only', environment: await environment() };
let app, chrome, worker;
try {
  report.isolationRoot = await fixtureRoot();
  app = await launch(report.isolationRoot);
  chrome = await launchChrome(join(report.isolationRoot, 'chrome'));
  const profileId = await pair(app, chrome);
  worker = await workerRuntime(chrome);
  report.chrome = chrome.version;
  report.webview = app.webview;
  report.paired = (await app.invoke('get_bridge_state')).profiles.some(profile => profile.profileId === profileId && profile.connection === 'live');
  report.workerAttached = await worker.evaluate('typeof chrome.bookmarks.move === "function" && typeof WebSocket.prototype.send === "function"');
  report.status = report.paired && report.workerAttached ? 'PASS' : 'FAIL';
} catch { report.status = 'FAIL'; process.exitCode = 1; }
finally {
  if (app) { try { await cleanCredentials(app); report.credentialsRemoved = true; } catch { report.credentialsRemoved = false; report.status = 'FAIL'; process.exitCode = 1; } }
  if (worker) await worker.close().catch(() => {});
  if (chrome) await chrome.close();
  if (app) await app.close();
  await writeFile(join(evidence, `native-harness-smoke-${report.runId}.json`), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report));
}
