// Actual Tauri UI + production extension in two disposable Chrome profiles.
// Tickets stay in memory. Screenshots mask ticket controls; no raw DOM/IPC dumps.
import { expect } from '@playwright/test';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { version, release, arch } from 'node:os';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { repo, evidence, launchDesktop, launchChrome, until, availablePort, extensionHash } from './native-driver.mjs';

const runId = randomUUID().slice(0, 8);
const report = { runId, startedAt: new Date().toISOString(), machine: { version: version(), release: release(), arch: arch() }, scope: 'R02 actual Tauri + two temporary Chrome profiles; no daily profile or mock IPC', controls: [], screenshots: [], errors: [], realOsSleep: 'DEFERRED_BY_USER_TO_R08' };
const browsers = [];
let desktop;
let occupied;
let stage = 'launch';
function ensure(condition, code) { if (!condition) throw new Error(code); }
function passed(control, detail = {}) { report.controls.push({ control, status: 'PASS', ...detail }); console.log(JSON.stringify({ control, status: 'PASS' })); }
async function settings() {
  await desktop.page.getByRole('button', { name: '设置', exact: true }).click();
  await desktop.page.getByRole('tab', { name: 'Chrome 连接', exact: true }).click();
}
async function screenshot(name) {
  await desktop.page.screenshot({ path: join(evidence, 'native-screenshots', `${runId}-${name}.png`), mask: [desktop.page.locator('#pairing-code')] });
  report.screenshots.push({ name, ...await desktop.page.evaluate(() => ({ width: innerWidth, height: innerHeight, scale: devicePixelRatio })) });
}
async function createBookmark(client, title) {
  return client.evaluate(`(async () => {
    const tree = await chrome.bookmarks.getTree();
    const parent = tree[0].children.find(node => node.folderType === 'bookmarks-bar' && !node.unmodifiable);
    if (!parent) throw Error('NO_WRITABLE_FIXTURE_ROOT');
    return chrome.bookmarks.create({ parentId: parent.id, title: ${JSON.stringify(title)}, url: 'https://example.invalid/r02' });
  })()`);
}
async function pair(client, name, invalidFirst = false) {
  await settings();
  await desktop.page.locator('#profile-name').fill(name);
  await desktop.page.getByRole('button', { name: /生成配对串/ }).click();
  let ticket = await desktop.page.locator('#pairing-code').inputValue();
  ensure(ticket.length > 0, 'EMPTY_PAIRING_TICKET');
  if (invalidFirst) {
    const invalid = JSON.parse(ticket);
    invalid.credential = 'invalid-r02-fixture-credential-long-enough';
    await client.evaluate(`document.querySelector('#pairing-code').value=${JSON.stringify(JSON.stringify(invalid))};document.querySelector('#pair').click();true`);
    await until(async () => {
      const status = await client.evaluate(`chrome.runtime.sendMessage({type:'status'})`);
      return status.state === 'pending' || status.state === 'error';
    }, 'WRONG_TICKET_ATTEMPT_NOT_OBSERVED');
    // Authentication deliberately does not distinguish a wrong token from an unconfirmed pair.
    await delay(1300);
    const before = await desktop.state();
    ensure(before.profiles.length === 0 && before.pending.every((item) => item.instanceId === null), 'WRONG_TICKET_CREATED_PROFILE');
    passed('invalid_extension_ticket_creates_no_profile');
    // Reset only this test extension after its intentionally invalid ticket.
    await client.evaluate(`chrome.runtime.sendMessage({type:'forget'})`);
    await until(() => client.evaluate(`!document.querySelector('#pair').disabled`), 'PAIR_BUTTON_NOT_READY');
  }
  await client.evaluate(`document.querySelector('#pairing-code').value=${JSON.stringify(ticket)};document.querySelector('#pair').click();true`);
  ticket = '';
  const pending = await until(async () => (await desktop.state()).pending.find((item) => item.displayName === name && item.instanceId), 'PAIRING_NOT_PENDING');
  ensure(pending.origin === `chrome-extension://${client.extensionId}`, 'PENDING_ORIGIN_MISMATCH');
  ensure(!(await desktop.state()).profiles.some((profile) => profile.profileId === pending.profileId), 'PAIRED_BEFORE_DESKTOP_CONFIRM');
  await desktop.page.getByRole('button', { name: '确认此扩展', exact: true }).click();
  const profile = await until(async () => (await desktop.state()).profiles.find((item) => item.profileId === pending.profileId && item.connection === 'live'), 'PROFILE_NOT_LIVE');
  ensure(await client.evaluate(`document.querySelector('#pairing-code').value === ''`), 'EXTENSION_TICKET_NOT_CLEARED');
  passed('explicit_two_end_pairing', { profileId: profile.profileId, nodeCount: profile.nodeCount });
  return profile.profileId;
}
async function chooseProfile(profileId, expectedTitle, absentTitle) {
  await desktop.page.getByRole('button', { name: '书签', exact: true }).click();
  await desktop.page.locator('#library-source').selectOption(`profile:${profileId}`);
  const search = desktop.page.locator('#library-search');
  await search.fill('R02 合成');
  await expect(desktop.page.getByRole('option').filter({ hasText: expectedTitle })).toBeVisible();
  await expect(desktop.page.getByRole('option').filter({ hasText: absentTitle })).toHaveCount(0);
}

try {
  await mkdir(join(evidence, 'native-screenshots'), { recursive: true });
  desktop = await launchDesktop();
  report.isolationRoot = desktop.root;
  report.nativeHash = desktop.hash;
  report.extensionHash = await extensionHash();
  report.webview = desktop.webviewVersion;
  desktop.page.on('pageerror', () => report.errors.push('NATIVE_PAGE_ERROR'));
  ensure((await desktop.state()).profiles.length === 0, 'ISOLATION_NOT_EMPTY');
  await desktop.resize(1100, 760);
  await screenshot('onboarding');
  await desktop.resize(640, 480);
  await screenshot('onboarding-640x480');
  await desktop.resize(1100, 760);

  stage = 'port-conflict';
  await settings();
  const portInput = desktop.page.locator('#bridge-port');
  if (!await portInput.isVisible()) await desktop.page.locator('details:has(#bridge-port) > summary').click();
  occupied = createServer();
  await new Promise((done) => occupied.listen(0, '127.0.0.1', done));
  await portInput.fill(String(occupied.address().port));
  await desktop.page.getByRole('button', { name: '启动连接', exact: true }).click();
  await expect(desktop.page.getByRole('alert')).toContainText('端口');
  ensure((await desktop.state()).port === null, 'PORT_CONFLICT_REPORTED_LISTENING');
  await new Promise((done) => occupied.close(done));
  occupied = null;
  const port = await availablePort();
  await portInput.fill(String(port));
  await desktop.page.getByRole('button', { name: '启动连接', exact: true }).click();
  await until(async () => (await desktop.state()).port === port, 'LISTENER_NOT_READY');
  passed('port_conflict_recovery_through_ui');

  stage = 'two-profile-pairing';
  const first = await launchChrome(join(desktop.root, 'chrome-a')); browsers.push(first);
  const firstNode = await createBookmark(first, 'R02 合成 A');
  const firstId = await pair(first, 'R02 临时 A', true);
  const second = await launchChrome(join(desktop.root, 'chrome-b')); browsers.push(second);
  const secondNode = await createBookmark(second, 'R02 合成 B');
  const secondId = await pair(second, 'R02 临时 B');
  report.chrome = first.version;
  ensure(firstNode.id === secondNode.id, 'FIXTURE_IDS_NOT_EQUAL');

  stage = 'source-isolation';
  await chooseProfile(firstId, 'R02 合成 A', 'R02 合成 B');
  await chooseProfile(secondId, 'R02 合成 B', 'R02 合成 A');
  await chooseProfile(firstId, 'R02 合成 A', 'R02 合成 B');
  passed('equal_chrome_id_distinct_profile_ui', { sharedChromeId: firstNode.id });
  await screenshot('live-source-a');

  stage = 'disconnect';
  await first.close();
  await until(async () => (await desktop.state()).profiles.find((item) => item.profileId === firstId)?.connection !== 'live', 'DISCONNECT_NOT_OBSERVED');
  ensure((await desktop.state()).profiles.find((item) => item.profileId === secondId)?.connection === 'live', 'PEER_LOST_CONNECTION');
  await expect(desktop.page.locator('.connection')).toContainText('只读');
  await expect(desktop.page.getByRole('option').filter({ hasText: 'R02 合成 A' })).toBeVisible();
  passed('selected_source_is_readonly_while_peer_remains_live');
  await screenshot('selected-source-offline');

  stage = 'restart-recovery';
  const restarted = await launchChrome(first.directory); browsers.push(restarted);
  await until(async () => (await desktop.state()).profiles.find((item) => item.profileId === firstId)?.connection === 'live', 'RESTART_NOT_RECONCILED');
  await chooseProfile(firstId, 'R02 合成 A', 'R02 合成 B');
  passed('temporary_chrome_restart_reconciles_cache');

  stage = 'revoke';
  await settings();
  const profileArticle = desktop.page.locator('article').filter({ has: desktop.page.getByRole('heading', { name: 'R02 临时 B', exact: true }) });
  await profileArticle.getByRole('button', { name: '吊销配对', exact: true }).click();
  ensure((await desktop.state()).profiles.find((item) => item.profileId === secondId)?.connection === 'live', 'REVOKED_BEFORE_CONFIRM');
  await desktop.resize(640, 480);
  await screenshot('revoke-640x480');
  await desktop.page.getByRole('button', { name: /确认.*吊销|确认.*撤销/ }).click();
  await until(async () => (await desktop.state()).profiles.find((item) => item.profileId === secondId)?.connection === 'unpaired', 'REVOKE_NOT_APPLIED');
  passed('revoke_requires_explicit_confirmation');
  await second.evaluate(`document.querySelector('#forget').click();true`);
  ensure(await second.evaluate(`!document.querySelector('#forget-confirm').hidden && document.activeElement.id === 'forget-cancel'`), 'EXTENSION_FORGET_CONFIRM_FOCUS');
  await second.evaluate(`document.querySelector('#forget-accept').click();true`);
  await until(async () => (await second.evaluate(`chrome.runtime.sendMessage({type:'status'})`)).state === 'unpaired', 'EXTENSION_FORGET_NOT_APPLIED');
  ensure(await second.evaluate(`document.querySelector('#forget-confirm').hidden && document.activeElement.id === 'forget'`), 'EXTENSION_FORGET_RETURN_FOCUS');
  passed('extension_forget_confirmation_and_visible_focus');

  stage = 'readonly-file-source';
  await desktop.resize(1100, 760);
  const fileRoot = join(desktop.root, 'synthetic-file-source');
  await mkdir(join(fileRoot, 'Default'), { recursive: true });
  await writeFile(join(fileRoot, 'Local State'), JSON.stringify({ profile: { info_cache: { Default: { name: 'R02 文件资料' } } } }));
  const fileTree = JSON.parse(await readFile(join(repo, 'tests/fixtures/bookmarks/bookmarks-personal.json'), 'utf8'));
  fileTree.roots.bookmark_bar.children = [{ id: '5', name: 'R02 文件缓存', type: 'url', url: 'https://example.invalid/file-fixture' }];
  const bookmarksFile = join(fileRoot, 'Default', 'Bookmarks');
  const originalFile = JSON.stringify(fileTree);
  await writeFile(bookmarksFile, originalFile);
  const directoryInput = desktop.page.locator('#user-data-path');
  if (!await directoryInput.isVisible()) await desktop.page.getByText('选择只读文件目录', { exact: true }).click();
  await directoryInput.fill(fileRoot);
  await desktop.page.getByRole('button', { name: '枚举资料', exact: true }).click();
  await desktop.page.getByRole('button', { name: '接入只读镜像', exact: true }).click();
  const mirror = await until(async () => (await desktop.state()).mirrors.find((item) => item.fileStatus === 'current'), 'FILE_MIRROR_NOT_CURRENT');
  await desktop.page.getByRole('button', { name: '浏览缓存', exact: true }).click();
  await expect(desktop.page.locator('#library-source')).toHaveValue(`mirror:${mirror.mirrorSourceId}`);
  await desktop.page.locator('#library-search').fill('R02 文件缓存');
  await expect(desktop.page.getByRole('option').filter({ hasText: 'R02 文件缓存' })).toBeVisible();
  await expect(desktop.page.locator('.connection')).toContainText('只读');
  ensure(await readFile(bookmarksFile, 'utf8') === originalFile, 'READONLY_FILE_MUTATED');
  passed('file_source_ui_attach_browse_and_readonly');
  // Corrupt only our synthetic fixture; the watcher must retain the last good tree.
  await writeFile(bookmarksFile, '{');
  await until(async () => (await desktop.state()).mirrors.find((item) => item.mirrorSourceId === mirror.mirrorSourceId)?.fileStatus === 'stale', 'FILE_STALE_NOT_OBSERVED');
  await expect(desktop.page.getByRole('option').filter({ hasText: 'R02 文件缓存' })).toBeVisible();
  await screenshot('stale-file-cache');
  passed('invalid_file_retains_cache_and_readonly');
  ensure(report.errors.length === 0, 'PAGE_ERRORS');
  report.status = 'PASS';
} catch (error) {
  report.status = 'FAIL';
  report.failedStage = stage;
  // Error messages from browser locators can contain credential-bearing DOM: store only a safe stage/code.
  report.failureCode = /^[A-Z][A-Z0-9_:.-]+$/.test(error.message) ? error.message : 'NATIVE_ASSERTION_OR_ACTION_FAILED';
  if (desktop) await screenshot(`failure-${stage}`).catch(() => {});
  process.exitCode = 1;
} finally {
  if (occupied) await new Promise((done) => occupied.close(done));
  if (desktop) {
    try { await desktop.cleanCredentials(); report.temporaryCredentialsRemoved = true; }
    catch { report.temporaryCredentialsRemoved = false; report.status = 'FAIL'; process.exitCode = 1; }
  }
  for (const browser of browsers) await browser.close();
  if (desktop) await desktop.close();
  report.finishedAt = new Date().toISOString();
  await writeFile(join(evidence, `native-${runId}.json`), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ status: report.status, failedStage: report.failedStage, failureCode: report.failureCode, controls: report.controls.length, temporaryCredentialsRemoved: report.temporaryCredentialsRemoved }));
}
