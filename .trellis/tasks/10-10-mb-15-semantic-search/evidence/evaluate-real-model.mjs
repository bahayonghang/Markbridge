// Explicit future V18 runner. No model exists in the current session.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { copyFile, mkdir, mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, isAbsolute } from 'node:path';
import { nativeReleaseContext } from '../../../../scripts/native-build.mjs';
import { repo, ensure, until, launchInstalled, safeErrorCode, system } from '../../10-10-mb-13-windows-acceptance/evidence/current-native-driver.mjs';
import { semanticFixture } from './semantic-fixture.mjs';
import { validateLabels, evaluationMetrics } from './semantic-metrics.mjs';

const runFile = promisify(execFile), evidence = import.meta.dirname;
const arguments_ = process.argv.slice(2);
if (arguments_.length === 0) {
  console.log('V18 NOT_RUN: requires an explicitly authorized local model and human-reviewed 20-query labels.');
} else {
  ensure(arguments_.length === 4 && arguments_[0] === '--run-real-model' && isAbsolute(arguments_[3]), 'REAL_EVALUATION_ARGUMENTS_INVALID');
  const [, endpoint, model, labelsPath] = arguments_;
  const url = new URL(endpoint);
  ensure(url.protocol === 'http:' && ['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname) && !url.username && !url.password && !url.search && !url.hash && url.pathname === '/', 'LOCAL_ENDPOINT_REQUIRED');
  ensure(/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/.test(model), 'MODEL_NAME_INVALID');
  const fixture = semanticFixture(true);
  const labelsBytes = await readFile(labelsPath); ensure(labelsBytes.length <= 65536, 'LABELS_LIMIT_EXCEEDED');
  const labels = validateLabels(JSON.parse(labelsBytes), fixture.sha256);
  const runId = randomUUID(), root = await realpath(await mkdtemp(join(tmpdir(), 'markbridge-task13-native-')));
  const context = nativeReleaseContext(repo), identity = { profileId: 'semantic-fixture-a', sourceEpoch: 1 };
  const plan = { root, installDirectory: join(root, 'install'), appData: join(root, 'app-data'),
    executable: join(root, 'install', 'markbridge-desktop.exe'), namespace: `Markbridge.Task06.semantic-${runId}` };
  const receipt = { runId, root, status: 'RUNNING', actualModel: true, fixtureSha256: fixture.sha256,
    fixtureShape: fixture.shape, labelsSha256: createHash('sha256').update(labelsBytes).digest('hex'),
    humanReview: labels.humanReview, results: [], warmMs: [], errors: [] };
  let app;
  try {
    await mkdir(plan.installDirectory); await mkdir(plan.appData);
    const bytes = await readFile(context.artifact);
    receipt.executableSha256 = createHash('sha256').update(bytes).digest('hex');
    await copyFile(context.artifact, plan.executable, constants.COPYFILE_EXCL);
    const copied = await readFile(plan.executable);
    receipt.copiedExecutableSha256 = createHash('sha256').update(copied).digest('hex');
    ensure(copied.length === bytes.length && receipt.copiedExecutableSha256 === receipt.executableSha256, 'COPIED_RELEASE_HASH_MISMATCH');
    const fixturePath = join(root, 'semantic-fixture.json');
    await writeFile(fixturePath, JSON.stringify(fixture.fixture), { flag: 'wx' });
    const seed = join(context.targetDirectory, 'debug', 'examples', 'semantic_fixture_seed.exe');
    receipt.seedExecutableSha256 = createHash('sha256').update(await readFile(seed)).digest('hex');
    receipt.helperHashes = Object.fromEntries(await Promise.all(['crates/core/examples/semantic_fixture_seed.rs',
      '.trellis/tasks/10-10-mb-15-semantic-search/evidence/evaluate-real-model.mjs',
      '.trellis/tasks/10-10-mb-15-semantic-search/evidence/semantic-fixture.mjs',
      '.trellis/tasks/10-10-mb-15-semantic-search/evidence/semantic-metrics.mjs',
      '.trellis/tasks/10-10-mb-13-windows-acceptance/evidence/current-native-driver.mjs',
      '.trellis/tasks/10-10-mb-13-windows-acceptance/evidence/current-native-system.ps1',
      '.trellis/tasks/10-10-mb-13-windows-acceptance/evidence/current-native-window.ps1']
      .map(async path => [path, createHash('sha256').update(await readFile(join(repo, path))).digest('hex')])));
    await runFile(seed, [join(plan.appData, 'markbridge.sqlite'), fixturePath], { windowsHide: true, timeout: 120000 });
    app = await launchInstalled(plan);
    receipt.mainDataEvidence = app.mainDataEvidence;
    ensure((await app.invoke('semantic_settings')).enabled === false, 'DEFAULT_SEMANTIC_NOT_OFF');
    await app.invoke('save_semantic_config', { config: { enabled: true, endpoint, model } });
    receipt.model = await app.invoke('semantic_model_check', { endpoint, model });
    ensure(receipt.model.available && receipt.model.digest, 'ACTUAL_MODEL_UNAVAILABLE');
    const review = await app.invoke('semantic_review_scope', { scope: { ...identity, expectedRevision: 1,
      selectedChromeIds: fixture.fixture.profiles[0].nodes.filter(node => node.kind === 'bookmark').map(node => node.chromeId), folderId: null } });
    ensure(review.count === 10000, 'B10K_SCOPE_NOT_COMPLETE');
    await app.invoke('semantic_start_index', { reviewId: review.reviewId });
    const ready = await until(async () => {
      const status = await app.invoke('semantic_status', identity);
      ensure(!['failed', 'stale'].includes(status.index?.phase), 'ACTUAL_INDEX_BUILD_FAILED');
      return status.index?.phase === 'ready' ? status.index : null;
    }, 'ACTUAL_INDEX_BUILD_TIMEOUT', 7200000);
    // Some local metadata omits dimension; bind the actual first vectors instead.
    ensure(ready.ready === 10000 && ready.digest === receipt.model.digest && Number.isInteger(ready.dimension) && ready.dimension >= 1 && ready.dimension <= 4096, 'B10K_MODEL_OR_SCOPE_CHANGED'); receipt.index = ready;
    // Root selects the source through normal UI; no model calls are fabricated.
    await app.page.getByRole('combobox', { name: '书签来源', exact: true }).selectOption(`profile:${identity.profileId}`);
    await app.page.getByRole('button', { name: '语义检索', exact: true }).click();
    await app.page.getByRole('region', { name: '当前语义索引' }).waitFor();
    await app.page.evaluate(() => {
      const original = window.__TAURI_INTERNALS__.invoke;
      window.__mb15 = { last: null, start: 0 };
      window.__TAURI_INTERNALS__.invoke = async function (command, args, ...rest) {
        const value = await original.call(this, command, args, ...rest);
        if (command === 'semantic_query') window.__mb15.last = value;
        return value;
      };
    });
    async function uiQuery(query) {
      await app.page.evaluate(() => { window.__mb15.last = null; window.__mb15.start = performance.now(); });
      await app.page.getByLabel('描述想找的内容', { exact: true }).fill(query.text);
      await app.page.getByRole('button', { name: '查询语义索引', exact: true }).click();
      await app.page.waitForFunction(() => window.__mb15.last && document.querySelector('.semantic-query[aria-busy="false"] .semantic-hits'), undefined, { timeout: 20000 });
      const rendered = await app.page.evaluate(async () => {
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        return { duration: performance.now() - window.__mb15.start, result: window.__mb15.last,
          visibleTitles: Array.from(document.querySelectorAll('.semantic-hits .semantic-hit > span:first-child'), element => element.textContent) };
      });
      const result = rendered.result;
      ensure(result && result.failure === null && result.profileId === identity.profileId && result.sourceEpoch === 1 && result.indexId === ready.indexId && result.generation === ready.generation && result.hits.length <= 5, 'UI_RESULT_IDENTITY_INVALID');
      ensure(JSON.stringify(rendered.visibleTitles) === JSON.stringify(result.hits.map(hit => hit.title || '未命名书签')), 'UI_RESULTS_NOT_VALIDATED_AND_RENDERED');
      return { queryId: query.id, chromeIds: result.hits.map(hit => hit.chromeId), durationMs: rendered.duration };
    }
    for (const query of labels.queries) receipt.results.push(await uiQuery(query));
    for (let index = 0; index < 30; index++) receipt.warmMs.push((await uiQuery(labels.queries[index % 20])).durationMs);
    receipt.metrics = evaluationMetrics(labels, receipt.results, receipt.warmMs);
    const final = (await app.invoke('semantic_status', identity)).index;
    ensure(final.digest === ready.digest && final.generation === ready.generation && final.ready === 10000, 'EVALUATION_INDEX_CHANGED');
    receipt.status = receipt.metrics.meetsThresholds ? 'PASS' : 'FAIL';
  } catch (error) { receipt.status = 'FAIL'; receipt.errors.push(safeErrorCode(error, 'ACTUAL_MODEL_EVALUATION_FAILED')); if (!app && error.fixtureApp) app = error.fixtureApp; }
  finally {
    if (app) { try {
      receipt.close = await app.close();
      receipt.finalProcesses = await system('processes', root);
      ensure(receipt.finalProcesses.processes.length === 0 && receipt.finalProcesses.listeners.length === 0, 'ACTUAL_EVALUATION_PROCESS_REMAINED');
    } catch (error) { receipt.status = 'FAIL'; receipt.errors.push(safeErrorCode(error, 'ACTUAL_EVALUATION_CLOSE_FAILED')); receipt.close = app.lastCloseEvidence; } }
    await writeFile(join(evidence, `actual-model-${runId}-receipt.json`), JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx' });
  }
  console.log(JSON.stringify({ runId, status: receipt.status, metrics: receipt.metrics, errors: receipt.errors }));
  if (receipt.status !== 'PASS') process.exitCode = 1;
}
