import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { AiSettings, AiSuggestion } from '@markbridge/protocol';
import { AiSettings as AiSettingsPanel } from './AiSettings';
import { AiSuggest } from './AiSuggest';
import { aiSettings, applyAi, clearAiCredential, saveAiConfig, setAiCredential, suggestAi, testAiConnection } from '../../backend';

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
}));

const settings: AiSettings = {
  enabled: false,
  provider: null,
  endpointLabel: null,
  model: null,
  credentialConfigured: false,
  schemaSupported: null,
};

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
  render(<AiSuggest profileId="profile-a" chromeId="10" url="https://example.com/a" revision={4} />);
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

it('drops an unconfirmed suggestion when the bookmark changes', async () => {
  vi.mocked(suggestAi).mockResolvedValue(suggestion());
  const view = render(<AiSuggest profileId="profile-a" chromeId="10" url="https://example.com/a" revision={4} />);
  fireEvent.click(screen.getByRole('button', { name: '生成建议' }));
  expect(await screen.findByDisplayValue('短标题')).toBeVisible();
  view.rerender(<AiSuggest profileId="profile-a" chromeId="11" url="https://example.com/b" revision={4} />);
  expect(screen.queryByDisplayValue('短标题')).not.toBeInTheDocument();
  expect(applyAi).not.toHaveBeenCalled();
});
