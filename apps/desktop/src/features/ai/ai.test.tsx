import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { AiApplyResult, AiSettings, AiSuggestion } from '@markbridge/protocol';
import { AiSettings as AiSettingsPanel } from './AiSettings';
import { AiSuggest } from './AiSuggest';
import { aiSettings, applyAi, applyEdit, cancelAi, clearAiCredential, saveAiConfig, setAiCredential, listOperations, suggestAi, testAiConnection } from '../../backend';

vi.mock('../../backend', () => ({
  aiSettings: vi.fn(),
  saveAiConfig: vi.fn(),
  setAiCredential: vi.fn(),
  clearAiCredential: vi.fn(),
  testAiConnection: vi.fn(),
  suggestAi: vi.fn(),
  cancelAi: vi.fn(),
  applyAi: vi.fn(),
  applyEdit: vi.fn(),
  listOperations: vi.fn(),
}));

const settings: AiSettings = {
  enabled: false,
  provider: null,
  endpointLabel: null,
  model: null,
  credentialConfigured: false,
  schemaSupported: null,
};

const enabledSettings: AiSettings = { ...settings, enabled: true, provider: 'ollama', endpointLabel: 'http://127.0.0.1:11434', model: 'qwen2.5:7b' };

function suggestion(): AiSuggestion {
  return {
    jobId: 'ai-job',
    profileId: 'profile-a',
    bookmarkId: 'bookmark-a',
    chromeId: '10',
    inputFingerprint: 'a'.repeat(64),
    endpointLabel: 'http://127.0.0.1:11434/api/chat',
    model: 'qwen2.5:7b',
    scope: { includesTitle: true, includesUrl: true, includesCachedText: false, excerptChars: 0 },
    state: 'ready',
    title: '短标题',
    tags: ['资料'],
    summary: null,
    suggestedFolder: '阅读',
    evidence: null,
    sourceTime: null,
    failure: null,
    failureMessage: null,
  };
}

beforeEach(() => { vi.mocked(cancelAi).mockResolvedValue(undefined); });

afterEach(() => { cleanup(); vi.resetAllMocks(); });

it('loads settings without a model call and clears the secret from the input', async () => {
  vi.mocked(aiSettings).mockResolvedValue(settings);
  vi.mocked(setAiCredential).mockResolvedValue({ ...settings, credentialConfigured: true });
  render(<AiSettingsPanel native />);
  expect(await screen.findByText('默认关闭')).toBeVisible();
  expect(testAiConnection).not.toHaveBeenCalled();
  expect(suggestAi).not.toHaveBeenCalled();
  const secret = screen.getByLabelText('模型密钥');
  fireEvent.change(secret, { target: { value: 'sk-test-secret' } });
  fireEvent.click(screen.getByRole('button', { name: '保存密钥' }));
  await waitFor(() => expect(setAiCredential).toHaveBeenCalledWith('sk-test-secret'));
  expect(secret).toHaveValue('');
  expect(screen.getByText(/已保存密钥/)).toBeVisible();
  expect(document.body.textContent).not.toContain('sk-test-secret');
});

it('saves the provider and model, tests the connection, and clears the credential', async () => {
  const configured: AiSettings = {
    enabled: true,
    provider: 'ollama',
    endpointLabel: 'http://127.0.0.1:11434/api/chat',
    model: 'qwen2.5:7b',
    credentialConfigured: false,
    schemaSupported: null,
  };
  vi.mocked(aiSettings).mockResolvedValue(settings);
  vi.mocked(saveAiConfig).mockResolvedValue(configured);
  vi.mocked(testAiConnection).mockResolvedValue({
    ok: true,
    schemaSupported: false,
    failure: null,
    failureMessage: null,
    settings: configured,
  });
  vi.mocked(clearAiCredential).mockResolvedValue({ ...configured, credentialConfigured: false });
  render(<AiSettingsPanel native />);
  expect(await screen.findByText('默认关闭')).toBeVisible();
  fireEvent.click(screen.getByRole('checkbox', { name: '启用 AI' }));
  fireEvent.change(screen.getByLabelText('提供者'), { target: { value: 'ollama' } });
  fireEvent.change(screen.getByLabelText('端点'), { target: { value: 'http://127.0.0.1:11434' } });
  fireEvent.change(screen.getByLabelText('模型'), { target: { value: 'qwen2.5:7b' } });
  fireEvent.click(screen.getByRole('button', { name: '保存配置' }));
  await waitFor(() => expect(saveAiConfig).toHaveBeenCalledWith(true, 'ollama', 'http://127.0.0.1:11434', 'qwen2.5:7b'));
  expect(await screen.findByText('已保存端点和模型。')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: '测试连接' }));
  await waitFor(() => expect(testAiConnection).toHaveBeenCalledOnce());
  expect(await screen.findByText('连接可用。')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: '清除凭据' }));
  await waitFor(() => expect(clearAiCredential).toHaveBeenCalledOnce());
  expect(await screen.findByText('已清除已保存的密钥。')).toBeVisible();
  expect(suggestAi).not.toHaveBeenCalled();
  expect(document.body.textContent).not.toContain('sk-test-secret');
});

it('sends the edited suggestion only after confirm', async () => {
  vi.mocked(suggestAi).mockResolvedValue(suggestion());
  vi.mocked(applyAi).mockResolvedValue({
    jobId: 'ai-job', browser: null, tagsApplied: false, summaryApplied: false, failure: null, failureMessage: null,
  });
  render(<AiSuggest settings={enabledSettings} profileId="profile-a" chromeId="10" url="https://example.com/a" revision={4} />);
  expect(suggestAi).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '生成建议' }));
  expect(await screen.findByLabelText('建议标题')).toHaveValue('短标题');
  expect(screen.getByText(/127\.0\.0\.1:11434\/api\/chat/)).toBeVisible();
  expect(screen.getByText(/不会移动书签/)).toBeVisible();
  fireEvent.change(screen.getByLabelText('建议标题'), { target: { value: '改过的标题' } });
  fireEvent.click(screen.getByLabelText('保存标题'));
  fireEvent.click(screen.getByRole('button', { name: '确认这条建议' }));
  await waitFor(() => expect(applyAi).toHaveBeenCalledWith(expect.objectContaining({
    jobId: 'ai-job', profileId: 'profile-a', chromeId: '10', title: '改过的标题', applyTitle: true, applyTags: false,
  })));
});

it('refreshes saved local metadata even when selection changes during confirmed apply', async () => {
  let finishApply!: (result: AiApplyResult) => void;
  const onChanged = vi.fn();
  vi.mocked(suggestAi).mockResolvedValue(suggestion());
  vi.mocked(applyAi).mockReturnValue(new Promise((resolve) => { finishApply = resolve; }));
  const view = render(<AiSuggest settings={enabledSettings} profileId="profile-a" chromeId="10" url="https://example.com/a" revision={4} onChanged={onChanged} />);
  fireEvent.click(screen.getByRole('button', { name: '生成建议' }));
  fireEvent.click(await screen.findByLabelText('保存标签'));
  fireEvent.click(screen.getByRole('button', { name: '确认这条建议' }));
  await waitFor(() => expect(applyAi).toHaveBeenCalledOnce());
  view.rerender(<AiSuggest settings={enabledSettings} profileId="profile-a" chromeId="11" url="https://example.com/b" revision={4} onChanged={onChanged} />);
  await act(async () => finishApply({ jobId: 'ai-job', browser: null, tagsApplied: true, summaryApplied: false, failure: null, failureMessage: null }));
  expect(onChanged).toHaveBeenCalledOnce();
  expect(screen.queryByText('本地标签或摘要已保存。')).not.toBeInTheDocument();
});

it('drops an unconfirmed suggestion when the bookmark changes', async () => {
  vi.mocked(suggestAi).mockResolvedValue(suggestion());
  const view = render(<AiSuggest settings={enabledSettings} profileId="profile-a" chromeId="10" url="https://example.com/a" revision={4} />);
  fireEvent.click(screen.getByRole('button', { name: '生成建议' }));
  expect(await screen.findByDisplayValue('短标题')).toBeVisible();
  view.rerender(<AiSuggest settings={enabledSettings} profileId="profile-a" chromeId="11" url="https://example.com/b" revision={4} />);
  expect(screen.queryByDisplayValue('短标题')).not.toBeInTheDocument();
  expect(applyAi).not.toHaveBeenCalled();
});

it('R05 keeps each selection usable through 20 pending A/B requests and stale completions', async () => {
  const pending: ((value: AiSuggestion) => void)[] = [];
  vi.mocked(suggestAi).mockImplementation(() => new Promise((resolve) => pending.push(resolve)));
  const view = render(<AiSuggest settings={enabledSettings} profileId="profile-a" chromeId="10" url="https://example.com/a" revision={4} />);
  for (let index = 0; index < 20; index += 1) {
    view.rerender(<AiSuggest settings={enabledSettings} profileId="profile-a" chromeId={index % 2 ? '11' : '10'} url={`https://example.com/${index % 2}`} revision={4} />);
    expect(screen.getByRole('button', { name: '生成建议' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: '生成建议' }));
  }
  await act(async () => { pending.slice(0, -1).forEach((finish) => finish({ ...suggestion(), title: '旧标题' })); });
  expect(screen.getByRole('button', { name: '生成建议' })).toBeDisabled();
  expect(screen.queryByDisplayValue('旧标题')).not.toBeInTheDocument();
  await act(async () => { pending.at(-1)?.({ ...suggestion(), chromeId: '11', title: '当前建议' }); });
  expect(screen.getByLabelText('建议标题')).toHaveValue('当前建议');
  expect(screen.getByRole('button', { name: '生成建议' })).toBeEnabled();
  expect(applyAi).not.toHaveBeenCalled();
  view.unmount();
  expect(cancelAi).toHaveBeenCalledTimes(20);
});

it('R05 ignores an old title undo receipt after a new bookmark has its own operation', async () => {
  let finishUndo!: (value: Awaited<ReturnType<typeof applyEdit>>) => void;
  vi.mocked(applyEdit).mockImplementation(() => new Promise((resolve) => { finishUndo = resolve; }));
  vi.mocked(suggestAi).mockResolvedValue(suggestion());
  const browser = { operationId: 'operation-a', state: 'applied' as const, errorCode: null, conflicts: [] };
  vi.mocked(applyAi).mockResolvedValue({ jobId: 'ai-job', browser, tagsApplied: false, summaryApplied: false, failure: null, failureMessage: null });
  const view = render(<AiSuggest settings={enabledSettings} profileId="profile-a" chromeId="10" url="https://example.com/a" revision={4} />);
  async function saveTitle() {
    fireEvent.click(screen.getByRole('button', { name: '生成建议' }));
    fireEvent.click(await screen.findByLabelText('保存标题'));
    fireEvent.click(screen.getByRole('button', { name: '确认这条建议' }));
    await screen.findByRole('button', { name: '撤销标题' });
  }
  await saveTitle();
  fireEvent.click(screen.getByRole('button', { name: '撤销标题' }));
  view.rerender(<AiSuggest settings={enabledSettings} profileId="profile-a" chromeId="11" url="https://example.com/b" revision={4} />);
  vi.mocked(applyAi).mockResolvedValue({ jobId: 'ai-job', browser: { ...browser, operationId: 'operation-b' }, tagsApplied: false, summaryApplied: false, failure: null, failureMessage: null });
  await saveTitle();
  await act(async () => finishUndo({ ...browser, state: 'rolled_back' }));
  expect(screen.getByRole('button', { name: '撤销标题' })).toBeEnabled();
  expect(screen.queryByText('已提交撤销。')).not.toBeInTheDocument();
});

it('R07 discloses endpoint and content before generation and leaves disabled AI idle', async () => {
  const view = render(<AiSuggest settings={settings} profileId="profile-a" chromeId="10" url="https://example.com/a" revision={4} />);
  expect(screen.getByRole('button', { name: '生成建议' })).toBeDisabled();
  expect(screen.getByText(/不会发送本地备注/)).toBeVisible();
  expect(suggestAi).not.toHaveBeenCalled();
  view.rerender(<AiSuggest settings={enabledSettings} profileId="profile-a" chromeId="10" url="https://example.com/a" revision={4} />);
  expect(screen.getByText('http://127.0.0.1:11434')).toBeVisible();
  expect(suggestAi).not.toHaveBeenCalled();
});

it('R07 cancellation rejects a late valid suggestion and never applies it', async () => {
  let finish!: (value: AiSuggestion) => void;
  vi.mocked(suggestAi).mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  render(<AiSuggest settings={enabledSettings} profileId="profile-a" chromeId="10" url="https://example.com/a" revision={4} />);
  fireEvent.click(screen.getByRole('button', { name: '生成建议' }));
  fireEvent.click(screen.getByRole('button', { name: '取消' }));
  expect(cancelAi).toHaveBeenCalledOnce();
  await act(async () => finish(suggestion()));
  expect(screen.queryByLabelText('建议标题')).not.toBeInTheDocument();
  expect(applyAi).not.toHaveBeenCalled();
});

it('R07 keeps confirmed apply and undo honest across own revisions and follows the returned receipt', async () => {
  let finishApply!: (value: AiApplyResult) => void;
  let finishUndo!: (value: Awaited<ReturnType<typeof applyEdit>>) => void;
  vi.mocked(suggestAi).mockResolvedValue(suggestion());
  vi.mocked(applyAi).mockImplementation(() => new Promise((resolve) => { finishApply = resolve; }));
  vi.mocked(applyEdit).mockImplementation(() => new Promise((resolve) => { finishUndo = resolve; }));
  vi.mocked(listOperations).mockResolvedValue({ operations: [{ operationId: 'title-op', state: 'applied', affected: 1, errorCode: null, conflicts: [], reviewed: false }] });
  const view = render(<AiSuggest settings={enabledSettings} profileId="profile-a" chromeId="10" url="https://example.com/a" revision={4} />);
  fireEvent.click(screen.getByRole('button', { name: '生成建议' }));
  fireEvent.click(await screen.findByLabelText('保存标题'));
  fireEvent.click(screen.getByRole('button', { name: '确认这条建议' }));
  expect(screen.getByRole('button', { name: '取消' })).toBeDisabled();
  expect(screen.getByText(/正在提交已确认的建议/)).toBeVisible();
  view.rerender(<AiSuggest settings={enabledSettings} profileId="profile-a" chromeId="10" url="https://example.com/a" revision={5} />);
  expect(screen.getByRole('button', { name: '取消' })).toBeDisabled();
  await act(async () => finishApply({ jobId: 'ai-job', browser: { operationId: 'title-op', state: 'applying', errorCode: null, conflicts: [] }, tagsApplied: false, summaryApplied: false, failure: null, failureMessage: null }));
  expect(await screen.findByText(/回执已确认。离开页面/)).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: '撤销标题' }));
  expect(screen.getByRole('button', { name: '取消' })).toBeDisabled();
  expect(screen.getByText(/正在提交已确认的撤销/)).toBeVisible();
  await act(async () => finishUndo({ operationId: 'undo-op', state: 'rolled_back', errorCode: null, conflicts: [] }));
  expect(screen.getByText(/撤销回执已确认/)).toBeVisible();
  expect(cancelAi).not.toHaveBeenCalled();
});

it('R07 keeps offline AI metadata local and prevents title writes', async () => {
  vi.mocked(suggestAi).mockResolvedValue(suggestion());
  vi.mocked(applyAi).mockResolvedValue({ jobId: 'ai-job', browser: null, tagsApplied: true, summaryApplied: false, failure: null, failureMessage: null });
  render(<AiSuggest settings={enabledSettings} profileId="profile-a" chromeId="10" url="https://example.com/a" revision={4} live={false} />);
  fireEvent.click(screen.getByRole('button', { name: '生成建议' }));
  expect(await screen.findByLabelText('保存标题')).toBeDisabled();
  fireEvent.click(screen.getByLabelText('保存标签'));
  fireEvent.click(screen.getByRole('button', { name: '确认这条建议' }));
  await waitFor(() => expect(applyAi).toHaveBeenCalledWith(expect.objectContaining({ applyTitle: false, applyTags: true })));
  expect(applyEdit).not.toHaveBeenCalled();
});
