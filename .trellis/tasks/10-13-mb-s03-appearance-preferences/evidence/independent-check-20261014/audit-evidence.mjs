import { createHash } from 'node:crypto';
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

let repo = resolve(import.meta.dirname);
while (!existsSync(join(repo, 'pnpm-workspace.yaml'))) repo = resolve(repo, '..');
const evidence = resolve(import.meta.dirname, '..');
const json = async path => JSON.parse(await readFile(path, 'utf8'));
const hash = async path => createHash('sha256').update(await readFile(path)).digest('hex');
const ensure = (ok, code) => { if (!ok) throw new Error(code); };
const source = await json(join(evidence, 'source-resume-native.json'));
const changed = [];
const production = createHash('sha256');
for (const file of source.files) {
  const sha256 = await hash(join(repo, file.path));
  if (sha256 !== file.sha256) changed.push(file.path);
  if (!file.path.startsWith('tests/') && !/\.test\.(?:[cm]?js|tsx?)$/.test(file.path)) production.update(`${file.path}\0${sha256}\n`);
}
const productionFingerprint = production.digest('hex');
ensure(productionFingerprint === source.productionFingerprint, 'PRODUCTION_DRIFT');
const native = await json(join(evidence, 'native/run-1791965980131-17ad4cfd/result.json'));
ensure(native.status === 'PASS' && native.controls.length === 11 && native.controls.every(row => row.status === 'PASS'), 'NATIVE_INCOMPLETE');
ensure(native.productionSourceFingerprint === productionFingerprint, 'NATIVE_SOURCE_DRIFT');
const currentExe = join(repo, 'target/x86_64-pc-windows-msvc/release/markbridge-desktop.exe');
ensure(await hash(currentExe) === native.exeSha256, 'CURRENT_EXE_DRIFT');
ensure(await hash(native.executable) === native.exeSha256, 'ISOLATED_EXE_DRIFT');
ensure(native.ipcObserver.verified, 'IPC_UNCALIBRATED');
ensure(native.mainDataEvidence.owner !== native.restartMainDataEvidence.owner, 'NOT_A_PROCESS_RESTART');
ensure(native.firstClose.exitCode === 0 && native.appClose.exitCode === 0, 'NATIVE_CLOSE_FAILED');
ensure(native.finalProcesses.processes.length === 0 && native.finalProcesses.listeners.length === 0, 'NATIVE_CLEANUP_FAILED');
for (const row of native.screens) {
  ensure(row.os.ownedExecutableVerified && row.os.dpi / 96 === row.geometry.viewport.devicePixelRatio, 'SCREEN_DPI_NOT_NATIVE');
  ensure(Math.round(row.width * row.geometry.viewport.devicePixelRatio) === row.os.clientWidth && Math.round(row.height * row.geometry.viewport.devicePixelRatio) === row.os.clientHeight, 'NATIVE_CLIENT_MISMATCH');
  ensure(row.geometry.bodyWidth === row.width && row.geometry.bodyHeight === row.height && row.geometry.scrollTop === 0, 'NATIVE_LAYOUT_FAILED');
}
ensure(native.screens.length === 30, 'NATIVE_SCREEN_MATRIX_MISSING');
for (const row of native.displays) {
  ensure([120, 144].includes(row.os.dpi) && row.os.ownedExecutableVerified && row.geometry.dpr === row.os.dpi / 96, 'DISPLAY_DPI_NOT_NATIVE');
  ensure(row.geometry.documentWidth === row.width && row.geometry.documentHeight === row.height && row.geometry.text === '15px', 'DISPLAY_LAYOUT_FAILED');
  ensure(Math.round(row.width * row.geometry.dpr) === row.os.clientWidth && Math.round(row.height * row.geometry.dpr) === row.os.clientHeight, 'DISPLAY_CLIENT_MISMATCH');
}
ensure(native.displays.length === 12 && new Set(native.displays.map(row => row.os.dpi)).size === 2, 'ACTUAL_DPI_MATRIX_MISSING');
const browserDir = join(import.meta.dirname, 'browser-full/appearance');
const browser = { geometryFiles: 0, categoryObservations: 0, contrasts: [], typography: await json(join(browserDir, 'font-size-css.json')) };
for (const filename of await readdir(browserDir)) {
  if (!/^(?:light|dark)-(?:standard|large)-\d+x\d+\.json$/.test(filename)) continue;
  const geometry = await json(join(browserDir, filename));
  ensure(geometry.length === 5, 'BROWSER_CATEGORY_MISSING');
  for (const row of geometry) {
    ensure(row.width === row.documentWidth && row.height === row.documentHeight && row.tabs.right <= row.content.x && row.content.scrollTop === 0, 'BROWSER_LAYOUT_FAILED');
    ensure(row.controls.every(control => control.x >= row.content.x - 1 && control.right <= row.content.right + 1), 'BROWSER_CONTROL_OVERFLOW');
  }
  browser.geometryFiles += 1; browser.categoryObservations += geometry.length;
}
ensure(browser.geometryFiles === 24 && browser.typography.length === 9, 'BROWSER_MATRIX_MISSING');
for (const theme of ['light', 'dark']) {
  const row = await json(join(browserDir, `${theme}-contrast.json`));
  ensure([...row.contrast, ...row.renderedConsumers].every(pair => pair.ratio >= pair.minimum), 'CONTRAST_FAILED');
  browser.contrasts.push({ theme, semanticPairs: row.contrast.length, renderedPairs: row.renderedConsumers.length, minimumText: Math.min(...[...row.contrast, ...row.renderedConsumers].filter(pair => pair.minimum === 4.5).map(pair => pair.ratio)), minimumBoundary: Math.min(...[...row.contrast, ...row.renderedConsumers].filter(pair => pair.minimum === 3).map(pair => pair.ratio)) });
}
const result = { checkedAt: new Date().toISOString(), status: 'PASS', productionFingerprint, sourceSnapshot: 'source-resume-native.json', changedSinceNativeSnapshot: changed, browserTestSha256: await hash(join(repo, 'tests/e2e/appearance.spec.ts')), native: { runId: native.runId, exeSha256: native.exeSha256, exeBytes: native.exeBytes, controls: native.controls.length, screens: native.screens.length, actualDpiObservations: native.displays.length, originalPid: native.mainDataEvidence.owner, restartPid: native.restartMainDataEvidence.owner, systemStimulus: native.controls.find(row => row.systemStimulus)?.systemStimulus, clean: true }, browser };
await writeFile(join(import.meta.dirname, 'audit.json'), `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify({ status: result.status, productionFingerprint, changed, native: result.native, browser: { ...browser, typography: browser.typography.length } }));
