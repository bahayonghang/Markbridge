import { expect, test } from '@playwright/test';
import { mockBridge } from './mock-bridge';

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
}

function percentile95(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.ceil(sorted.length * 0.95) - 1]!;
}

test('T8 B10K virtual scroll p95 frame time, bounded DOM rows, and ordinary search p95 <= 200ms across 3 trials', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.addInitScript(() => {
    Object.assign(window, {
      __r03nodes: Array.from({ length: 10_000 }, (_, index) => ({
        chromeId: `b10k-${index}`,
        parentId: '1',
        position: index,
        kind: 'bookmark',
        title: index === 9999 ? `书签条目 ${String(index).padStart(4, '0')} MB05MARK` : `书签条目 ${String(index).padStart(4, '0')}`,
        url: `https://example.invalid/${index}`,
      })),
    });
  });
  await mockBridge(page, 'library');
  await page.goto('/');

  const list = page.getByRole('listbox', { name: '书签列表' });
  await expect(page.getByText('已加载 200 / 10000 项')).toBeVisible();
  await list.getByRole('option').first().focus();
  await page.keyboard.press('Control+End');
  await expect(page.getByText('已加载 10000 / 10000 项')).toBeVisible();

  const queries: Array<[string, string]> = [
    ['MB05MARK', '已加载 1 / 1 项'],
    ['书签条目 999', '已加载 10 / 10 项'],
    ['书签条目 00', '已加载 100 / 100 项'],
    ['书签条目 1', '已加载 200 / 1000 项'],
    ['example.invalid/4242', '已加载 1 / 1 项'],
    ['书签条目 50', '已加载 100 / 100 项'],
    ['书签条目 888', '已加载 10 / 10 项'],
    ['example.invalid/7777', '已加载 1 / 1 项'],
    ['书签条目 3', '已加载 200 / 1000 项'],
    ['书签条目 0123', '已加载 1 / 1 项'],
  ];

  const scrollP95Trials: number[] = [];
  const searchP95Trials: number[] = [];
  const maxDomRowsTrials: number[] = [];

  for (let trial = 1; trial <= 3; trial += 1) {
    const scrollResult = await page.evaluate(async () => {
      const scroller = document.querySelector<HTMLElement>('.list-pane .virtual-rows');
      if (!scroller) throw new Error('VIRTUAL_ROWS_MISSING');
      const maxScroll = Math.max(1, scroller.scrollHeight - scroller.clientHeight);
      scroller.scrollTop = 0;
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));

      const deltas: number[] = [];
      let maxDomRows = document.querySelectorAll('.list-pane [role="option"]').length;
      let prev = performance.now();
      const steps = 25;
      for (let step = 1; step <= steps; step += 1) {
        scroller.scrollTop = Math.floor((maxScroll * step) / steps);
        const now = await new Promise<number>((resolve) => requestAnimationFrame(resolve));
        deltas.push(now - prev);
        prev = now;
        const rows = document.querySelectorAll('.list-pane [role="option"]').length;
        if (rows > maxDomRows) maxDomRows = rows;
      }
      scroller.scrollTop = 0;
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      return { deltas, maxDomRows };
    });

    const scrollP95 = percentile95(scrollResult.deltas);
    expect(scrollResult.maxDomRows).toBeGreaterThan(0);
    expect(scrollResult.maxDomRows).toBeLessThan(100);
    scrollP95Trials.push(scrollP95);
    maxDomRowsTrials.push(scrollResult.maxDomRows);

    const searchLatencies = await page.evaluate(async (pairs) => {
      const input = document.getElementById('library-search') as HTMLInputElement | null;
      const meta = document.querySelector('.library-list-meta');
      if (!input || !meta) throw new Error('SEARCH_INPUT_OR_META_MISSING');
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      const waitForMeta = (expected: string) => new Promise<number>((resolve, reject) => {
        const started = performance.now();
        const check = () => {
          if (meta.textContent?.includes(expected)) {
            observer.disconnect();
            clearTimeout(timer);
            resolve(performance.now() - started);
          }
        };
        const observer = new MutationObserver(check);
        observer.observe(meta, { childList: true, subtree: true, characterData: true });
        const timer = window.setTimeout(() => {
          observer.disconnect();
          reject(new Error(`SEARCH_TIMEOUT:${expected}:${meta.textContent}`));
        }, 2000);
        check();
      });

      const times: number[] = [];
      for (const [query, expected] of pairs) {
        const promise = waitForMeta(expected);
        setter.call(input, query);
        input.dispatchEvent(new Event('input', { bubbles: true }));
        times.push(await promise);
      }
      const resetPromise = waitForMeta('已加载 200 / 10000 项');
      setter.call(input, '');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      await resetPromise;
      return times;
    }, queries);

    const searchP95 = percentile95(searchLatencies);
    expect(searchP95).toBeLessThanOrEqual(200);
    searchP95Trials.push(searchP95);

    console.info(
      `TRACK_D_TRIAL_${trial} scroll_p95_ms=${scrollP95.toFixed(2)} max_dom_rows=${scrollResult.maxDomRows} search_p95_ms=${searchP95.toFixed(2)}`,
    );

    await expect(page.getByText('已加载 200 / 10000 项')).toBeVisible();
    await list.getByRole('option').first().focus();
    await page.keyboard.press('Control+End');
    await expect(page.getByText('已加载 10000 / 10000 项')).toBeVisible();
  }

  const scrollMedian = median(scrollP95Trials);
  const searchMedian = median(searchP95Trials);
  const domMax = Math.max(...maxDomRowsTrials);
  expect(domMax).toBeLessThan(100);
  expect(searchMedian).toBeLessThanOrEqual(200);
  console.info(
    `TRACK_D_SUMMARY scroll_p95_median_ms=${scrollMedian.toFixed(2)} max_dom_rows=${domMax} search_p95_median_ms=${searchMedian.toFixed(2)}`,
  );
});
