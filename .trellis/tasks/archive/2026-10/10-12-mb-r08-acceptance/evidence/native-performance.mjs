// Input-to-render timing on the production WebView2 app, never mocked IPC.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { B10K_SEED, B10K_MARKER, buildB10k } from '../../../../../../apps/desktop/src/features/library/b10k.ts';
import { environment, evidence, fixtureRoot, launch, until, repo } from './native-driver.mjs';

const run = promisify(execFile);
const protocolNode = node => ({...node,folderType:null,unmodifiable:null,dateAdded:null,dateLastUsed:null});
const runId = randomUUID().slice(0, 8);
const phase = process.argv[2] ?? 'final';
if (!['baseline', 'final'].includes(phase)) throw new Error('INVALID_MEASUREMENT_PHASE');
const report = { runId, phase, startedAt: new Date().toISOString(), scope: 'R08 real native B10K cached profile; no daily Chrome and no mock IPC',
  seed: B10K_SEED, coldDefinition: 'process spawn to visible MB05BAR tree, cached profile source and enabled search',
  searchDefinition: 'browser performance.now before input event to exact marker title rendered and next animation frame',
  percentile: 'sorted[ceil(n * ratio)-1]; one explicit warmup then 30 measured input samples', coldMs: [], searchMs: [], errors: [] };
let app;
let stage = 'prepare';
function ensure(condition, code) { if (!condition) throw new Error(code); }
function stats(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  return { p50: sorted[Math.ceil(sorted.length * 0.5) - 1] ?? null, p95: sorted[Math.ceil(sorted.length * 0.95) - 1] ?? null, max: sorted.at(-1) ?? null };
}
async function operable(page) {
  return page.evaluate(() => {
    const input = document.querySelector('#library-search');
    const source = document.querySelector('#library-source');
    const bar = [...document.querySelectorAll('[role="treeitem"]')].some(node => node.textContent.includes('MB05BAR') && node.getClientRects().length);
    return bar && source?.value.startsWith('profile:') && input && !input.disabled && document.querySelector('.connection')?.textContent.includes('只读');
  });
}
try {
  report.environment = await environment();
  const built = buildB10k();
  ensure(B10K_SEED === 20261010 && built.bookmarks === 10000 && built.folders === 1000 && built.maxDepth === 20 && built.nodes.length === 11004, 'WRONG_B10K_SHAPE');
  report.fixture = { bookmarks: built.bookmarks, folders: built.folders, maxDepth: built.maxDepth, nodes: built.nodes.length };
  report.isolationRoot = await fixtureRoot();
  const nodesFile = join(report.isolationRoot, 'nodes.json');
  await writeFile(nodesFile,JSON.stringify(built.nodes.map(protocolNode)));
  await run(join(repo,'target/debug/examples/seed_profile_cache.exe'),[join(report.isolationRoot,'app-data/markbridge.sqlite'),nodesFile],{windowsHide:true});
  stage = 'cold-start';
  for (let index = 0; index < 3; index++) {
    app = await launch(report.isolationRoot);
    app.page.on('pageerror', () => report.errors.push('NATIVE_PAGE_ERROR'));
    await until(() => operable(app.page), 'CACHE_NOT_OPERABLE');
    report.coldMs.push(performance.now() - app.started);
    report.webview = app.webview;
    report.devicePixelRatio = await app.page.evaluate(() => devicePixelRatio);
    await app.close(); app = null;
  }
  stage = 'warm-search';
  app = await launch(report.isolationRoot);
  app.page.on('pageerror', () => report.errors.push('NATIVE_PAGE_ERROR'));
  await until(() => operable(app.page), 'CACHE_NOT_OPERABLE');
  for (let index = 0; index < 31; index++) {
    await app.page.locator('#library-search').fill('');
    await until(() => app.page.evaluate(marker => ![...document.querySelectorAll('[role="option"] .library-title')].some(node => node.textContent === marker && node.getClientRects().length), B10K_MARKER), 'PREVIOUS_HIT_NOT_CLEARED');
    await delay(250); // Let the preceding clear-query refresh settle; never excluded after typing.
    const elapsed = await app.page.evaluate(marker => new Promise((resolve, reject) => {
      const input = document.querySelector('#library-search');
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      if (!input || input.disabled || !setter) { reject(new Error('INPUT_NOT_READY')); return; }
      const started = performance.now();
      let done = false;
      const observer = new MutationObserver(check);
      const timeout = setTimeout(() => { observer.disconnect(); reject(new Error('SEARCH_RENDER_TIMEOUT')); }, 5000);
      function check() {
        if (done || ![...document.querySelectorAll('[role="option"] .library-title')].some(node => node.textContent === marker && node.getClientRects().length)) return;
        done = true; observer.disconnect(); clearTimeout(timeout);
        requestAnimationFrame(() => resolve(performance.now() - started));
      }
      observer.observe(document.body, { childList: true, subtree: true, attributes: true, characterData: true });
      setter.call(input, marker);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      check();
    }), B10K_MARKER);
    if(index === 0) report.warmupMs = elapsed; else report.searchMs.push(elapsed);
  }
  await mkdir(join(evidence, 'native-screenshots'), { recursive: true });
  await app.resize(1100, 760);
  await app.page.screenshot({ path: join(evidence, 'native-screenshots', `${runId}-b10k-search.png`) });
  report.cold = stats(report.coldMs);
  report.warm = stats(report.searchMs);
  ensure(report.errors.length === 0, 'PAGE_ERRORS');
  ensure(report.coldMs.length === 3 && report.coldMs.every(ms => ms <= 3000), 'COLD_START_OVER_3000MS');
  ensure(report.searchMs.length === 30 && report.warm.p95 <= 200, 'WARM_SEARCH_P95_OVER_200MS');
  report.status = 'PASS';
} catch (error) {
  report.status = 'FAIL'; report.failedStage = stage;
  report.failureCode = /^[A-Z][A-Z0-9_:.-]+$/.test(error.message) ? error.message : 'MEASUREMENT_ACTION_FAILED';
  process.exitCode = 1;
} finally {
  if (app) await app.close();
  report.finishedAt = new Date().toISOString();
  await writeFile(join(evidence, `native-performance-${phase}-${runId}.json`), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ status: report.status, phase, failedStage: report.failedStage, failureCode: report.failureCode, coldMs: report.coldMs, warm: report.warm }));
}
