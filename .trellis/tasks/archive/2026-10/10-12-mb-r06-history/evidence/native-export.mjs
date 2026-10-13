// Actual Windows save dialogs and files, using only disposable app/Chrome data.
import { expect } from '@playwright/test';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { environment, evidence, fixtureRoot, launch, launchChrome, pair, cleanCredentials, until, ensure } from './native-driver.mjs';
import { dialog, waitDialog, lockOutput } from './native-dialog.mjs';

const runId = randomUUID().slice(0, 8);
const report = { runId, startedAt: new Date().toISOString(), controls: [], errors: [] };
let app, chrome, profileId, fixture, releaseLock;
let stage = 'prepare';
const pass = (control, detail = {}) => { report.controls.push({ control, status: 'PASS', ...detail }); console.log(JSON.stringify({ control, status: 'PASS' })); };
const profile = async () => (await app.invoke('get_bridge_state')).profiles.find(item => item.profileId === profileId);
const exportDesk = () => app.page.getByRole('region', { name: '备份导出', exact: true });
const saved = () => exportDesk().getByText('文件已保存到所选位置。', { exact: true });
async function screenshot(name) {
  await mkdir(join(evidence, 'native-screenshots'), { recursive: true });
  await app.page.screenshot({ path: join(evidence, 'native-screenshots', `${runId}-${name}.png`) });
}
async function begin(format) {
  await exportDesk().getByRole('button', { name: format === 'html' ? '导出 HTML' : '导出侧车 JSON', exact: true }).click();
  return waitDialog(app);
}
async function save(path) {
  await dialog(app, 'save', path);
  await expect(saved()).toBeVisible({ timeout: 15000 });
  ensure(!(await readdir(join(report.isolationRoot, 'exports'))).some(name => name.endsWith('.tmp')), 'TEMP_EXPORT_FILE_LEAK');
}
async function parseHtml(path) {
  const html = await readFile(path, 'utf8');
  ensure(html.startsWith('<!DOCTYPE NETSCAPE-Bookmark-file-1>'), 'NOT_NETSCAPE_HTML');
  const marker = html.match(/<!-- Markbridge export (.+) -->/);
  ensure(!!marker, 'MISSING_EXPORT_METADATA');
  const content = await app.page.evaluate(html => {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    return { links: Array.from(doc.querySelectorAll('a')).map(a => ({ title: a.textContent, url: a.getAttribute('href') })), folders: Array.from(doc.querySelectorAll('h3')).map(node => node.textContent) };
  }, html);
  return { metadata: JSON.parse(marker[1]), ...content };
}
try {
  report.environment = await environment();
  report.isolationRoot = await fixtureRoot();
  const outputs = join(report.isolationRoot, 'exports');
  await mkdir(outputs);
  app = await launch(report.isolationRoot); report.webview = app.webview;
  app.page.on('pageerror', () => report.errors.push('NATIVE_PAGE_ERROR'));
  await app.resize(1100, 760);
  chrome = await launchChrome(join(report.isolationRoot, 'chrome-export')); report.chrome = chrome.version;
  fixture = await chrome.evaluate(`(async()=>{const roots=await chrome.bookmarks.getTree();const bar=roots[0].children.find(n=>n.folderType==='bookmarks-bar');const folder=await chrome.bookmarks.create({parentId:bar.id,title:'R06 导出文件夹'});const a=await chrome.bookmarks.create({parentId:folder.id,title:'R06 条目 A < & | 原有竖线',url:'https://example.invalid/r06/a?x=1&y=2'});const b=await chrome.bookmarks.create({parentId:folder.id,title:'R06 条目 B',url:'https://example.invalid/r06/b'});return {folder:folder.id,a:a.id,b:b.id};})()`);
  profileId = await pair(app, chrome, 'R06 导出资料 --> <script>');
  await app.invoke('tag_command', { profileId, command: { kind: 'set_note', chromeIds: [fixture.a], note: 'R06 导出前备注' } });
  await app.invoke('tag_command', { profileId, command: { kind: 'add', chromeIds: [fixture.a], name: 'R06 本地标签' } });
  await app.page.getByRole('button', { name: '设置', exact: true }).click();
  await app.page.getByRole('tab', { name: '备份导出', exact: true }).click();
  await expect(exportDesk()).toBeVisible();
  stage = 'cancel';
  const before = await readdir(outputs);
  report.saveDialog = await begin('html');
  await dialog(app, 'cancel');
  await expect(exportDesk().getByText('已取消保存，没有生成文件。', { exact: true })).toBeVisible();
  ensure(JSON.stringify(await readdir(outputs)) === JSON.stringify(before), 'CANCEL_GENERATED_FILE');
  ensure(!(await readdir(join(report.isolationRoot, 'app-data'))).some(name => name === 'bookmarks.html' || name.startsWith('.markbridge-export-')), 'CANCEL_GENERATED_DEFAULT_FILE');
  ensure(await saved().count() === 0, 'CANCEL_REPORTED_SUCCESS');
  pass('actual_save_dialog_cancel_creates_no_file_and_no_success');

  stage = 'html-snapshot';
  const initial = await profile();
  const cached = await app.invoke('cache_query', { profileId, request: { folderId: null, folderScope: 'all', query: '', tagIds: [], includeSummary: false, includeNote: false, offset: 0, limit: 200, expectedRevision: null, expectedSourceEpoch: null } });
  await begin('html');
  // The immutable snapshot was captured before opening the native dialog.
  await chrome.evaluate(`chrome.bookmarks.update(${JSON.stringify(fixture.a)},{title:'R06 对话框期间外部改名'})`);
  await until(async () => (await profile()).revision > initial.revision, 'LIVE_UPDATE_BLOCKED_BY_SAVE_DIALOG');
  const htmlPath = join(outputs, '书签.html');
  await save(htmlPath);
  const html = await parseHtml(htmlPath);
  ensure(html.metadata.revision === initial.revision && html.metadata.source.id === profileId && html.metadata.sourceEpoch === cached.sourceEpoch, 'HTML_SNAPSHOT_METADATA_MISMATCH');
  ensure(html.links.some(item => item.title === 'R06 条目 A < & | 原有竖线' && item.url.endsWith('a?x=1&y=2')), 'HTML_DID_NOT_PRESERVE_CAPTURED_VALUES');
  ensure(!html.links.some(item => item.title === 'R06 对话框期间外部改名'), 'HTML_MIXED_REVISIONS');
  ensure(html.metadata.displayName === 'R06 导出资料 --> <script>', 'EXPORT_COMMENT_ESCAPING_FAILED');
  pass('native_html_file_parses_and_preserves_pre_dialog_revision_values_and_metadata', { metadata: html.metadata, links: html.links.length });

  stage = 'sidecar-snapshot';
  const sidecarStart = await profile();
  await begin('sidecar');
  await app.invoke('tag_command', { profileId, command: { kind: 'set_note', chromeIds: [fixture.a], note: 'R06 对话框期间更新备注' } });
  const sidecarPath = join(outputs, '侧车.json');
  await save(sidecarPath);
  const sidecar = JSON.parse(await readFile(sidecarPath, 'utf8'));
  ensure(sidecar.schemaVersion === 2 && sidecar.metadata.revision === sidecarStart.revision && sidecar.metadata.source.id === profileId, 'SIDECAR_METADATA_MISMATCH');
  const entry = sidecar.entries.find(item => item.chromeId === fixture.a);
  ensure(entry?.note === 'R06 导出前备注' && JSON.stringify(entry).includes('R06 本地标签'), 'SIDECAR_MIXED_OR_LOST_LOCAL_VALUES');
  pass('native_sidecar_file_parses_with_consistent_local_metadata_and_snapshot', { metadata: sidecar.metadata, entries: sidecar.entries.length });

  stage = 'locked-destination';
  const lockedPath = join(outputs, '占用.json');
  await writeFile(lockedPath, 'R06 preserved destination');
  releaseLock = await lockOutput(app, lockedPath);
  await begin('sidecar');
  await dialog(app, 'save', lockedPath);
  let boundary;
  report.lockDialogs = [];
  for (let attempt = 0; attempt < 8; attempt++) {
    await delay(300);
    if (await exportDesk().getByRole('alert').count()) { boundary = 'rust_write_failed'; break; }
    const windows = await dialog(app);
    report.lockDialogs.push(windows);
    if (windows.dialogs?.some(item => item.controls.some(control => control.startsWith('6:')) || item.buttons?.some(button => /:&?Yes$/.test(button)))) await dialog(app, 'confirm-overwrite');
    else if (windows.dialogs?.some(item => (item.controls.some(control => control.startsWith('1:')) && !item.controls.some(control => control.startsWith('2:'))) || item.buttons?.some(button => /:&?OK$/.test(button)))) {
      boundary = 'native_dialog_rejected_locked_destination';
      await dialog(app, 'dismiss-error'); await dialog(app, 'cancel'); break;
    }
  }
  ensure(!!boundary, 'LOCK_FAILURE_NOT_OBSERVED');
  ensure(await saved().count() === 0, 'LOCK_FAILURE_REPORTED_SUCCESS');
  await releaseLock(); releaseLock = null;
  ensure(await readFile(lockedPath, 'utf8') === 'R06 preserved destination', 'FAILED_EXPORT_OVERWROTE_DESTINATION');
  await begin('sidecar');
  await save(join(outputs, '重试.json'));
  ensure(JSON.parse(await readFile(join(outputs, '重试.json'), 'utf8')).schemaVersion === 2, 'RETRY_FILE_INVALID');
  pass('actual_locked_destination_preserved_no_success_and_retry_saved', { boundary });

  stage = 'offline';
  await chrome.close(); chrome = null;
  await until(async () => (await profile()).connection !== 'live', 'SOURCE_NOT_OFFLINE');
  await begin('html'); await save(join(outputs, '离线.html'));
  ensure((await parseHtml(join(outputs, '离线.html'))).links.length === 2, 'OFFLINE_EXPORT_LOST_CACHE');
  pass('disconnected_profile_exports_real_cached_file');

  stage = 'mirror';
  const mirrorRoot = join(report.isolationRoot, 'synthetic-file');
  await mkdir(join(mirrorRoot, 'Default'), { recursive: true });
  await writeFile(join(mirrorRoot, 'Local State'), JSON.stringify({ profile: { info_cache: { Default: { name: 'R06 只读合成资料' } } } }));
  await writeFile(join(mirrorRoot, 'Default', 'Bookmarks'), JSON.stringify({ version: 1, checksum: 'synthetic', roots: {
    bookmark_bar: { id: '1', name: 'R06 镜像文件夹', type: 'folder', children: [{ id: '10', name: 'R06 镜像条目', type: 'url', url: 'https://example.invalid/r06/mirror' }] },
    other: { id: '2', name: '其他', type: 'folder', children: [] }, synced: { id: '3', name: '移动', type: 'folder', children: [] },
  } }));
  await app.page.getByRole('tab', { name: 'Chrome 连接', exact: true }).click();
  if (!await app.page.locator('#user-data-path').isVisible()) await app.page.getByText('选择只读文件目录', { exact: true }).click();
  await app.page.locator('#user-data-path').fill(mirrorRoot);
  await app.page.getByRole('button', { name: '枚举资料', exact: true }).click();
  await app.page.getByRole('button', { name: '接入只读镜像', exact: true }).click();
  await app.page.getByRole('button', { name: '浏览缓存', exact: true }).click();
  await app.page.getByRole('button', { name: '设置', exact: true }).click();
  await app.page.getByRole('tab', { name: '备份导出', exact: true }).click();
  await expect(exportDesk()).toContainText('只读文件缓存');
  ensure(await exportDesk().getByRole('button', { name: '导出侧车 JSON', exact: true }).count() === 0, 'MIRROR_OFFERED_SIDECAR');
  await begin('html'); await save(join(outputs, '镜像.html'));
  const mirror = await parseHtml(join(outputs, '镜像.html'));
  ensure(mirror.metadata.source.kind === 'mirror' && mirror.metadata.sourceEpoch === null && mirror.links[0].title === 'R06 镜像条目', 'MIRROR_FILE_INVALID');
  const denied = await app.invoke('save_export', { source: mirror.metadata.source, format: 'sidecar' });
  ensure(denied.status === 'failed' && denied.errorCode === 'READ_ONLY' && !(await dialog(app)).found, 'MIRROR_SIDECAR_NOT_REJECTED_BEFORE_DIALOG');
  for (const [width, height] of [[1440, 900], [1100, 760], [640, 760], [640, 480]]) {
    await app.resize(width, height);
    ensure(await app.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'EXPORT_HORIZONTAL_OVERFLOW');
    await screenshot(`export-${width}x${height}`);
  }
  pass('readonly_mirror_exports_html_only_with_source_cache_time_and_small_window');
  ensure(report.errors.length === 0, 'PAGE_ERRORS');
  report.status = 'PASS';
} catch (error) {
  report.status = 'FAIL'; report.failedStage = stage;
  report.failureCode = /^[A-Z][A-Z0-9_:.-]+$/.test(error.message) ? error.message : 'NATIVE_ASSERTION_OR_ACTION_FAILED';
  if (error.helperDiagnostic) report.helperDiagnostic = error.helperDiagnostic;
  if (app) await screenshot('failure').catch(() => {});
  process.exitCode = 1;
} finally {
  if (releaseLock) await releaseLock().catch(() => {});
  if (app) {
    await dialog(app, 'dismiss-error').catch(() => {}); await dialog(app, 'cancel').catch(() => {});
    try { await cleanCredentials(app); report.temporaryCredentialsRemoved = true; } catch { report.temporaryCredentialsRemoved = false; report.status = 'FAIL'; process.exitCode = 1; }
  }
  if (chrome) await chrome.close();
  if (app) await app.close();
  report.finishedAt = new Date().toISOString();
  await writeFile(join(evidence, `native-export-${runId}.json`), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ status: report.status, controls: report.controls.length, failedStage: report.failedStage, failureCode: report.failureCode, temporaryCredentialsRemoved: report.temporaryCredentialsRemoved }));
}
