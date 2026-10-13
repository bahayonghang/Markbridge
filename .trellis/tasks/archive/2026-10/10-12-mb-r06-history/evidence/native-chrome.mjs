// R06 task-local pipe driver, adapted from the verified R02 driver.
import {spawn} from "node:child_process";
import {join,resolve,basename} from "node:path";
import {tmpdir} from "node:os";
import {repo,until,ensure} from "./native-driver.mjs";

export async function launchChrome(directory, executable = "C:/Program Files/Google/Chrome/Application/chrome.exe") {
  ensure(basename(resolve(directory, "..")).startsWith("markbridge-r06-native-") && resolve(directory, "../../../..") === resolve(tmpdir()), "NON_ISOLATED_CHROME_ROOT");
  const child = spawn(executable, [
    '--headless=new', '--remote-debugging-pipe', '--enable-unsafe-extension-debugging',
    `--user-data-dir=${directory}`, '--no-first-run', '--no-default-browser-check',
    '--disable-background-networking', '--disable-component-update', '--disable-sync', 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'], windowsHide: true });
  let sequence = 0;
  let buffer = '';
  const pending = new Map();
  child.stdio[4].setEncoding('utf8');
  child.stdio[4].on('data', (chunk) => {
    buffer += chunk;
    let boundary;
    while ((boundary = buffer.indexOf('\0')) !== -1) {
      const message = JSON.parse(buffer.slice(0, boundary));
      buffer = buffer.slice(boundary + 1);
      const request = pending.get(message.id);
      if (!request) continue;
      pending.delete(message.id);
      clearTimeout(request.timeout);
      if (message.error) request.reject(new Error(`CDP_${request.method}_FAILED`));
      else request.resolve(message.result);
    }
  });
  child.on('exit', () => { for (const request of pending.values()) { clearTimeout(request.timeout); request.reject(new Error('TEST_CHROME_EXIT')); } pending.clear(); });
  const client = { child, directory, call(method, params = {}, sessionId) {
    const id = ++sequence;
    return new Promise((resolveReply, reject) => {
      const timeout = setTimeout(() => { pending.delete(id); reject(new Error(`CDP_${method}_TIMEOUT`)); }, 30000);
      pending.set(id, { resolve: resolveReply, reject, timeout, method });
      child.stdio[3].write(`${JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })}\0`);
    });
  }, async close() {
    if (child.exitCode !== null) return;
    try { await client.call('Browser.close'); await until(() => child.exitCode !== null, 'CHROME_CLOSE_TIMEOUT', 10000); }
    catch { child.kill(); }
  } };
  try {
    client.version = (await client.call('Browser.getVersion')).product;
    client.extensionId = (await client.call('Extensions.loadUnpacked', { path: join(repo, 'apps/extension/dist') })).id;
    const { targetId } = await client.call('Target.createTarget', { url: `chrome-extension://${client.extensionId}/options.html` });
    const { sessionId } = await client.call('Target.attachToTarget', { targetId, flatten: true });
    await client.call('Runtime.enable', {}, sessionId);
    client.evaluate = async (expression) => {
      const result = await client.call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId);
      if (result.exceptionDetails) throw new Error('EXTENSION_EVALUATION_FAILED');
      return result.result.value;
    };
    await until(() => client.evaluate('!!document.querySelector("#pairing-code")'), 'OPTIONS_TIMEOUT');
    return client;
  } catch (error) { await client.close(); throw error; }
}
