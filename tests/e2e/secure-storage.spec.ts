import { expect, test } from '@playwright/test';
import { mockBridge } from './mock-bridge';

const before = process.env.MARKBRIDGE_SECURE_STORAGE_BEFORE === '1';
const evidence = process.env.MARKBRIDGE_EVIDENCE_DIR ?? 'test-results/screenshots';
for (const size of [{ width: 1440, height: 900 }, { width: 1100, height: 760 }, { width: 640, height: 760 }, { width: 1100, height: 480 }, { width: 640, height: 480 }]) {
  test(`14 native credential failure has safe recovery guidance ${size.width}x${size.height}`, async ({ page }) => {
    await mockBridge(page);
    await page.setViewportSize(size);
    await page.goto('/');
    await page.evaluate(() => {
      (window as unknown as { __r07patch: (value: object) => void }).__r07patch({ errorCode: 'STORAGE_ERROR' });
    });
    await page.getByRole('button', { name: '设置', exact: true }).click();
    const storage = page.getByText(before ? '无法读取本机缓存。请重新打开应用。' : '本机存储不可用。请检查缓存权限及系统凭据服务是否已解锁，再重试。', { exact: true });
    await storage.scrollIntoViewIfNeeded();
    await expect(storage).toBeVisible();
    await page.screenshot({ path: `${evidence}/secure-storage-${before ? 'before' : 'after'}-connection-${size.width}x${size.height}.png` });
    await page.getByRole('tab', { name: 'AI', exact: true }).click();
    const secret = page.locator('#ai-secret');
    await secret.fill('fixture-secret-not-saved');
    await page.evaluate(() => { (window as unknown as { __t14CredentialFailure: boolean }).__t14CredentialFailure = true; });
    const save = page.getByRole('button', { name: '保存密钥', exact: true });
    await save.focus();
    await page.keyboard.press('Enter');
    const message = page.getByRole('status').filter({ hasText: before ? '操作未完成。没有发送页面内容。' : '密钥未保存。请检查系统凭据服务是否已解锁，再重试。' });
    await expect(message).toBeVisible();
    await message.scrollIntoViewIfNeeded();
    await expect(secret).toHaveValue('');
    await expect(page.getByText('未保存密钥', { exact: false })).toBeVisible();
    await expect(page.locator('body')).not.toContainText('fixture-private-credential-detail');
    await expect(page.locator('body')).not.toContainText('fixture-secret-not-saved');
    const calls = await page.evaluate(() => (window as unknown as { __r01calls: string[] }).__r01calls);
    expect(calls).not.toContain('test_ai');
    expect(calls).not.toContain('ai_suggest');
    await expect(save).toBeEnabled();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(size.width);
    expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBe(size.height);
    await page.screenshot({ path: `${evidence}/secure-storage-${before ? 'before' : 'after'}-ai-${size.width}x${size.height}.png` });
  });
}

test('14 secure-store pairing rejection preserves existing profiles with safe guidance', async ({ page }) => {
  test.skip(before, 'Before captures only record existing text.');
  await mockBridge(page);
  await page.goto('/');
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.evaluate(() => { (window as unknown as { __t14PairingFailure: boolean }).__t14PairingFailure = true; });
  await page.getByRole('button', { name: '生成配对串', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText('本机存储不可用。请检查缓存权限及系统凭据服务是否已解锁，再重试。');
  await expect(page.locator('#pairing-code')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '生成配对串', exact: true })).toBeEnabled();
  await expect(page.getByRole('heading', { name: '测试研究资料', exact: true })).toBeVisible();
});
