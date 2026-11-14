// Current scanned release, Rust-seeded disposable B10K cache, actual WebView2 UI timing.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { constants } from 'node:fs';
import { copyFile, mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { cpus, release, tmpdir, totalmem, version } from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { B10K_SEED, B10K_MARKER, buildB10k } from '../../../../apps/desktop/src/features/library/b10k.ts';
import { inspectNativeArtifact, nativeReleaseContext } from '../../../../scripts/native-build.mjs';
import { repo, evidence, ensure, assertRoot, assertSubdir, launchInstalled, safeErrorCode, system, until } from './current-native-driver.mjs';

ensure(process.platform === 'win32' && process.arch === 'x64', 'WINDOWS_X64_REQUIRED');
ensure(process.argv.length === 2, 'NO_PERFORMANCE_PROBE_ARGUMENTS');
const run = promisify(execFile), runId = randomUUID();
const native = nativeReleaseContext(repo), bytes = await readFile(native.artifact);
inspectNativeArtifact(bytes);
const executableSha256 = createHash('sha256').update(bytes).digest('hex');
const root = await mkdtemp(join(tmpdir(), 'markbridge-task13-native-'));
const plan = { root, installDirectory: join(root, 'install'), appData: join(root, 'app-data'),
  executable: join(root, 'install/markbridge-desktop.exe'), namespace: `Markbridge.Task06.performance-${runId}` };
const report = { kind: 'current_release_native_b10k_performance', runId, root, executableSha256,
  measurementMethodVersion: 2,
  startedAt: new Date().toISOString(), status: 'RUNNING', installation: 'NOT_RUN', chrome: 'NOT_RUN', model: 'NOT_RUN',
  environment: { os: version(), release: release(), cpu: cpus()[0]?.model, logicalCpus: cpus().length,
    memoryBytes: totalmem(), node: process.version, executableBytes: bytes.length },
  coldDefinition: 'monotonic immediately before child spawn to first observed readonly B10K tree, correct loaded list, enabled search and next frame; candidate accepted only after exact main OS guard and owned CDP listener/page verification pass',
  observationBoundary: 'read-only DOM/CDP observation runs concurrently with main OS guard; CDP discovery and polling overhead included; no subtraction; new app/WebView processes; OS disk caches not purged',
  beforeGuardPolicy: 'only static DOM fixture comparisons and animation-frame recheck; no IPC, input, click, model, pairing, screenshot or text output',
  searchDefinition: 'browser performance.now before input event to exact marker result, loaded 1/1, no loading state, rechecked on animation frame',
  percentile: 'sorted[ceil(n * ratio)-1]; first search recorded as excluded warmup, then 30 measured samples',
  machineQuiet: 'operator precondition; not inferred by this probe', coldMs: [], searchMs: [], launches: [], closes: [], errors: [], pageErrorCount: 0 };
let app, stage = 'prepare';

function stats(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  return { p50: sorted[Math.ceil(sorted.length * 0.5) - 1] ?? null,
    p95: sorted[Math.ceil(sorted.length * 0.95) - 1] ?? null, max: sorted.at(-1) ?? null };
}
async function operable(page, expectedChildren) {
  return page.evaluate(expected => new Promise(resolve => {
    const ready = () => {
      const input = document.querySelector('#library-search'), source = document.querySelector('#library-source');
      const workspace = document.querySelector('[aria-label="书签工作区"]');
      const status = document.querySelector('.list-pane .secondary[role="status"]')?.textContent ?? '';
      const bar = [...document.querySelectorAll('[role="treeitem"] .library-title')]
        .some(node => node.textContent === 'MB05BAR' && node.getClientRects().length);
      const rows = document.querySelector('[role="listbox"][aria-label="书签列表"]');
      return bar && source?.value === 'profile:pb10k' && !source.disabled && input && !input.disabled && input.value === ''
        && input.getClientRects().length && workspace?.getAttribute('aria-busy') !== 'true'
        && document.querySelector('.connection')?.textContent.includes('只读')
        && status.includes(`已加载 ${Math.min(200, expected)} / ${expected} 项`) && !status.includes('正在读取')
        && rows?.getClientRects().length && rows.querySelector('[role="option"][tabindex="0"]');
    };
    if (!ready()) { resolve(false); return; }
    requestAnimationFrame(() => resolve(Boolean(ready())));
  }), expectedChildren);
}
async function launch() {
  app = await launchInstalled({ ...plan, readonlyStartupObserver: page => operable(page, report.fixture.rootChildren) });
  const allStartupChecksReturnedMonotonicMs = performance.now();
  ensure(Number.isFinite(app.preSpawnMonotonicMs), 'CURRENT_DRIVER_PRESPAWN_TIMESTAMP_REQUIRED');
  ensure(Number.isFinite(app.readonlyStartupCandidateMonotonicMs), 'VERIFIED_READONLY_STARTUP_CANDIDATE_REQUIRED');
  ensure(Number.isFinite(app.mainOsGuardVerifiedMonotonicMs), 'ACTUAL_OS_GUARD_TIMESTAMP_REQUIRED');
  const milestoneNames = ['cdpTargetSeen', 'cdpConnectStarted', 'cdpConnected', 'headingSeen', 'domReady'];
  const milestones = app.readonlyStartupMilestones;
  const milestoneValues = milestoneNames.map(name => milestones?.[name]);
  ensure(milestoneValues.every(Number.isFinite)
    && milestoneValues.every((value, index) => value >= (index === 0 ? app.preSpawnMonotonicMs : milestoneValues[index - 1]))
    && milestones.domReady === app.readonlyStartupCandidateMonotonicMs, 'ACTUAL_STARTUP_MILESTONES_REQUIRED');
  const ownership = app.readonlyStartupOwnershipProof;
  ensure(ownership?.pageOriginTrusted === true && ownership.exactMainDirectoryVerified === true
    && ownership.listenerOwned === true && ownership.appExecutableMatched === true && ownership.directWebviewChild === true
    && ownership.appPid === app.child.pid && ownership.debugPort === app.debugPort
    && app.mainDataEvidence.observations.some(row => row.pid === ownership.webviewPid && row.expectedMain && row.observedDirectoryExists),
  'READONLY_STARTUP_OWNERSHIP_PROOF_REQUIRED');
  app.page.on('pageerror', () => { report.pageErrorCount += 1; });
  await until(() => operable(app.page, report.fixture.rootChildren), 'B10K_CACHE_NOT_OPERABLE');
  const elapsedMs = app.readonlyStartupCandidateMonotonicMs - app.preSpawnMonotonicMs;
  ensure(elapsedMs > 0 && Number.isFinite(elapsedMs), 'COLD_SAMPLE_INVALID');
  report.launches.push({ pid: app.child.pid, observedOperableMs: elapsedMs, mainDataEvidence: app.mainDataEvidence,
    preSpawnMonotonicMs: app.preSpawnMonotonicMs, readonlyStartupCandidateMonotonicMs: app.readonlyStartupCandidateMonotonicMs,
    mainOsGuardVerifiedMs: app.mainOsGuardVerifiedMonotonicMs - app.preSpawnMonotonicMs,
    allStartupChecksReturnedMs: allStartupChecksReturnedMonotonicMs - app.preSpawnMonotonicMs,
    startupMilestonesMonotonicMs: Object.fromEntries(milestoneNames.map(name => [name, milestones[name]])),
    startupMilestonesElapsedMs: Object.fromEntries(milestoneNames.map(name => [name, milestones[name] - app.preSpawnMonotonicMs])),
    acceptedAfterOsGuard: true,
    readonlyStartupOwnershipProof: { appPid: ownership.appPid, webviewPid: ownership.webviewPid, debugPort: ownership.debugPort,
      listenerOwned: ownership.listenerOwned, appExecutableMatched: ownership.appExecutableMatched,
      directWebviewChild: ownership.directWebviewChild, pageOriginTrusted: ownership.pageOriginTrusted,
      exactMainDirectoryVerified: ownership.exactMainDirectoryVerified },
    webview: app.webview, dimensions: await app.page.evaluate(() => ({ width: innerWidth, height: innerHeight, devicePixelRatio })) });
  return elapsedMs;
}
async function close() {
  const normalExit = await app.close();
  const processes = await until(async () => {
    const observed = await system('processes', root);
    return observed.processes.length === 0 && observed.listeners.length === 0 ? observed : null;
  }, 'PERFORMANCE_OWNED_PROCESS_OR_LISTENER_REMAINED');
  report.closes.push({ normalExit, processes }); app = null;
}
try {
  await assertRoot(root);
  await mkdir(plan.installDirectory); await mkdir(plan.appData);
  await assertSubdir(root, plan.installDirectory, 'install'); await assertSubdir(root, plan.appData, 'app-data');
  ensure((await readdir(plan.appData)).length === 0, 'PERFORMANCE_APP_DATA_NOT_FRESH');
  await copyFile(native.artifact, plan.executable, constants.COPYFILE_EXCL);
  ensure(createHash('sha256').update(await readFile(plan.executable)).digest('hex') === executableSha256, 'COPIED_RELEASE_HASH_MISMATCH');
  const built = buildB10k();
  ensure(B10K_SEED === 20261010 && built.bookmarks === 10000 && built.folders === 1000 && built.maxDepth === 20 && built.nodes.length === 11004, 'WRONG_B10K_SHAPE');
  const initialFolder = built.nodes.filter(node => node.kind === 'folder' && node.parentId === null).sort((a, b) => a.position - b.position)[0];
  ensure(initialFolder?.chromeId === '0', 'WRONG_B10K_INITIAL_ROOT');
  report.fixture = { seed: B10K_SEED, bookmarks: built.bookmarks, folders: built.folders, maxDepth: built.maxDepth,
    nodes: built.nodes.length, initialFolderId: initialFolder.chromeId,
    rootChildren: built.nodes.filter(node => node.parentId === initialFolder.chromeId).length };
  const nodes = JSON.stringify(built.nodes.map(node => ({ ...node, folderType: null, unmodifiable: null, dateAdded: null, dateLastUsed: null })));
  const nodesFile = join(root, 'nodes.json');
  await writeFile(nodesFile, nodes, { flag: 'wx' });
  const seeder = join(native.targetDirectory, 'debug/examples/seed_profile_cache.exe');
  report.seederSha256 = createHash('sha256').update(await readFile(seeder)).digest('hex');
  const seeded = await run(seeder, [join(plan.appData, 'markbridge.sqlite'), nodesFile], { windowsHide: true, timeout: 30000, maxBuffer: 4096 });
  ensure(seeded.stdout.trim() === 'SEED_OK nodes=11004', 'B10K_SEED_NOT_CONFIRMED');
  report.seed = { exitCode: 0, nodesSha256: createHash('sha256').update(nodes).digest('hex'), credentialStore: 'NOT_OPENED_BY_SEEDER' };
  stage = 'cold-start';
  for (let index = 0; index < 3; index++) {
    report.coldMs.push(await launch());
    await close();
  }
  stage = 'warm-search'; await launch();
  for (let index = 0; index < 31; index++) {
    await app.page.locator('#library-search').fill('');
    await until(() => operable(app.page, report.fixture.rootChildren), 'PREVIOUS_QUERY_NOT_SETTLED');
    await delay(250); // Only before typing; no time after the input event is excluded.
    const elapsedMs = await app.page.evaluate(marker => new Promise((resolve, reject) => {
      const input = document.querySelector('#library-search');
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      if (!input || input.disabled || !setter) { reject(new Error('SEARCH_INPUT_NOT_READY')); return; }
      const started = performance.now(); let done = false, framePending = false;
      const ready = () => {
        const row = [...document.querySelectorAll('[role="listbox"][aria-label="搜索结果"] [role="option"]')]
          .find(node => node.querySelector('.library-title')?.textContent === marker && node.getClientRects().length);
        const status = document.querySelector('.list-pane .secondary[role="status"]')?.textContent ?? '';
        return input.value === marker && !input.disabled && row && row.tabIndex >= 0 && row.getAttribute('aria-disabled') !== 'true'
          && status.includes('已加载 1 / 1 项') && !status.includes('正在读取')
          && document.querySelector('[aria-label="书签工作区"]')?.getAttribute('aria-busy') !== 'true';
      };
      const observer = new MutationObserver(check);
      const timeout = setTimeout(() => { done = true; observer.disconnect(); reject(new Error('SEARCH_RENDER_TIMEOUT')); }, 5000);
      function check() {
        if (done || framePending || !ready()) return;
        framePending = true;
        requestAnimationFrame(() => {
          framePending = false;
          if (!done && ready()) { done = true; observer.disconnect(); clearTimeout(timeout); resolve(performance.now() - started); }
          else check();
        });
      }
      observer.observe(document.body, { childList: true, subtree: true, attributes: true, characterData: true });
      setter.call(input, marker); input.dispatchEvent(new Event('input', { bubbles: true })); check();
    }), B10K_MARKER);
    ensure(elapsedMs > 0 && Number.isFinite(elapsedMs), 'SEARCH_SAMPLE_INVALID');
    if (index === 0) report.warmupMs = elapsedMs; else report.searchMs.push(elapsedMs);
  }
  report.cold = stats(report.coldMs); report.warm = stats(report.searchMs);
  await app.page.screenshot({ path: join(evidence, `current-performance-${runId}-b10k-search.png`) });
  stage = 'normal-close'; await close();
  stage = 'performance-thresholds';
  ensure(report.pageErrorCount === 0, 'NATIVE_PAGE_ERRORS');
  ensure(report.coldMs.length === 3 && report.coldMs.every(ms => ms <= 3000), 'COLD_START_OVER_3000MS');
  ensure(report.searchMs.length === 30 && report.warm.p95 <= 200, 'WARM_SEARCH_P95_OVER_200MS');
  report.status = 'PASS';
} catch (error) {
  app ??= error.fixtureApp; report.status = 'FAIL'; report.failedStage = stage;
  report.failureEvidence = error.details ?? app?.lastCloseEvidence ?? null;
  report.errors.push(safeErrorCode(error, 'PERFORMANCE_PROBE_FAILED')); process.exitCode = 1;
} finally {
  if (app) {
    try { await close(); }
    catch (error) { report.status = 'FAIL'; report.errors.push(safeErrorCode(error, 'PERFORMANCE_NORMAL_CLOSE_FAILED')); report.closeEvidence = error.details ?? app.lastCloseEvidence ?? null; process.exitCode = 1; }
  }
  report.cold = stats(report.coldMs); report.warm = stats(report.searchMs);
  report.finishedAt = new Date().toISOString();
  const receipt = join(evidence, `current-performance-${runId}-receipt.json`);
  await writeFile(receipt, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ status: report.status, receipt, errors: report.errors, coldMs: report.coldMs, cold: report.cold, warm: report.warm }));
}
