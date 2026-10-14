// Current copied executable, disposable Rust-seeded cache, real main-window IPC.
import { expect } from '@playwright/test';
import { copyFile, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { tmpdir, version } from 'node:os';
import { join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

let repo = resolve(import.meta.dirname);
while (!existsSync(join(repo, 'pnpm-workspace.yaml'))) repo = resolve(repo, '..');
const { launchInstalled, system, until, ensure, startProbe, dialog, waitDialog } = await import(pathToFileURL(join(repo, '.trellis/tasks/10-10-mb-13-windows-acceptance/evidence/current-native-driver.mjs')).href);
const root = await mkdtemp(join(tmpdir(), 'markbridge-task13-native-c04-'));
const runId = `run-${Date.now()}-${randomUUID().slice(0, 8)}`;
const output = join(import.meta.dirname, 'native', runId);
await mkdir(output, { recursive: true });
await mkdir(join(root, 'install')); await mkdir(join(root, 'app-data'));
const executable = join(root, 'install/markbridge-desktop.exe');
await copyFile(join(repo, 'target/x86_64-pc-windows-msvc/release/markbridge-desktop.exe'), executable);
const exe = await readFile(executable), run = promisify(execFile);
const fingerprint = JSON.parse(await readFile(join(import.meta.dirname, 'current-source.json'), 'utf8'));
const result = { runId, startedAt: new Date().toISOString(), os: version(), root, executable,
  appData: join(root, 'app-data'), productionSourceFingerprint: fingerprint.productionFingerprint, completeSourceFingerprint: fingerprint.completeSourceFingerprint,
  exeSha256: createHash('sha256').update(exe).digest('hex'), exeBytes: exe.length,
  installation: 'NOT_RUN', chrome: 'NOT_RUN', fontsInstalledOrRemoved: 'NOT_RUN', controls: [], screens: [] };
const plan = { root, executable, installDirectory: join(root, 'install'), appData: result.appData, namespace: `Markbridge.Task06.c04-${randomUUID()}` };
const key = 'markbridge.ui-preferences.v2', oldKey = 'markbridge.ui-preferences.v1';
let app, probe, stage = 'seed';
const commands = [], remoteFontRequests = [];
const pass = (name, detail = {}) => { result.controls.push({ name, status: 'PASS', ...detail }); console.log(JSON.stringify({ name, status: 'PASS' })); };
const general = async () => { await app.page.getByRole('button', { name: '设置', exact: true }).click(); await expect(app.page.getByRole('tab', { name: '通用', exact: true })).toHaveAttribute('aria-selected', 'true'); };
const preferences = () => app.page.evaluate(key => localStorage.getItem(key), key);
async function windowState(width, height, screenshot, monitorIndex) {
  const scale = await app.page.evaluate(() => devicePixelRatio);
  const args = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(import.meta.dirname, 'native-window.ps1'), '-TargetProcessId', String(app.child.pid), '-IsolationRoot', root, '-MainTitle', 'Markbridge · 签桥'];
  if (width) args.push('-ClientWidth', String(Math.round(width * scale)), '-ClientHeight', String(Math.round(height * scale)));
  if (screenshot) args.push('-OutPath', screenshot);
  if (monitorIndex !== undefined) args.push('-MonitorIndex', String(monitorIndex));
  const os = JSON.parse((await run('powershell', args, { windowsHide: true, timeout: 20000 })).stdout.trim());
  if (width) await until(() => app.page.evaluate(({ width, height }) => innerWidth === width && innerHeight === height, { width, height }), 'NATIVE_RESIZE_MISMATCH');
  return os;
}
async function snapshot(name) {
  const geometry = await app.page.evaluate(() => ({ width: innerWidth, height: innerHeight, dpr: devicePixelRatio,
    documentWidth: document.documentElement.scrollWidth, documentHeight: document.documentElement.scrollHeight,
    text: getComputedStyle(document.documentElement).fontSize }));
  ensure(geometry.width === geometry.documentWidth && geometry.height === geometry.documentHeight, 'DOCUMENT_OVERFLOW');
  await app.page.screenshot({ path: join(output, `${name}.png`) });
  result.screens.push({ name, geometry });
}
async function glyphs(selector) {
  const session = await app.page.context().newCDPSession(app.page);
  try {
    await session.send('DOM.enable'); await session.send('CSS.enable');
    const { root: document } = await session.send('DOM.getDocument');
    const { nodeId } = await session.send('DOM.querySelector', { nodeId: document.nodeId, selector });
    ensure(nodeId > 0, 'GLYPH_SAMPLE_NOT_FOUND');
    const { fonts } = await session.send('CSS.getPlatformFontsForNode', { nodeId });
    ensure(fonts.some(font => font.glyphCount > 0), 'NO_RENDERED_GLYPH_EVIDENCE');
    return fonts.map(({ familyName, postScriptName, isCustomFont, glyphCount }) => ({ familyName, postScriptName, isCustomFont, glyphCount }));
  } finally { await session.detach(); }
}
async function choose(family, apply = true) {
  const before = await preferences();
  const appliedFamily = await app.page.evaluate(() => getComputedStyle(document.body).fontFamily);
  await app.page.getByRole('button', { name: '选择字体', exact: true }).click();
  const picker = app.page.getByRole('dialog', { name: '选择字体', exact: true });
  await expect(picker).toBeVisible();
  await picker.getByRole('searchbox').fill(family);
  const option = picker.getByRole('option').filter({ hasText: family }).first();
  await expect(option).toBeVisible(); await option.click();
  ensure(await preferences() === before && await app.page.evaluate(() => getComputedStyle(document.body).fontFamily) === appliedFamily, 'CANDIDATE_CHANGED_GLOBAL_PREFERENCES');
  const rendering = { family, latin: await glyphs('.font-picker-sample [lang="en"]'), cjk: await glyphs('.font-picker-sample [lang="zh-CN"]') };
  await snapshot(`font-${family.replace(/[^a-z0-9]+/gi, '-')}-candidate`);
  if (apply) await picker.getByRole('button', { name: '使用此字体', exact: true }).click();
  else { await app.page.keyboard.press('Escape'); ensure(await preferences() === before, 'CANCEL_WROTE_PREFERENCES'); }
  await expect(picker).toHaveCount(0);
  await expect(app.page.getByRole('button', { name: '选择字体', exact: true })).toBeFocused();
  return rendering;
}
async function size(value) {
  await app.page.getByLabel('字号', { exact: true }).fill(String(value));
  await app.page.getByLabel('字号', { exact: true }).press('Enter');
  await expect.poll(() => app.page.evaluate(() => getComputedStyle(document.documentElement).fontSize)).toBe(`${value}px`);
}
async function reachable(locator) {
  await locator.scrollIntoViewIfNeeded();
  const bounds = await locator.evaluate(node => {
    const box = element => { const r = element.getBoundingClientRect(); return { x: r.x, y: r.y, right: r.right, bottom: r.bottom, width: r.width, height: r.height }; };
    const parents = []; let parent = node.parentElement;
    while (parent) { if (/(auto|scroll|hidden|clip)/.test(getComputedStyle(parent).overflowY)) parents.push(box(parent)); parent = parent.parentElement; }
    return { control: box(node), parents, width: innerWidth, height: innerHeight };
  });
  const b = bounds.control;
  ensure(b.width > 0 && b.height > 0 && b.x >= -1 && b.y >= -1 && b.right <= bounds.width + 1 && b.bottom <= bounds.height + 1, 'NATIVE_ACTION_OUTSIDE_VIEWPORT');
  ensure(bounds.parents.every(p => b.y >= p.y - 1 && b.bottom <= p.bottom + 1), 'NATIVE_ACTION_CLIPPED');
  return bounds;
}
try {
  const common = { folderType: null, unmodifiable: null, dateAdded: null, dateLastUsed: null };
  const nodes = [{ ...common, chromeId: '0', parentId: null, position: 0, kind: 'folder', title: '根', url: null },
    { ...common, chromeId: '1', parentId: '0', position: 0, kind: 'folder', title: 'C04 临时书签', url: null },
    ...Array.from({ length: 120 }, (_, index) => ({ ...common, chromeId: String(index + 10), parentId: '1', position: index, kind: 'bookmark', title: `C04 Reference ${String(index).padStart(3, '0')}`, url: `https://example.invalid/c04/${index}` }))];
  const nodesPath = join(root, 'nodes.json'); await writeFile(nodesPath, JSON.stringify(nodes));
  const seeder = join(repo, 'target/x86_64-pc-windows-msvc/debug/examples/seed_profile_cache.exe');
  const seeded = await run(seeder, [join(result.appData, 'markbridge.sqlite'), nodesPath], { windowsHide: true, timeout: 30000 });
  ensure(seeded.stdout.trim() === 'SEED_OK nodes=122', 'FIXTURE_NOT_SEEDED');
  result.seed = { nodes: nodes.length, seederSha256: createHash('sha256').update(await readFile(seeder)).digest('hex'), exitCode: 0 };
  stage = 'launch'; app = await launchInstalled(plan);
  result.firstPid = app.child.pid; result.webview = app.webview; result.mainDataEvidence = app.mainDataEvidence;
  app.page.on('request', request => { const url = new URL(request.url());
    if (url.hostname === 'ipc.localhost' || url.protocol === 'ipc:') commands.push(url.pathname.slice(1));
    if (request.resourceType() === 'font' && /^https?:$/.test(url.protocol)) remoteFontRequests.push(url.origin);
  });
  await app.invoke('get_bridge_state'); ensure(commands.includes('get_bridge_state'), 'IPC_OBSERVER_NOT_CALIBRATED');
  await general(); await windowState(1100, 760);
  ensure(!commands.includes('list_installed_fonts'), 'GENERAL_ENUMERATED_FONTS');
  ensure(await preferences() === null, 'STARTUP_WROTE_PREFERENCES');
  pass('ordinary_general_does_not_enumerate_or_persist');
  stage = 'catalog';
  const catalog = await app.invoke('list_installed_fonts');
  ensure(catalog.status === 'ready' && catalog.families.length > 0 && catalog.families.length <= 10000, 'REAL_CATALOG_UNAVAILABLE');
  const chosen = ['Arial', 'Microsoft YaHei UI', 'SimSun'].map(family => catalog.families.find(item => item.family === family));
  ensure(chosen.every(Boolean), 'INDEPENDENT_GDI_CANDIDATES_NOT_FOUND');
  result.catalog = { count: catalog.families.length, selected: chosen, method: 'real main-window DirectWrite IPC', crossCheck: '../../font-crosscheck.json' };
  pass('real_local_font_catalog_crosschecked_cjk_latin', result.catalog);
  stage = 'fonts'; const appearanceStart = commands.length;
  result.rendering = [];
  result.rendering.push(await choose('Arial', false));
  result.rendering.push(await choose('Microsoft YaHei UI'));
  const applied = JSON.parse(await preferences());
  ensure(applied.font.kind === 'installed' && applied.font.family === 'Microsoft YaHei UI', 'FONT_NOT_SAVED');
  ensure(result.rendering[0].latin.some(font => /Arial/i.test(font.familyName)), 'ARIAL_NOT_ACTUALLY_RENDERED');
  ensure(result.rendering[0].cjk.some(font => !/Arial/i.test(font.familyName) && font.glyphCount > 0), 'LATIN_CJK_FALLBACK_NOT_OBSERVED');
  ensure(result.rendering[1].cjk.some(font => /YaHei/i.test(font.familyName)), 'CJK_FONT_NOT_ACTUALLY_RENDERED');
  pass('real_candidate_glyphs_cancel_apply_and_focus', { rendering: result.rendering });
  stage = 'geometry'; result.metrics = [];
  for (const n of [12, 14, 20]) {
    await size(n); await app.page.getByRole('button', { name: '书签', exact: true }).click();
    await app.page.locator('#library-search').fill('C04 Reference');
    await expect(app.page.getByRole('status').filter({ hasText: '已加载 120 / 120' })).toBeVisible();
    const geometry = await app.page.evaluate(() => ({ text: getComputedStyle(document.documentElement).fontSize,
      tree: document.querySelector('[role="tree"] .library-row').getBoundingClientRect().height,
      bookmark: document.querySelector('[role="listbox"] .library-row').getBoundingClientRect().height }));
    ensure(geometry.text === `${n}px` && geometry.tree === ({ 12: 40, 14: 40, 20: 48 })[n] && geometry.bookmark === ({ 12: 52, 14: 56, 20: 76 })[n], 'NATIVE_METRICS_MISMATCH');
    result.metrics.push({ fontSizePx: n, ...geometry }); await snapshot(`library-${n}`); await general();
  }
  pass('shared_native_font_and_row_metrics', { measurements: result.metrics });
  await windowState(640, 480); await snapshot('general-20-small');
  await choose('SimSun', false); await windowState(1100, 760);
  stage = 'anchor'; await app.page.getByRole('button', { name: '书签', exact: true }).click();
  await app.page.getByRole('option', { name: /C04 Reference 000/ }).click();
  await app.page.getByRole('tab', { name: '标签备注', exact: true }).click();
  await app.page.getByLabel('备注', { exact: true }).fill('C04 未保存原生草稿');
  const list = app.page.getByRole('listbox', { name: '搜索结果', exact: true });
  await list.evaluate(node => { node.scrollTop = 30 * 76 + 11; });
  const oldScroll = await list.evaluate(node => node.scrollTop);
  await general(); await size(14); await app.page.getByRole('button', { name: '书签', exact: true }).click();
  const expectedScroll = Math.floor(oldScroll / 76) * 56 + oldScroll % 76;
  await expect.poll(() => list.evaluate((node, expected) => Math.abs(node.scrollTop - expected) < 1, expectedScroll)).toBe(true);
  await expect(app.page.getByLabel('备注', { exact: true })).toHaveValue('C04 未保存原生草稿');
  await expect(app.page.getByRole('checkbox', { name: '选择 C04 Reference 000', exact: true })).toBeChecked();
  await app.page.getByRole('option', { name: /C04 Reference 000/ }).focus(); await app.page.keyboard.press('End');
  await app.page.getByRole('button', { name: '放弃草稿并继续', exact: true }).click();
  const last = list.locator('[aria-posinset="120"]'); await expect(last).toBeInViewport();
  await last.locator('input[type="checkbox"]').focus(); await app.page.keyboard.press('Space');
  await expect(last.locator('input[type="checkbox"]')).toBeFocused();
  await general(); await size(20); await app.page.getByRole('button', { name: '书签', exact: true }).click();
  await expect(list.locator('[aria-posinset="120"]')).toBeInViewport();
  pass('native_hidden_list_anchor_bottom_checkbox_and_draft', { oldScroll, expectedScroll, toleranceCssPx: 1 });
  await general(); await app.page.getByRole('button', { name: '深色', exact: true }).click();
  stage = 'actual-monitor-dpi'; result.displays = [];
  const inventory = await windowState(); const seenDpi = new Set();
  for (let monitor = 0; monitor < inventory.monitors.length; monitor++) {
    await windowState(undefined, undefined, undefined, monitor);
    await until(async () => { const os = await windowState(); return await app.page.evaluate(() => devicePixelRatio) === os.dpi / 96; }, 'NATIVE_DPI_DPR_MISMATCH');
    const observed = await windowState();
    if (seenDpi.has(observed.dpi) || ![120, 144].includes(observed.dpi)) continue;
    seenDpi.add(observed.dpi);
    for (const theme of ['light', 'dark']) {
      await general(); await app.page.getByRole('button', { name: theme === 'light' ? '浅色' : '深色', exact: true }).click();
      for (const [width, height] of [[1100, 760], [640, 480]]) {
        await general(); const os = await windowState(width, height);
        const geometry = await app.page.evaluate(() => ({ width: innerWidth, height: innerHeight, dpr: devicePixelRatio, text: getComputedStyle(document.documentElement).fontSize }));
        ensure(geometry.dpr === os.dpi / 96 && geometry.text === '20px' && os.clientWidth === Math.round(width * geometry.dpr) && os.clientHeight === Math.round(height * geometry.dpr), 'ACTUAL_DPI_DIMENSION_MISMATCH');
        const name = `dpi-${os.dpi}-${theme}-20-${width}x${height}`;
        await app.page.locator('.settings-scroll').evaluate(node => { node.scrollTop = 0; });
        await snapshot(`${name}-general`);
        const reset = await reachable(app.page.getByRole('button', { name: '恢复默认外观', exact: true }));
        await app.page.getByRole('button', { name: '选择字体', exact: true }).click();
        const picker = app.page.getByRole('dialog', { name: '选择字体', exact: true });
        await picker.getByRole('searchbox').fill('Microsoft YaHei UI');
        await picker.getByRole('option').filter({ hasText: 'Microsoft YaHei UI' }).first().click();
        const apply = await reachable(picker.getByRole('button', { name: '使用此字体', exact: true }));
        await snapshot(`${name}-font-picker`); await app.page.keyboard.press('Escape');
        await expect(app.page.getByRole('button', { name: '选择字体', exact: true })).toBeFocused();
        await app.page.getByRole('button', { name: '书签', exact: true }).click();
        const closeDetails = app.page.getByRole('button', { name: '关闭详情，返回列表', exact: true });
        if (await closeDetails.isVisible()) await closeDetails.click();
        await list.evaluate(node => { node.scrollTop = 0; });
        const first = list.locator('[aria-posinset="1"]'); await expect(first).toBeVisible();
        ensure(await first.evaluate(node => node.getBoundingClientRect().height) === 76, 'DPI_ROW_HEIGHT_MISMATCH');
        await snapshot(`${name}-library`); await first.click();
        await app.page.getByRole('tab', { name: '标签备注', exact: true }).click();
        await app.page.getByLabel('备注', { exact: true }).fill('C04 DPI 未保存草稿');
        // At the minimum low viewport, detail replaces the toolbar/list. Return
        // through its actual control before changing a search query.
        await closeDetails.click();
        await app.page.locator('#library-search').fill('');
        const confirm = app.page.getByRole('dialog', { name: '放弃未保存的本地草稿？', exact: true });
        await expect(confirm).toBeVisible();
        const confirmAction = await reachable(confirm.getByRole('button', { name: '放弃草稿并继续', exact: true }));
        await snapshot(`${name}-confirmation`); await app.page.keyboard.press('Escape');
        await expect(app.page.getByLabel('备注', { exact: true })).toHaveValue('C04 DPI 未保存草稿');
        await app.page.locator('#library-search').fill('');
        await confirm.getByRole('button', { name: '放弃草稿并继续', exact: true }).click();
        await app.page.locator('#library-search').fill('C04 Reference');
        await expect(app.page.getByRole('status').filter({ hasText: '已加载 120 / 120' })).toBeVisible();
        result.displays.push({ theme, width, height, os, geometry, reset, apply, confirmAction });
      }
    }
  }
  ensure(seenDpi.has(120) && seenDpi.has(144) && result.displays.length === 8, 'ACTUAL_125_150_DPI_NOT_COMPLETE');
  pass('actual_125_and_150_percent_monitors_maximum_font', { cases: result.displays.length, dpi: [...seenDpi], osScalingChanged: false });
  await general(); await app.page.getByRole('button', { name: '深色', exact: true }).click();
  const effects = commands.slice(appearanceStart);
  ensure(!effects.some(command => /^(suggest_ai|test_ai|content_preview|open_web_preview|semantic_(start_index|query|model_check|resume|delete_index)|propose_organization|assign_organization|check_links|confirm_cleanup|tag_command|apply_|save_ai|save_semantic)/.test(command)), 'APPEARANCE_BUSINESS_EFFECT');
  ensure(remoteFontRequests.length === 0, 'REMOTE_FONT_REQUEST');
  pass('calibrated_no_business_or_remote_font_effect', { commands: [...new Set(effects)], remoteFontRequests: remoteFontRequests.length });
  stage = 'native-export-cancel';
  await app.page.getByRole('button', { name: '操作历史', exact: true }).click();
  await app.page.getByRole('button', { name: '备份导出', exact: true }).click();
  const exports = app.page.getByRole('region', { name: '备份导出', exact: true });
  await exports.getByRole('button', { name: '导出 HTML', exact: true }).click();
  result.exportDialog = await waitDialog(app); await dialog(app, 'cancel');
  await expect(exports.getByText('已取消保存，没有生成文件。', { exact: true })).toBeVisible();
  await snapshot('history-export-real-cancel');
  pass('native_history_export_portal_and_real_save_cancel');
  stage = 'preview'; probe = await startProbe();
  await app.invoke('open_web_preview', { profileId: 'pb10k', chromeId: '10', requestId: `c04-${randomUUID()}`, url: `${probe.base}/fonts` });
  const remote = await probe.hello('/fonts', 0); const denied = await probe.job(remote, 'invoke');
  ensure(denied.results.some(item => item.name === 'list_installed_fonts') && denied.results.every(item => ['NO_IPC', 'DENIED'].includes(item.outcome)), 'PREVIEW_ACCEPTED_IPC');
  result.previewCommandDenials = denied.results;
  await app.invoke('web_preview_action', { action: 'close' }); await probe.close(); probe = null;
  pass('remote_preview_denies_new_font_and_all_registered_commands', { count: denied.results.length });
  stage = 'restart'; const saved = await preferences(); result.firstClose = await app.close();
  ensure(result.firstClose.exitCode === 0, 'FIRST_PROCESS_EXIT_NOT_CONFIRMED'); app = await launchInstalled(plan);
  ensure(app.child.pid !== result.firstPid, 'RESTART_DID_NOT_CREATE_PROCESS');
  result.secondPid = app.child.pid; result.restartMainDataEvidence = app.mainDataEvidence;
  ensure(await preferences() === saved, 'RESTART_PREFERENCES_LOST');
  await expect(app.page.locator('html')).toHaveAttribute('data-theme', 'dark');
  ensure(await app.page.evaluate(() => getComputedStyle(document.documentElement).fontSize) === '20px', 'RESTART_SIZE_LOST');
  await general(); await snapshot('real-restart-dark-installed-20');
  result.restartedGlyphs = await glyphs('.appearance-sample p');
  ensure(result.restartedGlyphs.some(font => /YaHei/i.test(font.familyName)), 'RESTART_FONT_NOT_ACTUALLY_RENDERED');
  pass('real_process_exit_and_new_pid_restore_preferences', { firstPid: result.firstPid, secondPid: result.secondPid, preferences: JSON.parse(saved), glyphs: result.restartedGlyphs });
  const old = await app.page.evaluate(key => localStorage.getItem(key), oldKey);
  await app.page.getByRole('button', { name: '恢复默认外观', exact: true }).click();
  const reset = JSON.parse(await preferences()); ensure(reset.version === 2 && reset.theme === 'system' && reset.font.kind === 'preset' && reset.font.value === 'system' && reset.fontSizePx === 14, 'RESET_FAILED');
  ensure(await app.page.evaluate(key => localStorage.getItem(key), oldKey) === old, 'RESET_CHANGED_V1');
  pass('native_reset_only_v2');
  stage = 'legacy-fixtures'; result.legacyMigrations = [];
  for (const [font, fontSize, pixels] of [['system', 'small', 12], ['yahei', 'standard', 13], ['song', 'large', 15]]) {
    const raw = JSON.stringify({ version: 1, theme: 'light', font, fontSize });
    await app.page.evaluate(({ key, oldKey, raw }) => { localStorage.removeItem(key); localStorage.setItem(oldKey, raw); }, { key, oldKey, raw });
    await app.page.reload(); await general();
    const migrated = await app.page.evaluate(({ key, oldKey }) => ({ old: localStorage.getItem(oldKey), current: localStorage.getItem(key), font: document.documentElement.dataset.font, text: getComputedStyle(document.documentElement).fontSize }), { key, oldKey });
    ensure(migrated.old === raw && migrated.current === null && migrated.font === font && migrated.text === `${pixels}px`, 'LEGACY_READ_ONLY_MIGRATION_FAILED');
    result.legacyMigrations.push({ font, fontSize, pixels, preservedBytes: true, startupWrite: false });
  }
  pass('native_legacy_12_13_15_migration_preserves_v1_bytes', { cases: result.legacyMigrations });
  stage = 'missing-font-fixture';
  const absent = 'Markbridge Synthetic Missing C04 Font';
  ensure(!catalog.families.some(font => font.family === absent), 'MISSING_FONT_FIXTURE_COLLISION');
  const missing = JSON.stringify({ version: 2, theme: 'light', font: { kind: 'installed', family: absent }, fontSizePx: 14 });
  await app.page.evaluate(({ key, missing }) => localStorage.setItem(key, missing), { key, missing });
  await app.page.reload(); await general();
  await expect(app.page.getByText('所选字体当前不可用，已使用备用字体。', { exact: true })).toHaveCount(0);
  await app.page.getByRole('button', { name: '选择字体', exact: true }).click();
  await expect(app.page.getByRole('dialog', { name: '选择字体', exact: true }).getByRole('status').filter({ hasText: '找到' })).toBeVisible();
  await app.page.keyboard.press('Escape');
  await expect(app.page.getByText('所选字体当前不可用，已使用备用字体。', { exact: true })).toBeVisible();
  ensure(await preferences() === missing, 'MISSING_FONT_OVERWROTE_USER_CHOICE');
  result.missingFontFallback = await glyphs('.appearance-sample p');
  ensure(result.missingFontFallback.every(font => font.familyName !== absent && !font.isCustomFont), 'MISSING_FONT_FALLBACK_NOT_PROVEN');
  await snapshot('synthetic-missing-font-local-fallback');
  pass('synthetic_missing_font_truthful_status_and_actual_local_fallback', { syntheticFixture: true, glyphs: result.missingFontFallback });
  result.status = 'PASS';
} catch (error) {
  app ??= error.fixtureApp; result.status = 'FAIL'; result.stage = stage; result.error = error.message; process.exitCode = 1;
  if (app?.page) await app.page.screenshot({ path: join(output, 'failure.png') }).catch(() => {});
} finally {
  if (probe) await probe.close().catch(() => {});
  if (app) { try { result.appClose = await app.close(); } catch (error) { result.closeError = error.message; result.status = 'FAIL'; process.exitCode = 1; } }
  result.finalProcesses = await system('processes', root);
  if (result.finalProcesses.processes.length || result.finalProcesses.listeners.length) { result.status = 'FAIL'; process.exitCode = 1; }
  await writeFile(join(output, 'result.json'), `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify({ runId, status: result.status, stage: result.stage, output }));
}
