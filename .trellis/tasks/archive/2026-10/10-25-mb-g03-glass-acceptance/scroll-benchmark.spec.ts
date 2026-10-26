import { expect, test } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { cpus, totalmem, platform, release } from 'node:os';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { mockBridge } from '../../../tests/e2e/mock-bridge';

const output = process.env.MARKBRIDGE_EVIDENCE_DIR!;
test.setTimeout(90000);
for (const theme of ['light', 'dark']) test(`B10K scroll ${theme}`, async ({ page, browser }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.addInitScript(theme => {
    localStorage.setItem('markbridge.ui-preferences.v2', JSON.stringify({ version: 2, theme, font: { kind: 'preset', value: 'system' }, fontSizePx: 14 }));
    Object.assign(window, { __r03nodes: Array.from({ length: 10000 }, (_, index) => ({ chromeId: `wide-${index}`, parentId: '1', position: index, kind: 'bookmark', title: `Glass performance ${index}`, url: `https://example.invalid/${index}` })) });
  }, theme);
  await mockBridge(page, 'library'); await page.goto('/');
  const list = page.getByRole('listbox', { name: '书签列表' });
  await expect(page.getByText(/已加载 200 \/ 10000/)).toBeVisible();
  await list.getByRole('option').first().focus();
  await page.keyboard.press('Control+End');
  await expect(page.getByText(/已加载 10000 \/ 10000/)).toBeVisible();
  await expect(list.getByRole('option', { name: /Glass performance 9999/ })).toBeFocused();
  // Remove active focus before scripted scroll; keyboard scrolling is tested separately.
  await page.locator('.workspace-heading h1').focus();
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Tracing.start', { categories: 'devtools.timeline,blink,cc', transferMode: 'ReturnAsStream' });
  const rounds = [];
  for (let round = 0; round < 3; round += 1) {
    rounds.push(await list.evaluate(element => new Promise<Record<string, unknown>>(resolve => {
      const frames: number[] = []; let last = 0; let frame = 0; let maxRows = 0;
      const step = (time: number) => {
        if (last && frame > 30) frames.push(time - last);
        last = time;
        const travel = (frame % 240) / 239;
        element.scrollTop = Math.floor(travel * (element.scrollHeight - element.clientHeight));
        maxRows = Math.max(maxRows, element.querySelectorAll('[role="option"]').length);
        frame += 1;
        if (frame <= 240) requestAnimationFrame(step);
        else {
          const sorted = [...frames].sort((a, b) => a - b);
          resolve({ frames, p95: sorted[Math.ceil(sorted.length * .95) - 1], max: sorted.at(-1), longFramesOver50ms: frames.filter(value => value > 50).length, maxRows, clientHeight: element.clientHeight, rowHeight: element.querySelector('[role="option"]')!.getBoundingClientRect().height });
        }
      };
      requestAnimationFrame(step);
    })));
  }
  const complete = new Promise<{ stream: string }>(resolve => cdp.once('Tracing.tracingComplete', resolve));
  await cdp.send('Tracing.end');
  const { stream } = await complete;
  let trace = '';
  while (true) { const part = await cdp.send('IO.read', { handle: stream }); trace += part.data; if (part.eof) break; }
  await cdp.send('IO.close', { handle: stream });
  await mkdir(output, { recursive: true });
  const traceBytes = gzipSync(trace);
  const traceFile = `scroll-${theme}-trace.json.gz`;
  await writeFile(join(output, traceFile), traceBytes);
  const traceReceipt = { file: traceFile, encoding: 'gzip', uncompressedBytes: Buffer.byteLength(trace), compressedBytes: traceBytes.length, sha256: createHash('sha256').update(traceBytes).digest('hex') };
  const material = await page.evaluate(() => ({ paper: getComputedStyle(document.querySelector('.workspace')!).backdropFilter, blurLayers: [...document.querySelectorAll('*')].filter(node => getComputedStyle(node).backdropFilter !== 'none').length, rowFilters: [...new Set([...document.querySelectorAll('.library-row')].map(node => getComputedStyle(node).filter))], rowBackdropFilters: [...new Set([...document.querySelectorAll('.library-row')].map(node => getComputedStyle(node).backdropFilter))] }));
  const p95s = rounds.map(round => Number(round.p95)).sort((a, b) => a - b);
  const result = { source: process.env.MARKBRIDGE_BASELINE === '1' ? 'HEAD-2ac7979' : 'current', fixture: 'wide synthetic 10000 bookmarks; reused R03 mock; not native search', theme, viewport: { width: 1440, height: 900 }, browser: browser.version(), machine: { platform: platform(), release: release(), cpu: cpus()[0].model, logicalCpus: cpus().length, totalMemory: totalmem() }, material, traceReceipt, rounds, medianP95: p95s[1] };
  await writeFile(join(output, `scroll-${theme}.json`), JSON.stringify(result, null, 2));
  for (const round of rounds) expect(Number(round.maxRows)).toBeLessThanOrEqual(Math.ceil(Number(round.clientHeight) / Number(round.rowHeight)) + 7);
  expect(material.blurLayers).toBeLessThanOrEqual(1);
  expect(material.rowFilters).toEqual(['none']);
  expect(material.rowBackdropFilters).toEqual(['none']);
});
