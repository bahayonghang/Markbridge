// Current S01 executable and Chrome runtime only; no installation or pairing.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { tmpdir, version, release } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
let repo = resolve(import.meta.dirname);
while (!existsSync(join(repo, 'pnpm-workspace.yaml'))) {
  const parent = dirname(repo);
  assert.notEqual(parent, repo, 'WORKSPACE_ROOT_NOT_FOUND');
  repo = parent;
}
const { launchInstalled, launchChrome, system, until } = await import(pathToFileURL(join(repo,
  '.trellis/tasks/10-10-mb-13-windows-acceptance/evidence/current-native-driver.mjs')).href);
const root = await mkdtemp(join(tmpdir(), 'markbridge-task13-native-s01-'));
const runId = `run-${Date.now()}-${randomUUID().slice(0, 8)}`;
const output = join(import.meta.dirname, 'native', runId);
await mkdir(output, { recursive: true });
const source = join(repo, 'target/x86_64-pc-windows-msvc/release/markbridge-desktop.exe');
const installDirectory = join(root, 'install');
await mkdir(installDirectory);
const executable = join(installDirectory, 'markbridge-desktop.exe');
await copyFile(source, executable);
const exeData = await readFile(executable);
const result = {
  runId, os: version(), release: release(), node: process.version,
  isolationRoot: root, executable, appData: join(root, 'app-data'),
  copiedPortableExeOnly: true, installerRun: false, paired: false,
  exeBytes: exeData.length, exeSha256: createHash('sha256').update(exeData).digest('hex'),
};
const invokeHelper = promisify(execFile);
let app, chrome;
try {
  app = await launchInstalled({ root, installDirectory, executable, appData: result.appData, namespace: `Markbridge.Task06.s01-${randomUUID()}` });
  result.webview = app.webview;
  result.mainDataEvidence = app.mainDataEvidence;
  const brand = app.page.locator('.brand-mark');
  await brand.evaluate(image => image.decode());
  result.sidebar = await brand.evaluate(image => ({ tag: image.tagName, source: new URL(image.currentSrc).pathname, width: image.width, height: image.height, naturalWidth: image.naturalWidth, naturalHeight: image.naturalHeight }));
  assert.equal(result.sidebar.tag, 'IMG');
  assert.equal(result.sidebar.naturalWidth, 128);
  await brand.screenshot({ path: join(output, 'sidebar-brand.png') });
  result.viewport = await app.page.evaluate(() => ({ width: innerWidth, height: innerHeight, devicePixelRatio }));
  const native = await invokeHelper('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(import.meta.dirname, 'native-brand.ps1'),
    '-TargetProcessId', String(app.child.pid), '-IsolationRoot', root, '-EvidenceDirectory', output, '-MainTitle', 'Markbridge · 签桥'], { windowsHide: true, timeout: 30000 });
  result.windows = JSON.parse(native.stdout.trim());
  chrome = await launchChrome(root, 'chrome-a', 'C:/Program Files/Google/Chrome/Application/chrome.exe');
  result.chromeVersion = chrome.version;
  result.chromeProfile = chrome.directory;
  result.extension = await chrome.evaluate(`(async()=>{
    const manifest=chrome.runtime.getManifest();
    const icons=[];
    for(const [size,path] of Object.entries(manifest.icons)){
      const url=chrome.runtime.getURL(path),image=new Image(); image.src=url; await image.decode();
      const data=await (await fetch(url)).arrayBuffer();
      const digest=await crypto.subtle.digest('SHA-256',data);
      icons.push({size:Number(size),path,width:image.naturalWidth,height:image.naturalHeight,sha256:Array.from(new Uint8Array(digest),n=>n.toString(16).padStart(2,'0')).join('')});
    }
    return {id:chrome.runtime.id,icons,defaultIcon:manifest.action.default_icon,permissions:manifest.permissions,csp:manifest.content_security_policy};
  })()`);
  assert.deepEqual(result.extension.permissions, ['bookmarks', 'storage', 'alarms', 'scripting', 'activeTab']);
  for (const icon of result.extension.icons) {
    assert.equal(icon.width, icon.size); assert.equal(icon.height, icon.size);
    assert.equal(icon.sha256, createHash('sha256').update(await readFile(join(repo, 'apps/extension/public', icon.path))).digest('hex'));
  }
  const { targetId } = await chrome.call('Target.createTarget', { url: 'chrome://extensions/' });
  const { sessionId } = await chrome.call('Target.attachToTarget', { targetId, flatten: true });
  await chrome.call('Runtime.enable', {}, sessionId);
  await chrome.call('Page.enable', {}, sessionId);
  const expression = `(()=>{
    function all(root,selector){let values=[...root.querySelectorAll(selector)]; for(const item of root.querySelectorAll('*')) if(item.shadowRoot)values.push(...all(item.shadowRoot,selector));return values;}
    const item=all(document,'extensions-item').find(item=>item.id===${JSON.stringify(chrome.extensionId)});
    if(!item)return null;
    const image=item.shadowRoot.querySelector('img');
    if(!image?.complete||!image.naturalWidth)return null;
    return {name:item.shadowRoot.querySelector('#name')?.textContent.trim(),imageWidth:image.naturalWidth,imageHeight:image.naturalHeight,source:image.currentSrc};
  })()`;
  result.extensionCard = await until(async () => {
    const reply = await chrome.call('Runtime.evaluate', { expression, returnByValue: true }, sessionId);
    assert.equal(reply.exceptionDetails, undefined);
    return reply.result.value;
  }, 'EXTENSION_CARD_ICON_NOT_RENDERED');
  if (result.extensionCard.source.startsWith('data:image/png;base64,')) {
    result.extensionCard.imageDataSha256 = createHash('sha256').update(Buffer.from(result.extensionCard.source.split(',')[1], 'base64')).digest('hex');
    result.extensionCard.sourceKind = 'data:image/png';
    delete result.extensionCard.source;
  }
  const screenshot = await chrome.call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }, sessionId);
  await writeFile(join(output, 'chrome-extensions.png'), Buffer.from(screenshot.data, 'base64'));
  assert.ok(result.windows.taskbar, 'OWNED_TASKBAR_BUTTON_NOT_OBSERVED');
  result.status = 'PASS_PENDING_VISUAL_REVIEW';
} catch (error) {
  app ??= error.fixtureApp; chrome ??= error.fixtureChrome;
  result.status = 'FAIL';
  result.error = error.message;
  process.exitCode = 1;
} finally {
  try { if (chrome) result.chromeClose = await chrome.close(); }
  catch (error) { result.chromeClose = chrome.lastCloseEvidence; result.status = 'FAIL'; result.closeError = error.message; process.exitCode = 1; }
  try { if (app) result.appClose = await app.close(); }
  catch (error) { result.appClose = app.lastCloseEvidence; result.status = 'FAIL'; result.closeError = error.message; process.exitCode = 1; }
  result.finalProcesses = await system('processes', root);
  if (result.finalProcesses.processes.length) { result.status = 'FAIL'; process.exitCode = 1; }
  await writeFile(join(output, 'result.json'), `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify({ runId, status: result.status, exeSha256: result.exeSha256, output }));
}
