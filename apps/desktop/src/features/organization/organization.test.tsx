import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { OrganizationPlan } from '@markbridge/protocol';
import { OrganizationDesk } from './OrganizationDesk';
import { applyOrganization, proposeOrganization } from '../../backend';

vi.mock('../../backend', () => ({
  proposeOrganization: vi.fn(),
  reviewOrganization: vi.fn(),
  assignOrganization: vi.fn(),
  editOrganization: vi.fn(),
  applyOrganization: vi.fn(),
  pauseOrganization: vi.fn(),
  cancelOrganization: vi.fn(),
  cleanupOrganization: vi.fn(),
  organizationPlan: vi.fn(),
}));

afterEach(() => cleanup());

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
  render(<OrganizationDesk profileId="profile-a" revision={4} live chromeIds={['10']} />);
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
