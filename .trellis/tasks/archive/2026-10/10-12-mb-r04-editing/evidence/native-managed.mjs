// Managed nodes come from Local State in this disposable Chromium profile only.
// No registry, installed policy folder, daily browser data or binary is modified.
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { environment, evidence, fixtureRoot, launch, launchChrome, pair, cleanCredentials, until, ensure } from './native-driver.mjs';
const runId = randomUUID().slice(0, 8);
const report = { runId, startedAt: new Date().toISOString(), scope: 'Actual Tauri + stock temporary Chromium with profile-local test policy; no host policy writes', controls: [] };
let app, chrome;
let stage = 'prepare';
function pass(control, detail = {}) { report.controls.push({ control, status: 'PASS', ...detail }); console.log(JSON.stringify({ control, status: 'PASS' })); }
try {
  report.environment = await environment();
  report.isolationRoot = await fixtureRoot();
  const directory = join(report.isolationRoot, 'chrome-managed');
  await mkdir(directory);
  const policy = [{ level: 1, scope: 0, source: 2, name: 'ManagedBookmarks', value: [{ toplevel_name: 'R04 受管目录' }, { name: 'R04 受管子目录', children: [{ name: 'R04 受管书签', url: 'https://example.invalid/r04/managed' }] }] }];
  await writeFile(join(directory, 'Local State'), JSON.stringify({ local_test_policies_for_next_startup: JSON.stringify(policy) }) + '\n');
  const executable = join(tmpdir(), 'markbridge-06-filepolicy', 'chrome-win', 'chrome.exe');
  report.chromiumExeSha256 = createHash('sha256').update(await readFile(executable)).digest('hex');
  app = await launch(report.isolationRoot); report.webview = app.webview;
  chrome = await launchChrome(directory, executable); report.chrome = chrome.version;
  const nodes = await until(() => chrome.evaluate(`(async()=>{const roots=await chrome.bookmarks.getTree();const flat=[];function visit(n){flat.push(n);for(const c of n.children??[])visit(c);}roots.forEach(visit);const managed=flat.find(n=>n.title==='R04 受管目录'), child=flat.find(n=>n.title==='R04 受管子目录'), leaf=flat.find(n=>n.title==='R04 受管书签'), bar=flat.find(n=>n.folderType==='bookmarks-bar');return managed&&child&&leaf&&bar?{managed,child,leaf,bar}:null;})()`), 'MANAGED_FIXTURE_MISSING');
  ensure(nodes.managed.unmodifiable === 'managed' || nodes.managed.folderType === 'managed', 'MANAGED_FIXTURE_NOT_PROTECTED');
  const ordinary = await chrome.evaluate(`(async()=>{const folder=await chrome.bookmarks.create({parentId:${JSON.stringify(nodes.bar.id)},title:'R04 普通目录'});return chrome.bookmarks.create({parentId:folder.id,title:'R04 普通书签',url:'https://example.invalid/r04/ordinary'});})()`);
  const profileId = await pair(app, chrome, 'R04 受管临时资料');
  const revision = (await app.invoke('get_bridge_state')).profiles.find(item => item.profileId === profileId).revision;
  const before = await chrome.evaluate('(async()=>JSON.stringify(await chrome.bookmarks.getTree()))()');
  stage = 'batch-protection';
  for (const [label, id] of [['managed', nodes.managed.id], ['descendant_folder', nodes.child.id], ['descendant_bookmark', nodes.leaf.id]]) {
    for (const action of [{ kind: 'delete' }, { kind: 'move', parentId: nodes.bar.id }]) {
      const result = await app.invoke('preview_batch_edit', { profileId, expectedRevision: revision, chromeIds: [ordinary.id, id], action }, true);
      report.lastRejection = { label, action: action.kind, errorCode: result.error ?? null };
      ensure(result.error === 'PROTECTED_NODE', 'BATCH_MANAGED_SELECTION_ACCEPTED');
      pass(`mixed_batch_rejects_${label}_${action.kind}`);
    }
  }
  for (const parentId of [nodes.managed.id, nodes.child.id]) {
    const result = await app.invoke('preview_batch_edit', { profileId, expectedRevision: revision, chromeIds: [ordinary.id], action: { kind: 'move', parentId } }, true);
    ensure(result.error === 'PROTECTED_NODE', 'BATCH_MANAGED_DESTINATION_ACCEPTED');
  }
  ensure(await chrome.evaluate('(async()=>JSON.stringify(await chrome.bookmarks.getTree()))()') === before, 'PROTECTED_REVIEW_CHANGED_TREE');
  pass('managed_destinations_rejected_and_entire_tree_unchanged');
  stage = 'target-picker';
  await app.page.getByRole('button', { name: '新建', exact: true }).click();
  await app.page.locator('.detail-pane .folder-picker > summary').click();
  await app.page.getByLabel('搜索文件夹路径', { exact: true }).fill('R04 受管');
  const options = app.page.getByRole('listbox', { name: '目标文件夹', exact: true }).getByRole('option');
  ensure(await options.count() >= 2, 'MANAGED_PICKER_ROWS_MISSING');
  ensure((await options.evaluateAll(rows => rows.map(row => row.getAttribute('aria-disabled')))).every(value => value === 'true'), 'MANAGED_PICKER_SELECTABLE');
  pass('native_destination_picker_disables_managed_ancestors_and_descendants');
  report.status = 'PASS';
} catch (error) {
  report.status = 'FAIL'; report.failedStage = stage;
  report.failureCode = /^[A-Z][A-Z0-9_:.-]+$/.test(error.message) ? error.message : 'NATIVE_ASSERTION_OR_ACTION_FAILED';
  process.exitCode = 1;
} finally {
  if (app) { try { await cleanCredentials(app); report.temporaryCredentialsRemoved = true; } catch { report.temporaryCredentialsRemoved = false; report.status = 'FAIL'; process.exitCode = 1; } }
  if (chrome) await chrome.close();
  if (app) await app.close();
  report.finishedAt = new Date().toISOString();
  await writeFile(join(evidence, `native-managed-${runId}.json`), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ status: report.status, controls: report.controls.length, failedStage: report.failedStage, failureCode: report.failureCode, temporaryCredentialsRemoved: report.temporaryCredentialsRemoved }));
}
