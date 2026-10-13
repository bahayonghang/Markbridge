import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { OrganizationPlan } from '@markbridge/protocol';
import { OrganizationDesk } from './OrganizationDesk';
import { applyOrganization, cancelAi, cancelOrganization, proposeOrganization } from '../../backend';

vi.mock('../../backend', () => ({
  proposeOrganization: vi.fn(),
  cancelAi: vi.fn(),
  reviewOrganization: vi.fn(),
  assignOrganization: vi.fn(),
  editOrganization: vi.fn(),
  applyOrganization: vi.fn(),
  pauseOrganization: vi.fn(),
  cancelOrganization: vi.fn(),
  cleanupOrganization: vi.fn(),
  organizationPlan: vi.fn(),
}));

afterEach(() => { cleanup(); vi.resetAllMocks(); });

function plan(): OrganizationPlan {
  return {
    jobId: 'job-1',
    profileId: 'profile-a',
    sourceEpoch: 1,
    sourceRevision: 4,
    inputFingerprint: 'fingerprint-a',
    planHash: 'hash-a',
    phase: 'ready',
    sampled: 1,
    scopeCount: 1,
    anchorId: 'bar',
    folders: [{ folderId: 'fld1', name: '阅读', parentFolderId: null, reviewed: true }],
    scope: [{ chromeId: '10', bookmarkId: 'bm-10', sourceParentId: 'bar', sourceLabel: 'Alpha' }],
    assignments: [{
      chromeId: '10', bookmarkId: 'bm-10', sourceParentId: 'bar', sourceLabel: 'Alpha',
      targetFolderId: 'fld1', citedInputId: '10', citedFolderId: 'fld1', rejected: false,
    }],
    impact: 2,
    failure: null,
    failureMessage: null,
    operationId: null,
    backupVerified: false,
    applied: [],
    pending: [],
    uncertain: [],
    failed: [],
  };
}

it('shows source, target, impact, reject, and edit only after a click', async () => {
  vi.mocked(proposeOrganization).mockResolvedValue(plan());
  render(<OrganizationDesk settings={{ enabled: true, provider: 'ollama', endpointLabel: 'http://127.0.0.1:11434', model: 'fixture', credentialConfigured: false, schemaSupported: true }} profileId="profile-a" revision={4} live chromeIds={['10']} />);
  expect(proposeOrganization).not.toHaveBeenCalled();
  expect(applyOrganization).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '提出文件夹' }));
  expect(await screen.findByText('Alpha')).toBeVisible();
  expect(screen.getByRole('option', { name: '阅读' })).toBeVisible();
  expect(screen.getByText(/影响 2 步/)).toBeVisible();
  expect(screen.getByRole('checkbox', { name: '拒绝 Alpha' })).toBeVisible();
  expect(screen.getByLabelText('目标 Alpha')).toBeVisible();
  expect(applyOrganization).not.toHaveBeenCalled();
});

const modelSettings = { enabled: true, provider: 'ollama' as const, endpointLabel: 'http://127.0.0.1:11434', model: 'fixture', credentialConfigured: false, schemaSupported: true };

it('R07 cancels the initial model request before a job response and ignores late output', async () => {
  let finish!: (value: OrganizationPlan) => void;
  vi.mocked(proposeOrganization).mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  vi.mocked(cancelAi).mockResolvedValue(undefined);
  render(<OrganizationDesk settings={modelSettings} profileId="profile-a" revision={4} live chromeIds={['10']} />);
  fireEvent.click(screen.getByRole('button', { name: '提出文件夹' }));
  const id = vi.mocked(proposeOrganization).mock.calls[0]?.[2];
  expect(id).toMatch(/^org/);
  fireEvent.click(screen.getByRole('button', { name: '取消' }));
  expect(cancelAi).toHaveBeenCalledWith(id);
  await act(async () => finish(plan()));
  expect(screen.queryByLabelText('目标 Alpha')).not.toBeInTheDocument();
  expect(applyOrganization).not.toHaveBeenCalled();
});

it('R07 invalidates a reviewed plan after directory changes and retains it for read-only review', async () => {
  vi.mocked(proposeOrganization).mockResolvedValue(plan());
  const view = render(<OrganizationDesk settings={modelSettings} profileId="profile-a" revision={4} live chromeIds={['10']} />);
  fireEvent.click(screen.getByRole('button', { name: '提出文件夹' }));
  await screen.findByLabelText('目标 Alpha');
  view.rerender(<OrganizationDesk settings={modelSettings} profileId="profile-a" revision={5} live={false} chromeIds={['10']} />);
  expect(screen.getByRole('button', { name: '应用' })).toBeDisabled();
  expect(screen.getByText('资料已变化。旧方案不能应用。')).toBeVisible();
  expect(applyOrganization).not.toHaveBeenCalled();
});

it('R07 does not claim cancellation during confirmed apply and counts receipt ranges as steps', async () => {
  let finish!: (value: OrganizationPlan) => void;
  vi.mocked(proposeOrganization).mockResolvedValue(plan());
  vi.mocked(applyOrganization).mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  const view = render(<OrganizationDesk settings={modelSettings} profileId="profile-a" revision={4} live chromeIds={['10']} />);
  fireEvent.click(screen.getByRole('button', { name: '提出文件夹' }));
  fireEvent.click(await screen.findByRole('button', { name: '应用' }));
  expect(screen.getByRole('button', { name: '取消' })).toBeDisabled();
  view.rerender(<OrganizationDesk settings={modelSettings} profileId="profile-a" revision={5} live chromeIds={['10']} />);
  expect(screen.getByRole('button', { name: '取消' })).toBeDisabled();
  await act(async () => finish({ ...plan(), operationId: 'operation-a', phase: 'partial', applied: [{ start: 0, end: 40 }], pending: [{ start: 41, end: 61 }], uncertain: [{ start: 40, end: 41 }] }));
  await waitFor(() => expect(screen.getByText(/已完成 40 步 · 待处理 20 步 · 不确定 1 步/)).toBeVisible());
  expect(cancelOrganization).not.toHaveBeenCalled();
});
