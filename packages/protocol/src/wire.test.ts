// @vitest-environment node
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { encodeWireFrame, MAX_FRAME_BYTES, parseWireFrame, parseWireMessage, type BookmarkNode, type WireMessage } from './wire';
const root = fileURLToPath(new URL('../../../', import.meta.url));
const rustFile = new URL('../../../tests/fixtures/protocol/rust-to-ts.json', import.meta.url);
const tsFile = new URL('../../../tests/fixtures/protocol/ts-to-rust.json', import.meta.url);
function rustValue(): WireMessage { return parseWireFrame(readFileSync(rustFile, 'utf8')); }
function treeValue() {
  const value = rustValue();
  if (value.type !== 'tree_full') throw new Error('fixture type');
  return value;
}
function rejects(change: (value: ReturnType<typeof treeValue>) => void) {
  const value = treeValue(); change(value); expect(() => parseWireMessage(value)).toThrow();
}
describe('versioned wire contract', () => {
  it('consumes freshly serialized Rust DTO and emits a typed TS DTO back to Rust', () => {
    const emitted = spawnSync('cargo', ['run', '--quiet', '--locked', '-p', 'markbridge-protocol', '--bin', 'wire-fixtures', '--', '--emit'], { cwd: root, encoding: 'utf8' });
    expect(emitted.status, emitted.stderr).toBe(0);
    const parsed = parseWireFrame(emitted.stdout);
    expect(parsed).toEqual(rustValue());
    const typescript: WireMessage = {
      protocolVersion: 1, type: 'apply_operation', profileId: 'profile-ts', sessionId: 'session-ts', requestId: 'request-apply', seq: null,
      payload: { operationId: 'operation-ts', sourceEpoch: 1, expectedRevision: 42, steps: [
        { requestId: 'step-create', target: null, expectedBefore: null, expectedChildIds: null, payload: { kind: 'create', parentId: '0', position: 0, title: 'TS 合成 🦢', url: 'https://example.invalid/ts' } },
      ] },
    };
    expect(JSON.parse(encodeWireFrame(typescript))).toEqual(JSON.parse(readFileSync(tsFile, 'utf8')));
    const directory = mkdtempSync(join(tmpdir(), 'markbridge-ts-fixture-'));
    try {
      const path = join(directory, 'ts-to-rust.json');
      writeFileSync(path, encodeWireFrame(typescript));
      const consumed = spawnSync('cargo', ['run', '--quiet', '--locked', '-p', 'markbridge-protocol', '--bin', 'wire-fixtures', '--', '--check', path], { cwd: root, encoding: 'utf8' });
      expect(consumed.status, consumed.stderr).toBe(0);
      expect(parseWireFrame(consumed.stdout)).toEqual(typescript);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  }, 15000);
  it('rejects versions, unknown writes, extra fields and missing nullable header fields', () => {
    const value = treeValue();
    expect(() => parseWireMessage({ ...value, protocolVersion: 2 })).toThrow();
    expect(() => parseWireMessage({ ...value, credential: 'forbidden' })).toThrow();
    const { seq: _seq, ...withoutSeq } = value;
    expect(_seq).toBeNull(); expect(() => parseWireMessage(withoutSeq)).toThrow();
    rejects(value => { value.requestId = null; });
    const ts: unknown = JSON.parse(readFileSync(tsFile, 'utf8'));
    expect(() => parseWireMessage({ ...ts as object, payload: { operationId: 'o', sourceEpoch: 1, expectedRevision: 1, steps: [{ requestId: 'r', target: null, expectedBefore: null, expectedChildIds: null, payload: { kind: 'export_html' } }] } })).toThrow();
  });
  it('uses Unicode scalar lengths and safe integer ranges', () => {
    const value = treeValue(); value.payload.nodes[1].title = '🦢'.repeat(4096);
    expect(parseWireMessage(value)).toEqual(value);
    rejects(value => { value.payload.nodes[1].title = '🦢'.repeat(4097); });
    rejects(value => { value.payload.nodes[1].title = '\ud800'; });
    rejects(value => { value.payload.revision = Number.MAX_SAFE_INTEGER + 1; });
    rejects(value => { value.payload.sourceEpoch = 0; });
    const boundary = treeValue(); boundary.profileId = 'a'.repeat(128); boundary.payload.nodes[1].url = 'x'.repeat(16384);
    expect(parseWireMessage(boundary)).toEqual(boundary);
    rejects(value => { value.profileId = 'a'.repeat(129); });
    rejects(value => { value.payload.nodes[1].url = 'x'.repeat(16385); });
  });
  it('rejects malformed trees and accepts dynamic root properties', () => {
    rejects(value => { value.payload.nodes[1].parentId = 'absent'; });
    rejects(value => { value.payload.nodes.push(value.payload.nodes[1]); });
    rejects(value => { value.payload.nodes[0].parentId = '42'; });
    rejects(value => { value.payload.nodes[1].kind = 'folder'; });
    const tree = treeValue(); tree.payload.nodes = [
      { chromeId: 'a', parentId: null, position: 0, kind: 'folder', title: 'root', folderType: 'bookmarks-bar' },
      { chromeId: 'b', parentId: null, position: 1, kind: 'folder', title: 'another root', folderType: 'bookmarks-bar', unmodifiable: 'managed' },
      { chromeId: 'managed', parentId: 'a', position: 0, kind: 'folder', title: 'managed folder', folderType: 'managed', unmodifiable: 'managed' },
      { chromeId: 'managed-child', parentId: 'managed', position: 0, kind: 'bookmark', title: 'managed child', url: 'https://example.invalid/managed' },
    ];
    expect(parseWireMessage(tree)).toEqual(tree);
  });
  it('enforces 256-level depth and array bounds at runtime', () => {
    const value = treeValue();
    value.payload.nodes = Array.from({ length: 256 }, (_, index): BookmarkNode => ({ chromeId: `n${index}`, parentId: index ? `n${index - 1}` : null, position: 0, kind: 'folder', title: '' }));
    expect(parseWireMessage(value)).toEqual(value);
    value.payload.nodes.push({ chromeId: 'too-deep', parentId: 'n255', position: 0, kind: 'folder', title: '' });
    expect(() => parseWireMessage(value)).toThrow('LIMIT_EXCEEDED');
    const many = treeValue(); many.payload.nodes = Array.from({ length: 100001 }, (_, index): BookmarkNode => ({ chromeId: `n${index}`, parentId: null, position: index, kind: 'folder', title: '' }));
    expect(() => parseWireMessage(many)).toThrow();
  });
  it('counts frame bytes before parsing and accepts the exact frame boundary', () => {
    const text = encodeWireFrame(treeValue());
    const bytes = new TextEncoder().encode(text).length;
    const boundary = text + ' '.repeat(MAX_FRAME_BYTES - bytes);
    expect(parseWireFrame(boundary)).toEqual(treeValue());
    expect(() => parseWireFrame(boundary + ' ')).toThrow('FRAME_TOO_LARGE');
    expect(() => parseWireFrame('🦢'.repeat(MAX_FRAME_BYTES / 4 + 1))).toThrow('FRAME_TOO_LARGE');
  });
  it('agrees with Rust on shared accepted and rejected boundary frames', () => {
    const values: unknown[] = [treeValue(), JSON.parse(readFileSync(tsFile, 'utf8'))];
    for (const title of ['', '🦢'.repeat(4096), '🦢'.repeat(4097), '\ud800']) {
      const value = treeValue(); value.payload.nodes[1].title = title; values.push(value);
    }
    for (const profileId of ['a\n', 'a ', 'é', 'a:valid-1._']) { values.push({ ...treeValue(), profileId }); }
    for (const revision of [0, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER + 1, -1, 0.5]) {
      const value = treeValue(); value.payload.revision = revision; values.push(value);
    }
    for (const size of [0, 31, 32, 1024, 1025]) {
      values.push({ protocolVersion: 1, type: 'hello', profileId: 'p', sessionId: 's', requestId: 'r', seq: null, payload: { instanceId: 'i', credential: '🦢'.repeat(size) } });
    }
    for (const type of ['pair', 'pair_result', 'hello_result', 'ping', 'pong', 'get_tree', 'resync_required', 'get_operation_status', 'operation_receipt']) {
      const payloads: Record<string, unknown> = {
        pair: { instanceId: 'i', credential: 'x'.repeat(32), displayName: 'Synthetic' },
        pair_result: { accepted: false, credential: null, errorCode: 'UNPAIRED' },
        hello_result: { accepted: true, sourceEpoch: 1, errorCode: null },
        ping: {}, pong: {}, get_tree: {}, resync_required: { reason: 'CONFLICT' },
        get_operation_status: { operationId: 'o' },
        operation_receipt: { operationId: 'o', requestId: 'r', state: 'uncertain', before: null, after: null, errorCode: 'UNCERTAIN_WRITE' },
      };
      values.push({ protocolVersion: 1, type, profileId: 'p', sessionId: 's', requestId: type === 'resync_required' ? null : 'r', seq: null, payload: payloads[type] });
    }
    const reorder = {
      protocolVersion: 1, type: 'apply_operation', profileId: 'p', sessionId: 's', requestId: 'r', seq: null,
      payload: { operationId: 'o', sourceEpoch: 1, expectedRevision: 1, steps: [
        { requestId: 'step', target: '0', expectedBefore: treeValue().payload.nodes[0], expectedChildIds: ['a', 'b'], payload: { kind: 'reorder', childIds: ['b', 'a'] } },
      ] },
    };
    expect(parseWireMessage(reorder)).toEqual(reorder); values.push(reorder);
    for (const expected of [null, ['a', 'a'], ['a', 'c']]) {
      values.push({ ...reorder, payload: { ...reorder.payload, steps: [{ ...reorder.payload.steps[0], expectedChildIds: expected }] } });
    }
    values.push({ protocolVersion: 1, type: 'operation_receipt', profileId: 'p', sessionId: 's', requestId: 'r', seq: null, payload: { operationId: 'o', requestId: 'r', state: 'applied', before: null, after: null, beforeChildIds: ['a', 'a'], afterChildIds: ['a', 'b'], errorCode: null } });
    for (const payload of [{ kind: 'update', title: 'updated', url: null }, { kind: 'move', parentId: '0', position: 1 }, { kind: 'delete' }]) {
      const value = JSON.parse(readFileSync(tsFile, 'utf8'));
      value.payload.steps[0] = { requestId: 'step', target: '42', expectedBefore: treeValue().payload.nodes[1], expectedChildIds: null, payload };
      expect(parseWireMessage(value)).toEqual(value); values.push(value);
      values.push({ ...value, payload: { ...value.payload, steps: [{ ...value.payload.steps[0], payload: { ...payload, unexpected: true } }] } });
    }
    for (const kind of ['import_began', 'import_ended']) {
      values.push({ protocolVersion: 1, type: 'event', profileId: 'p', sessionId: 's', requestId: null, seq: 1, payload: { sourceEpoch: 1, event: { kind, unexpected: true } } });
    }
    const withoutSeq: Record<string, unknown> = { ...treeValue() }; delete withoutSeq.seq; values.push(withoutSeq);
    const badWrite = JSON.parse(readFileSync(tsFile, 'utf8')); badWrite.payload.steps[0].payload.kind = 'unknown_write'; values.push(badWrite);
    const tooManySteps = JSON.parse(readFileSync(tsFile, 'utf8'));
    tooManySteps.payload.steps = Array.from({ length: 1001 }, (_, i) => ({ ...tooManySteps.payload.steps[0], requestId: `step-${i}` })); values.push(tooManySteps);
    const cases = values.map(value => {
      const frame = JSON.stringify(value);
      let accepted = true;
      try { parseWireFrame(frame); } catch { accepted = false; }
      return { frame, accepted };
    });
    for (const integer of ['1.0', '1e0']) {
      const frame = encodeWireFrame(treeValue()).replace('"protocolVersion":1', `"protocolVersion":${integer}`);
      expect(() => parseWireFrame(frame)).not.toThrow();
      cases.push({ frame, accepted: true });
    }
    const directory = mkdtempSync(join(tmpdir(), 'markbridge-wire-'));
    try {
      const path = join(directory, 'corpus.json'); writeFileSync(path, JSON.stringify(cases));
      const result = spawnSync('cargo', ['run', '--quiet', '--locked', '-p', 'markbridge-protocol', '--bin', 'wire-fixtures', '--', '--check-corpus', path], { cwd: root, encoding: 'utf8' });
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toContain(`Validated ${cases.length} cross-language acceptance cases.`);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  }, 15000);
  it('preserves event-specific data and rejects unknown event fields', () => {
    const node = treeValue().payload.nodes[1];
    const events = [
      { kind: 'created', node }, { kind: 'changed', chromeId: '42', title: 'new', url: null },
      { kind: 'moved', chromeId: '42', oldParentId: '0', oldPosition: 0, parentId: '1', position: 1 },
      { kind: 'removed', chromeId: '42', parentId: '0', position: 0, subtree: [node] },
      { kind: 'reordered', parentId: '0', childIds: ['42', '43'] }, { kind: 'import_began' }, { kind: 'import_ended' },
    ];
    for (const event of events) {
      const message = { protocolVersion: 1, type: 'event', profileId: 'p', sessionId: 's', requestId: null, seq: 1, payload: { sourceEpoch: 1, event } };
      expect(parseWireMessage(message)).toEqual(message);
      expect(() => parseWireMessage({ ...message, payload: { sourceEpoch: 1, event: { ...event, unexpected: true } } })).toThrow();
      const { requestId: _request, ...withoutRequest } = message;
      expect(_request).toBeNull(); expect(() => parseWireMessage(withoutRequest)).toThrow();
    }
  });
});
