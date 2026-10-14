// Functional native evidence only. Synthetic vectors cannot establish V18.
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { copyFile, mkdir, mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { nativeReleaseContext } from '../../../../scripts/native-build.mjs';
import { repo, ensure, until, launchInstalled, system, safeErrorCode } from '../../10-10-mb-13-windows-acceptance/evidence/current-native-driver.mjs';
import { semanticFixture } from './semantic-fixture.mjs';

const runFile = promisify(execFile), evidence = import.meta.dirname;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const identity = { profileId: 'semantic-fixture-a', sourceEpoch: 1 };
const model = 'mb15-mock:latest';

async function mockOllama() {
  const facts = { requests: [], embedCount: 0, privateFieldsAbsent: true };
  let digest = 'a'.repeat(64), remote = false, holdNext = false, held = null;
  const server = createServer(async (request, response) => {
    try {
      let bytes = Buffer.alloc(0);
      for await (const chunk of request) {
        bytes = Buffer.concat([bytes, chunk]);
        ensure(bytes.length <= 65536, 'MOCK_REQUEST_LIMIT');
      }
      ensure(['/api/tags', '/api/show', '/api/embed'].includes(request.url), 'MOCK_ROUTE_INVALID');
      const body = bytes.length ? JSON.parse(bytes) : null;
      facts.requests.push({ route: request.url, method: request.method, bytes: bytes.length, sha256: hash(bytes) });
      let output;
      if (request.url === '/api/tags') {
        ensure(request.method === 'GET', 'MOCK_TAGS_METHOD');
        output = { models: [{ name: model, digest, ...(remote ? { remote_model: 'mock-cloud' } : {}) }] };
      } else if (request.url === '/api/show') {
        ensure(request.method === 'POST' && body.model === model, 'MOCK_SHOW_BODY');
        output = { capabilities: ['embedding'], model_info: { 'fixture.embedding_length': 4 } };
      } else {
        facts.embedCount += 1;
        ensure(request.method === 'POST' && body.model === model && body.truncate === false && Array.isArray(body.input) && body.input.length === 1, 'MOCK_EMBED_BODY');
        const text = body.input[0];
        facts.privateFieldsAbsent &&= typeof text === 'string' && !/MB15-(?:URL|NOTE|TAG)-NEVER-SENT/.test(text);
        ensure(facts.privateFieldsAbsent, 'PRIVATE_FIELDS_SENT_TO_MODEL');
        output = { model, embeddings: [/Rust/i.test(text) ? [1, 0, 0, 0] : /React/i.test(text) ? [0, 1, 0, 0] : /SQLite/i.test(text) ? [0, 0, 1, 0] : [0, 0, 0, 1]] };
        if (holdNext) {
          holdNext = false;
          await new Promise(resolve => { held = resolve; });
          held = null;
        }
      }
      if (!response.destroyed) { response.writeHead(200, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(output)); }
    } catch {
      if (!response.destroyed) { response.writeHead(400); response.end('{}'); }
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { facts, endpoint: `http://127.0.0.1:${server.address().port}`,
    hold: () => { ensure(!held && !holdNext, 'MOCK_ALREADY_HELD'); holdNext = true; },
    waitHeld: () => until(() => held !== null, 'MOCK_EMBED_NOT_HELD'),
    release: () => held?.(), setDigest: value => { digest = value; }, setRemote: value => { remote = value; },
    async close() { held?.(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); } };
}

async function execute() {
  const runId = randomUUID(), context = nativeReleaseContext(repo);
  const root = await realpath(await mkdtemp(join(tmpdir(), 'markbridge-task13-native-')));
  const plan = { root, installDirectory: join(root, 'install'), appData: join(root, 'app-data'),
    executable: join(root, 'install', 'markbridge-desktop.exe'), namespace: `Markbridge.Task06.semantic-${runId}` };
  const receipt = { runId, status: 'RUNNING', scope: 'isolated Windows native synthetic-model functional test',
    actualModelV18: 'NOT_RUN', installation: 'NOT_RUN (copied current release)', chrome: 'NOT_RUN', root,
    controls: {}, errors: [], fixtureSha256: semanticFixture().sha256 };
  let app, mock;
  const control = async (name, action) => { await action(); receipt.controls[name] = 'PASS'; };
  try {
    await mkdir(plan.installDirectory); await mkdir(plan.appData);
    const artifact = await readFile(context.artifact);
    receipt.executable = { bytes: artifact.length, sha256: hash(artifact) };
    await copyFile(context.artifact, plan.executable, constants.COPYFILE_EXCL);
    const copied = await readFile(plan.executable);
    ensure(copied.length === artifact.length && hash(copied) === receipt.executable.sha256, 'COPIED_RELEASE_HASH_MISMATCH');
    receipt.copiedExecutable = { bytes: copied.length, sha256: hash(copied) };
    const fixturePath = join(root, 'semantic-fixture.json');
    await writeFile(fixturePath, JSON.stringify(semanticFixture().fixture), { flag: 'wx' });
    const seed = join(context.targetDirectory, 'debug', 'examples', 'semantic_fixture_seed.exe');
    receipt.seedExecutableSha256 = hash(await readFile(seed));
    receipt.helperHashes = Object.fromEntries(await Promise.all(['crates/core/examples/semantic_fixture_seed.rs',
      '.trellis/tasks/10-10-mb-15-semantic-search/evidence/current-semantic-native.mjs',
      '.trellis/tasks/10-10-mb-15-semantic-search/evidence/semantic-fixture.mjs',
      '.trellis/tasks/10-10-mb-13-windows-acceptance/evidence/current-native-driver.mjs',
      '.trellis/tasks/10-10-mb-13-windows-acceptance/evidence/current-native-system.ps1',
      '.trellis/tasks/10-10-mb-13-windows-acceptance/evidence/current-native-window.ps1']
      .map(async path => [path, hash(await readFile(join(repo, path)))])));
    const seeded = await runFile(seed, [join(plan.appData, 'markbridge.sqlite'), fixturePath], { windowsHide: true, timeout: 60000 });
    ensure(seeded.stdout.trim() === 'SEMANTIC_SEED_OK profiles=2 bookmarks=6', 'SEMANTIC_SEED_NOT_COMPLETE');
    mock = await mockOllama();
    app = await launchInstalled(plan); receipt.mainDataEvidence = app.mainDataEvidence;
    const invoke = (command, args) => app.invoke(command, args), status = () => invoke('semantic_status', identity);
    const config = enabled => ({ enabled, endpoint: mock.endpoint, model });
    const query = (index, requestId = randomUUID()) => ({ requestId, ...identity, indexId: index.indexId, generation: index.generation, text: 'Rust 并发', topK: 5 });
    await control('default_off_zero_requests', async () => {
      ensure((await invoke('semantic_settings')).enabled === false && (await status()).index === null, 'SEMANTIC_DEFAULT_NOT_OFF');
      await invoke('save_semantic_config', { config: config(false) });
      ensure(mock.facts.requests.length === 0, 'DEFAULT_EMBED_NETWORK');
    });
    await control('explicit_metadata_only_check', async () => {
      const checked = await invoke('semantic_model_check', { endpoint: mock.endpoint, model });
      ensure(checked.available && checked.dimension === 4 && mock.facts.embedCount === 0, 'MODEL_METADATA_CHECK_FAILED');
      mock.setRemote(true);
      const rejected = await invoke('semantic_model_check', { endpoint: mock.endpoint, model });
      ensure(!rejected.available && rejected.failure === 'REMOTE_MODEL' && mock.facts.embedCount === 0, 'REMOTE_MODEL_NOT_DENIED');
      mock.setRemote(false);
    });
    await invoke('save_semantic_config', { config: config(true) });
    const review = await invoke('semantic_review_scope', { scope: { ...identity, expectedRevision: 1, selectedChromeIds: [], folderId: '1' } });
    ensure(review.count === 3 && review.clippedCount === 0 && review.upperBytes === 49152, 'FROZEN_SCOPE_REVIEW_INVALID');
    receipt.scopeReview = review;
    await control('pause_late_response_resume', async () => {
      mock.hold(); await invoke('semantic_start_index', { reviewId: review.reviewId }); await mock.waitHeld();
      const paused = await invoke('semantic_pause', identity);
      ensure(paused.index.phase === 'paused' && paused.index.ready === 0, 'INDEX_PAUSE_FAILED');
      mock.release();
      ensure((await status()).index.ready === 0, 'PAUSED_LATE_RESPONSE_COMMITTED');
      await invoke('semantic_resume', identity);
      const ready = await until(async () => { const s = await status(); return s.index?.phase === 'ready' ? s : null; }, 'INDEX_BUILD_NOT_READY', 30000);
      ensure(ready.index.ready === 3 && ready.index.dimension === 4 && ready.index.storedBytes === 48, 'INDEX_VECTOR_STORAGE_INVALID');
      receipt.readyIndex = ready.index;
    });
    await control('query_and_profile_isolation', async () => {
      const current = (await status()).index;
      const result = await invoke('semantic_query', { query: query(current) });
      ensure(result.failure === null && result.hits[0]?.chromeId === 'b1' && result.hits[0].score > 0.99, 'SEMANTIC_QUERY_RANK_INVALID');
      receipt.query = { count: result.hits.length, topChromeId: result.hits[0].chromeId, score: result.hits[0].score };
      const before = mock.facts.embedCount;
      const other = await invoke('semantic_query', { query: { ...query(current), profileId: 'semantic-fixture-b' } });
      ensure(other.hits.length === 0 && other.failure !== null && mock.facts.embedCount === before, 'CROSS_PROFILE_QUERY_NOT_DENIED');
      ensure((await invoke('semantic_status', { ...identity, profileId: 'semantic-fixture-b' })).index === null, 'CROSS_PROFILE_INDEX_LEAK');
    });
    await control('native_ui_explicit_query', async () => {
      await app.page.getByRole('combobox', { name: '书签来源', exact: true }).selectOption(`profile:${identity.profileId}`);
      await app.page.getByRole('button', { name: '语义检索', exact: true }).click();
      await app.page.getByRole('region', { name: '当前语义索引' }).waitFor();
      const before = mock.facts.embedCount;
      await app.page.getByLabel('描述想找的内容', { exact: true }).fill('Rust 并发');
      ensure(mock.facts.embedCount === before, 'UI_TYPING_SENT_EMBEDDING');
      await app.page.getByLabel('描述想找的内容', { exact: true }).press('Enter');
      await app.page.getByRole('list', { name: '语义查询结果' }).waitFor();
      ensure((await app.page.locator('.semantic-hit').first().textContent()).includes('Rust 异步运行时'), 'NATIVE_UI_RESULT_INVALID');
      ensure(mock.facts.embedCount === before + 1, 'UI_EXPLICIT_QUERY_COUNT_INVALID');
      await app.page.screenshot({ path: join(evidence, `native-${runId}-ready.png`) });
      await app.page.setViewportSize({ width: 640, height: 480 });
      await app.page.screenshot({ path: join(evidence, `native-${runId}-minimum.png`) });
    });
    await control('normal_restart_retains_paused_index_without_requests', async () => {
      const paused = await invoke('semantic_pause', identity);
      ensure(paused.index.phase === 'paused' && paused.index.ready === 3, 'READY_INDEX_PAUSE_FAILED');
      receipt.firstClose = await app.close(); app = null;
      const count = mock.facts.requests.length;
      app = await launchInstalled(plan); receipt.restartMainDataEvidence = app.mainDataEvidence;
      const resumed = await status();
      ensure(resumed.index.phase === 'paused' && resumed.index.ready === 3 && resumed.index.generation === paused.index.generation && mock.facts.requests.length === count, 'RESTART_REQUESTED_OR_RESUMED_MODEL');
      await invoke('semantic_resume', identity);
      await until(async () => (await status()).index?.phase === 'ready', 'RESTART_EXPLICIT_RESUME_FAILED');
    });
    await control('digest_change_requires_explicit_rebuild', async () => {
      const old = (await status()).index, before = mock.facts.embedCount;
      mock.setDigest('b'.repeat(64));
      const result = await invoke('semantic_query', { query: query(old) });
      ensure(result.failure === 'MODEL_CHANGED' && result.hits.length === 0 && mock.facts.embedCount === before, 'CHANGED_MODEL_NOT_DENIED');
      ensure((await status()).index.phase === 'stale', 'CHANGED_MODEL_NOT_DURABLY_STALE');
      mock.setDigest('a'.repeat(64));
      const restoredCount = mock.facts.requests.length;
      const restored = await invoke('semantic_query', { query: query((await status()).index) });
      ensure(restored.failure !== null && restored.hits.length === 0 && mock.facts.requests.length === restoredCount, 'OLD_DIGEST_BYPASSED_REBUILD');
      const rebuild = await invoke('semantic_review_scope', { scope: { ...identity, expectedRevision: 1, selectedChromeIds: [], folderId: '1' } });
      await invoke('semantic_start_index', { reviewId: rebuild.reviewId });
      await until(async () => (await status()).index?.phase === 'ready', 'REBUILD_NOT_READY');
    });
    await control('delete_cancels_query_preserves_lexical_data', async () => {
      const before = await invoke('cache_search', { profileId: identity.profileId, query: 'Rust', folderId: null, limit: 10 });
      mock.hold();
      const pending = invoke('semantic_query', { query: query((await status()).index) });
      await mock.waitHeld();
      ensure((await invoke('semantic_delete_index', identity)).index === null, 'INDEX_DELETE_FAILED'); mock.release();
      const cancelled = await pending;
      ensure(cancelled.hits.length === 0 && cancelled.failure !== null && (await status()).index === null, 'DELETED_INDEX_RESURRECTED');
      const after = await invoke('cache_search', { profileId: identity.profileId, query: 'Rust', folderId: null, limit: 10 });
      ensure(before.items.length > 0 && JSON.stringify(before) === JSON.stringify(after), 'LEXICAL_DATA_CHANGED');
      receipt.lexicalPreserved = true;
    });
    await control('disable_zero_requests', async () => {
      await invoke('save_semantic_config', { config: config(false) }); const count = mock.facts.requests.length;
      await invoke('semantic_settings'); await status();
      ensure(mock.facts.requests.length === count && (await status()).settings.enabled === false, 'DISABLE_REQUESTED_MODEL');
    });
    receipt.mock = mock.facts;
    receipt.close = await app.close(); app = null;
    receipt.finalProcesses = await system('processes', root);
    ensure(receipt.finalProcesses.processes.length === 0 && receipt.finalProcesses.listeners.length === 0, 'SEMANTIC_OWNED_PROCESS_REMAINED');
    receipt.status = 'PASS';
  } catch (error) {
    receipt.status = 'FAIL'; receipt.errors.push(safeErrorCode(error, 'SEMANTIC_NATIVE_CHECK_FAILED'));
    if (!app && error.fixtureApp) app = error.fixtureApp;
  } finally {
    if (app) { try { receipt.close = await app.close(); } catch (error) { receipt.errors.push(safeErrorCode(error, 'SEMANTIC_NATIVE_CLOSE_FAILED')); receipt.close = app.lastCloseEvidence; } }
    if (mock) { receipt.mock = mock.facts; await mock.close(); }
    await writeFile(join(evidence, `current-semantic-native-${runId}-receipt.json`), JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx' });
  }
  console.log(JSON.stringify({ runId, status: receipt.status, controls: receipt.controls, errors: receipt.errors }));
  if (receipt.status !== 'PASS') process.exitCode = 1;
}

if (process.argv[1] === import.meta.filename) await execute();
