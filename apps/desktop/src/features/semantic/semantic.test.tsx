import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { BookmarkNode, SemanticModelCheck, SemanticQuery, SemanticQueryResult, SemanticScopeReview, SemanticSettings as Settings, SemanticStatus } from '@markbridge/protocol';
import * as backend from '../../backend';
import { SemanticSettings } from './SemanticSettings';
import { SemanticWorkspace } from './SemanticWorkspace';
import { SemanticQueryPanel } from './SemanticQueryPanel';

vi.mock('../../backend', () => ({ semanticSettings: vi.fn(), saveSemanticConfig: vi.fn(), checkSemanticModel: vi.fn(), semanticStatus: vi.fn(),
  reviewSemanticScope: vi.fn(), startSemanticIndex: vi.fn(), pauseSemanticIndex: vi.fn(), resumeSemanticIndex: vi.fn(), deleteSemanticIndex: vi.fn(),
  querySemantic: vi.fn(), cancelSemanticQuery: vi.fn() }));

const settings: Settings = { enabled: false, endpointLabel: 'http://localhost:11434', model: 'fixture-local', inputRecipeVersion: 1, maxInputChars: 8192, maxInputBytes: 32768 };
const nodes: BookmarkNode[] = [{ chromeId: '1', parentId: null, kind: 'folder', title: '阅读资料', position: 0, url: null },
  { chromeId: '10', parentId: '1', kind: 'bookmark', title: '键盘操作与可访问性', position: 0, url: 'https://example.com/a' }];
const scopeReview: SemanticScopeReview = { reviewId: 'review-1', profileId: 'profile-a', sourceEpoch: 1, expectedRevision: 8,
  count: 1, clippedCount: 1, upperBytes: 16384, model: 'fixture-local', inputRecipeVersion: 1, maxInputChars: 8192, maxInputBytes: 32768 };
const readyStatus: SemanticStatus = { settings: { ...settings, enabled: true }, index: { indexId: 'index-1', profileId: 'profile-a', sourceEpoch: 1,
  generation: 1, phase: 'ready', model: 'fixture-local', digest: 'a'.repeat(64), dimension: 2, total: 2, ready: 2, pending: 0, storedBytes: 16, failure: null, failureMessage: null } };
const props = { profileId: 'profile-a', profileName: '研究资料 A', sourceEpoch: 1, revision: 8, visit: 0, refreshVersion: 1, active: true,
  nodes, selected: [nodes[1]!], folderId: '1', onSelect: vi.fn(() => true), onLibrary: vi.fn(), onSettings: vi.fn() };

function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
function resultFor(query: SemanticQuery, title: string): SemanticQueryResult { return { requestId: query.requestId, profileId: query.profileId, sourceEpoch: query.sourceEpoch,
  indexId: query.indexId, generation: query.generation, hits: [{ bookmarkId: 'bm-10', chromeId: '10', title, score: 0.9 }], failure: null, failureMessage: null }; }

beforeEach(() => {
  vi.resetAllMocks(); vi.mocked(backend.semanticSettings).mockResolvedValue(settings);
  vi.mocked(backend.saveSemanticConfig).mockImplementation(async config => ({ ...settings, enabled: config.enabled, endpointLabel: config.endpoint, model: config.model }));
  vi.mocked(backend.semanticStatus).mockResolvedValue(readyStatus);
  vi.mocked(backend.reviewSemanticScope).mockResolvedValue(scopeReview);
  vi.mocked(backend.cancelSemanticQuery).mockResolvedValue();
});
afterEach(cleanup);

it('reads and saves disabled settings without any model check, build or query', async () => {
  render(<SemanticSettings native active />);
  await waitFor(() => expect(screen.getByRole('button', { name: '保存语义配置' })).toBeEnabled());
  fireEvent.change(screen.getByLabelText('向量模型'), { target: { value: 'my-local-model' } });
  fireEvent.click(screen.getByRole('button', { name: '保存语义配置' }));
  await screen.findByText('语义检索已关闭。普通搜索、标签和摘要保留。');
  expect(backend.saveSemanticConfig).toHaveBeenCalledExactlyOnceWith({ enabled: false, endpoint: 'http://localhost:11434', model: 'my-local-model' });
  expect(backend.checkSemanticModel).not.toHaveBeenCalled(); expect(backend.startSemanticIndex).not.toHaveBeenCalled(); expect(backend.querySemantic).not.toHaveBeenCalled();
});

it('checks a missing local model only explicitly and never displays raw failure detail', async () => {
  vi.mocked(backend.checkSemanticModel).mockResolvedValue({ available: false, model: null, digest: null, dimension: null, failure: 'MISSING_MODEL', failureMessage: 'fixture-private-model-body' });
  render(<SemanticSettings native active />);
  await waitFor(() => expect(screen.getByRole('button', { name: '检查本地模型' })).toBeEnabled());
  expect(backend.checkSemanticModel).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '检查本地模型' }));
  await screen.findByText('本地模型不可用。请选择本机已有、支持向量生成的模型。');
  expect(screen.queryByText('fixture-private-model-body')).not.toBeInTheDocument();
  expect(backend.checkSemanticModel).toHaveBeenCalledExactlyOnceWith('http://localhost:11434', 'fixture-local');
});

it('old settings-check finally cannot clear a newer visit busy state', async () => {
  const old = deferred<SemanticModelCheck>(), fresh = deferred<SemanticModelCheck>();
  vi.mocked(backend.checkSemanticModel).mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise);
  const view = render(<SemanticSettings native active />);
  await waitFor(() => expect(screen.getByRole('button', { name: '检查本地模型' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: '检查本地模型' }));
  view.rerender(<SemanticSettings native active={false} />); view.rerender(<SemanticSettings native active />);
  await waitFor(() => expect(screen.getByRole('button', { name: '检查本地模型' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: '检查本地模型' }));
  const reply: SemanticModelCheck = { available: true, model: 'fixture-local', digest: 'a'.repeat(64), dimension: 2, failure: null, failureMessage: null };
  await act(async () => old.resolve(reply));
  expect(screen.getByRole('button', { name: '检查本地模型' })).toBeDisabled();
  expect(screen.queryByText('本地模型可用。尚未发送书签内容。')).not.toBeInTheDocument();
  await act(async () => fresh.resolve(reply));
  expect(screen.getByRole('button', { name: '检查本地模型' })).toBeEnabled();
});

it('scope review discloses actual count, clipping and space before a separate start confirmation', async () => {
  vi.mocked(backend.reviewSemanticScope).mockResolvedValue({ ...scopeReview, count: 2, upperBytes: 32768 });
  vi.mocked(backend.semanticStatus).mockResolvedValue({ settings: { ...settings, enabled: true }, index: null });
  vi.mocked(backend.startSemanticIndex).mockResolvedValue({ ...readyStatus, index: { ...readyStatus.index!, phase: 'running', ready: 0, pending: 2 } });
  render(<SemanticWorkspace {...props} selected={[]} />);
  await waitFor(() => expect(screen.getByRole('radio', { name: '指定目录及后代' })).toBeEnabled());
  expect(screen.getByRole('button', { name: '审查本次范围' })).toBeDisabled();
  fireEvent.click(screen.getByRole('radio', { name: '指定目录及后代' }));
  fireEvent.click(screen.getByRole('button', { name: '审查本次范围' }));
  await screen.findByText('确认建立这份索引');
  expect(backend.reviewSemanticScope).toHaveBeenCalledExactlyOnceWith({ profileId: 'profile-a', sourceEpoch: 1, expectedRevision: 8, selectedChromeIds: [], folderId: '1' });
  expect(screen.getByText('2 个', { exact: true })).toBeVisible();
  expect(screen.getByText(/1 个输入会裁剪/)).toBeVisible();
  expect(screen.getByText(/32.0 KiB，另加 SQLite 开销与模型自身空间/)).toBeVisible();
  expect(backend.startSemanticIndex).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '确认并建立索引' }));
  await waitFor(() => expect(backend.startSemanticIndex).toHaveBeenCalledExactlyOnceWith('review-1'));
  await screen.findByRole('progressbar', { name: '索引建立进度' });
});

it('pause, resume and confirmed delete use the exact profile epoch and keep deletion separate', async () => {
  const running = { ...readyStatus, index: { ...readyStatus.index!, phase: 'running' as const, ready: 1, pending: 1, storedBytes: 8 } };
  vi.mocked(backend.semanticStatus).mockResolvedValue(running);
  vi.mocked(backend.pauseSemanticIndex).mockResolvedValue({ ...running, index: { ...running.index, phase: 'paused', generation: 2 } });
  vi.mocked(backend.resumeSemanticIndex).mockResolvedValue({ ...running, index: { ...running.index, generation: 3 } });
  vi.mocked(backend.deleteSemanticIndex).mockResolvedValue({ settings: readyStatus.settings, index: null });
  render(<SemanticWorkspace {...props} />);
  await waitFor(() => expect(screen.getByRole('button', { name: '暂停索引' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: '暂停索引' }));
  await screen.findByText('索引已暂停。已完成的条目保留。');
  fireEvent.click(screen.getByRole('button', { name: '继续索引' }));
  await waitFor(() => expect(backend.resumeSemanticIndex).toHaveBeenCalledExactlyOnceWith('profile-a', 1));
  await waitFor(() => expect(screen.getByRole('button', { name: '删除派生索引' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: '删除派生索引' }));
  expect(backend.deleteSemanticIndex).not.toHaveBeenCalled();
  expect(screen.getByText(/不会删除书签、标签、备注、摘要、预览或 AI 配置/)).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: '确认删除派生索引' }));
  await screen.findByText('派生索引已删除。书签、标签、备注、摘要和普通搜索保留。');
  expect(backend.pauseSemanticIndex).toHaveBeenCalledExactlyOnceWith('profile-a', 1);
  expect(backend.deleteSemanticIndex).toHaveBeenCalledExactlyOnceWith('profile-a', 1);
});

it('source A to B to A rejects the first visit scope review and its finally', async () => {
  const old = deferred<SemanticScopeReview>(), fresh = deferred<SemanticScopeReview>();
  vi.mocked(backend.reviewSemanticScope).mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise);
  vi.mocked(backend.semanticStatus).mockResolvedValue({ settings: readyStatus.settings, index: null });
  const view = render(<SemanticWorkspace {...props} />);
  await waitFor(() => expect(screen.getByRole('button', { name: '审查本次范围' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: '审查本次范围' }));
  view.rerender(<SemanticWorkspace {...props} profileId="profile-b" visit={1} />);
  view.rerender(<SemanticWorkspace {...props} visit={2} />);
  await waitFor(() => expect(screen.getByRole('button', { name: '审查本次范围' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: '审查本次范围' }));
  await act(async () => old.resolve(scopeReview));
  expect(screen.queryByText('确认建立这份索引')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: '审查本次范围' })).toBeDisabled();
  await act(async () => fresh.resolve(scopeReview));
  expect(screen.getByText('确认建立这份索引')).toBeVisible();
});

it('query requires explicit submit and replacement cancels underlying work without stale finally', async () => {
  const first = deferred<SemanticQueryResult>(), second = deferred<SemanticQueryResult>(), requests: SemanticQuery[] = [];
  vi.mocked(backend.querySemantic).mockImplementation(query => { requests.push(query); return requests.length === 1 ? first.promise : second.promise; });
  render(<SemanticQueryPanel {...props} index={readyStatus.index!} enabled />);
  fireEvent.change(screen.getByLabelText('描述想找的内容'), { target: { value: '键盘浏览' } });
  expect(backend.querySemantic).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '查询语义索引' }));
  fireEvent.change(screen.getByLabelText('描述想找的内容'), { target: { value: '更好的焦点顺序' } });
  expect(backend.cancelSemanticQuery).toHaveBeenCalledExactlyOnceWith('profile-a', requests[0]!.requestId);
  fireEvent.click(screen.getByRole('button', { name: '查询语义索引' }));
  await act(async () => first.resolve(resultFor(requests[0]!, '旧查询命中')));
  expect(screen.queryByText('旧查询命中')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: '查询语义索引' })).toBeDisabled();
  await act(async () => second.resolve(resultFor(requests[1]!, '当前命中')));
  fireEvent.click(screen.getByRole('button', { name: /当前命中/ }));
  expect(props.onSelect).toHaveBeenCalledWith('10');
});

it('pending review cannot approve old selected IDs or clear the new selection review busy state', async () => {
  const old = deferred<SemanticScopeReview>(), fresh = deferred<SemanticScopeReview>();
  vi.mocked(backend.reviewSemanticScope).mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise);
  vi.mocked(backend.semanticStatus).mockResolvedValue({ settings: readyStatus.settings, index: null });
  const view = render(<SemanticWorkspace {...props} />);
  await waitFor(() => expect(screen.getByRole('button', { name: '审查本次范围' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: '审查本次范围' }));
  const next = { ...nodes[1]!, chromeId: '11', title: '新选择' };
  view.rerender(<SemanticWorkspace {...props} selected={[next]} />);
  await waitFor(() => expect(screen.getByRole('button', { name: '审查本次范围' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: '审查本次范围' }));
  await act(async () => old.resolve(scopeReview));
  expect(screen.queryByRole('region', { name: '索引确认审查' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: '审查本次范围' })).toBeDisabled();
  await act(async () => fresh.resolve({ ...scopeReview, reviewId: 'review-new' }));
  expect(screen.getByRole('region', { name: '索引确认审查' })).toBeVisible();
  expect(vi.mocked(backend.reviewSemanticScope).mock.calls.at(-1)![0].selectedChromeIds).toEqual(['11']);
});

it('displayed selection review disappears when the current selection is replaced or emptied', async () => {
  vi.mocked(backend.semanticStatus).mockResolvedValue({ settings: readyStatus.settings, index: null });
  const view = render(<SemanticWorkspace {...props} />);
  await waitFor(() => expect(screen.getByRole('button', { name: '审查本次范围' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: '审查本次范围' }));
  await screen.findByRole('region', { name: '索引确认审查' });
  view.rerender(<SemanticWorkspace {...props} selected={[{ ...nodes[1]!, chromeId: '11' }]} />);
  expect(screen.queryByRole('button', { name: '确认并建立索引' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '审查本次范围' }));
  await screen.findByRole('region', { name: '索引确认审查' });
  view.rerender(<SemanticWorkspace {...props} selected={[]} />);
  expect(screen.queryByRole('button', { name: '确认并建立索引' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: '审查本次范围' })).toBeDisabled();
  expect(backend.startSemanticIndex).not.toHaveBeenCalled();
});

it('changing profile during review still accepts the new profile local status hydration', async () => {
  const old = deferred<SemanticScopeReview>();
  vi.mocked(backend.reviewSemanticScope).mockReturnValue(old.promise);
  vi.mocked(backend.semanticStatus).mockResolvedValue({ settings: readyStatus.settings, index: null });
  const view = render(<SemanticWorkspace {...props} />);
  await waitFor(() => expect(screen.getByRole('button', { name: '审查本次范围' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: '审查本次范围' }));
  view.rerender(<SemanticWorkspace {...props} profileId="profile-b" visit={1} />);
  await waitFor(() => expect(screen.getByRole('button', { name: '审查本次范围' })).toBeEnabled());
  await act(async () => old.resolve(scopeReview));
  expect(screen.queryByRole('region', { name: '索引确认审查' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: '审查本次范围' })).toBeEnabled();
});

it.each(['profile', 'epoch', 'visit', 'index', 'generation', 'revision', 'metadata'] as const)('late query is cancelled on %s replacement', async kind => {
  const held = deferred<SemanticQueryResult>(); let submitted!: SemanticQuery;
  vi.mocked(backend.querySemantic).mockImplementation(query => { submitted = query; return held.promise; });
  const base = { ...props, index: readyStatus.index!, enabled: true };
  const view = render(<SemanticQueryPanel {...base} />);
  fireEvent.change(screen.getByLabelText('描述想找的内容'), { target: { value: '访问体验' } });
  fireEvent.click(screen.getByRole('button', { name: '查询语义索引' }));
  const next = { ...base, ...(kind === 'profile' ? { profileId: 'profile-b' } : kind === 'epoch' ? { sourceEpoch: 2 } : kind === 'visit' ? { visit: 2 } : kind === 'revision' ? { revision: 9 } : kind === 'metadata' ? { refreshVersion: 2 } : { index: { ...base.index, ...(kind === 'index' ? { indexId: 'index-2' } : { generation: 2 }) } }) };
  view.rerender(<SemanticQueryPanel {...next} />);
  expect(backend.cancelSemanticQuery).toHaveBeenCalledExactlyOnceWith('profile-a', submitted.requestId);
  await act(async () => held.resolve(resultFor(submitted, '旧来源命中')));
  expect(screen.queryByText('旧来源命中')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: '查询语义索引' })).toBeEnabled();
});

it('unmount cancels query and a wrong identity reply cannot become a navigation result', async () => {
  let submitted!: SemanticQuery;
  vi.mocked(backend.querySemantic).mockImplementation(async query => { submitted = query; return { ...resultFor(query, '不可导航的命中'), sourceEpoch: 2 }; });
  const view = render(<SemanticQueryPanel {...props} index={readyStatus.index!} enabled />);
  fireEvent.change(screen.getByLabelText('描述想找的内容'), { target: { value: '资料' } });
  fireEvent.click(screen.getByRole('button', { name: '查询语义索引' }));
  await screen.findByText('查询状态已变化。请重新提交。');
  expect(screen.queryByText('不可导航的命中')).not.toBeInTheDocument();
  const held = deferred<SemanticQueryResult>(); vi.mocked(backend.querySemantic).mockReturnValue(held.promise);
  fireEvent.click(screen.getByRole('button', { name: '查询语义索引' }));
  const lastId = vi.mocked(backend.querySemantic).mock.calls.at(-1)![0].requestId;
  view.unmount();
  expect(backend.cancelSemanticQuery).toHaveBeenCalledWith('profile-a', lastId);
  await act(async () => held.resolve(resultFor({ ...submitted, requestId: lastId }, '卸载后的命中')));
});
