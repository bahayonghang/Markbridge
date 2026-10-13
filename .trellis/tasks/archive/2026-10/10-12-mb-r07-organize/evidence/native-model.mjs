// Synthetic task-local HTTP responses exercise real Rust transport; this is not a model-quality test.
import { createServer } from 'node:http';
import { ensure } from './native-driver.mjs';

export async function startModelFixture() {
  const calls = [];
  const held = new Set();
  let holdKind = null;
  let pageRequests = 0;
  const errors = [];
  const server = createServer(async (request, response) => {
    try {
    if (request.method !== 'POST' || request.url !== '/api/chat') {
      pageRequests += 1;
      response.writeHead(403).end();
      return;
    }
    let raw = '';
    for await (const part of request) raw += part;
    const body = JSON.parse(raw);
    const system = body.messages?.find(item => item.role === 'system')?.content ?? '';
    const user = body.messages?.find(item => item.role === 'user')?.content ?? '';
    const kind = system.includes('key assignments') ? 'assignments' : system.includes('key folders') ? 'folders' : 'suggestion';
    const entry = { kind, path: request.url, model: body.model, auth: Boolean(request.headers.authorization), completed: false, disconnected: false };
    calls.push(entry);
    response.on('close', () => { entry.disconnected = !entry.completed; held.delete(send); });
    let value;
    if (kind === 'folders') value = { folders: [{ name: 'R07 阅读', parent: null }, { name: 'R07 工具', parent: null }] };
    else if (kind === 'assignments') {
      const [folderPart, itemPart] = user.split('Items:');
      const folderIds = [...folderPart.matchAll(/^id: (\S+) name:/gm)].map(match => match[1]);
      const itemIds = [...(itemPart ?? '').matchAll(/^id: (\S+)$/gm)].map(match => match[1]);
      ensure(folderIds.length > 0 && itemIds.length > 0, 'INVALID_SYNTHETIC_ASSIGNMENT_PROMPT');
      value = { assignments: itemIds.map((id, index) => ({ chromeId: id, folderId: folderIds[index % folderIds.length], citedInputId: id, citedFolderId: folderIds[index % folderIds.length] })) };
    } else value = { title: 'R07 已审查建议', tags: ['资料'], summary: 'R07 合成响应，仅验证交互与传输。', suggestedFolder: '阅读', evidence: null };
    function send() {
      held.delete(send);
      if (response.destroyed) return;
      entry.completed = true;
      response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ message: { role: 'assistant', content: JSON.stringify(value) }, done: true }));
    }
    if (holdKind === kind) { holdKind = null; held.add(send); }
    else send();
    } catch {
      errors.push('SYNTHETIC_HTTP_HANDLER_FAILED');
      response.writeHead(500).end();
    }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  return {
    endpoint: `http://127.0.0.1:${server.address().port}`, calls, errors,
    get pageRequests() { return pageRequests; },
    hold(kind) { holdKind = kind; },
    release() { for (const send of [...held]) send(); },
    async close() { for (const send of [...held]) send(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); },
  };
}
