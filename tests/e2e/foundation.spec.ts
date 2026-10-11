import { expect, test, type Page } from '@playwright/test';

const evidence = '.trellis/tasks/10-10-mb-03-chrome-bridge/evidence';

// The mock module exists only in this test route. Production browser previews stay unpaired.
async function mockBridge(page: Page, scenario: 'connected' | 'startup-error' | 'port-conflict' = 'connected') {
  await page.route('**/src/backend.ts*', (route) => route.fulfill({
    contentType: 'application/javascript',
    body: `
      const initial = { protocolVersion: 1, revision: 1, port: null, errorCode: null, profiles: [], pending: [] };
      let receive;
      let state = initial;
      let starts = 0;
      const profile = { profileId: 'profile-test', instanceId: 'instance-test', displayName: '测试研究资料', connection: 'live', nodeCount: 27, revision: 8, lastSyncedAt: null, errorCode: null };
      export const hasNativeBridge = () => true;
      export async function subscribeBridgeState(next) { receive = next; return () => { if (receive === next) receive = undefined; }; }
      export async function getStartupState() { ${scenario === 'startup-error' ? "throw new Error('sensitive-raw-error');" : "return { protocolVersion: 1, state: 'unpaired' };"} }
      export async function getBridgeState() {
        ${scenario === 'connected' ? "state = { ...initial, revision: 3, port: 49153, profiles: [profile] }; receive?.(state);" : ''}
        return initial;
      }
      export async function startBridge(port) {
        starts += 1;
        ${scenario === 'port-conflict' ? "if (starts === 1) throw 'CONFLICT';" : ''}
        state = { ...state, revision: state.revision + 1, port };
        return state;
      }
      export async function beginPairing() { throw new Error('mock-offer-unavailable'); }
      export async function confirmPairing() { throw new Error('mock-confirm-unavailable'); }
      export async function cancelPairing() { return state; }
      export async function reconnectProfile() {
        state = { ...state, revision: state.revision + 1, profiles: [{ ...profile, connection: 'reconciling' }] };
        receive?.(state);
        return initial;
      }
      export async function revokePairing() {
        state = { ...state, revision: state.revision + 1, profiles: [{ ...profile, connection: 'unpaired' }] };
        return state;
      }
    `,
  }));
}

for (const size of [{ width: 1100, height: 760 }, { width: 640, height: 480 }]) {
  test(`browser preview ${size.width}x${size.height}`, async ({ page }) => {
    await page.setViewportSize(size);
    await page.goto('/');
    await expect(page.getByRole('status')).toHaveText('未连接 · 只读');
    await expect(page.getByText(/浏览器预览/)).toBeVisible();
    await expect(page.getByRole('button', { name: '启动连接' })).toBeDisabled();
    await expect(page.getByRole('button', { name: '生成配对串' })).toBeDisabled();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `${evidence}/browser-preview-${size.width}x${size.height}.png`, fullPage: true });
    await page.keyboard.press('Tab');
    await expect(page.getByRole('link', { name: '跳至内容' })).toBeFocused();
  });

  test(`connection diagnostics mock ${size.width}x${size.height}`, async ({ page }) => {
    await mockBridge(page);
    await page.setViewportSize(size);
    await page.goto('/?harness=bridge');
    await expect(page.getByRole('status')).toHaveText('已连接 Chrome');
    await expect(page.getByText('27', { exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `${evidence}/browser-diagnostics-mock-${size.width}x${size.height}.png`, fullPage: true });
    await page.getByRole('button', { name: '重新连接' }).click();
    await expect(page.getByText('核对中 · 只读')).toBeVisible();
    await page.getByRole('button', { name: '吊销配对' }).click();
    await expect(page.getByText('未配对 · 只读')).toBeVisible();
    await expect(page.getByText('27', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '吊销配对' })).toBeDisabled();
  });
}

test('startup failure hides raw backend details', async ({ page }) => {
  await mockBridge(page, 'startup-error');
  await page.goto('/?harness=bridge');
  await expect(page.getByRole('alert')).toContainText('无法读取启动状态');
  await expect(page.getByText('sensitive-raw-error')).toHaveCount(0);
});

test('port conflict allows an edited retry without exposing rejection details', async ({ page }) => {
  await mockBridge(page, 'port-conflict');
  await page.goto('/?harness=bridge');
  await expect(page.getByRole('button', { name: '启动连接' })).toBeEnabled();
  await page.getByLabel('端口').fill('70000');
  await page.getByRole('button', { name: '启动连接' }).click();
  await expect(page.getByRole('alert')).toContainText('1024–65535');
  await page.getByLabel('端口').fill('49153');
  await page.getByRole('button', { name: '启动连接' }).click();
  await expect(page.getByRole('alert')).toContainText('请检查端口是否占用');
  await page.getByLabel('端口').fill('49154');
  await page.getByRole('button', { name: '启动连接' }).click();
  await expect(page.getByText('127.0.0.1:49154', { exact: true })).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
});
