import { chromium } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const sizes = [16, 24, 32, 48, 128, 256];
const candidates = [['A original', 'candidate-a.png'], ['B original', 'candidate-b.png'], ['A selected refinement', 'selected-a.png']];
const html = `<!doctype html><html lang="en"><meta charset="utf-8"><title>S01 icon comparison</title>
<style>
*{box-sizing:border-box}body{margin:0;padding:24px;font:14px/1.5 "Segoe UI",sans-serif;background:#f3f5f8;color:#202733}h1{font-size:22px;margin:0 0 6px}p{margin:0 0 20px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}.panel{padding:20px;border:1px solid #dee3eb;background:#fff}.panel.dark{background:#171b22;color:#e8edf5;border-color:#303b4b}h2{margin:0 0 16px;font-size:16px}.icons{display:flex;align-items:center;gap:16px;height:288px}.sample{display:flex;flex:none;flex-direction:column;align-items:center;gap:12px}.sample img{display:block;object-fit:contain}.sample span{font-size:12px}
</style><h1>Markbridge · S01 generated icon comparison</h1><p>Actual CSS sizes at 100%, light #FFFFFF / dark #171B22. Transparent PNG; no CSS filters or recoloring.</p><div class="grid">${candidates.map(([label, file]) => ['light', 'dark'].map(theme => `<section class="panel ${theme}"><h2>${label} · ${theme}</h2><div class="icons">${sizes.map(size => `<div class="sample"><img src="../assets/${file}" alt="${label}" width="${size}" height="${size}"><span>${size}px</span></div>`).join('')}</div></section>`).join('')).join('')}</div></html>`;
const path = join(import.meta.dirname, 'icon-comparison.html');
await writeFile(path, html);
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1320, height: 1180 }, deviceScaleFactor: 1 });
  await page.goto(pathToFileURL(path).href);
  await page.locator('img').evaluateAll(images => Promise.all(images.map(image => image.decode())));
  await page.screenshot({ path: join(import.meta.dirname, 'icon-comparison.png'), fullPage: true });
  console.log('A/B and selected refinement: 16/24/32/48/128/256px, light/dark comparison captured.');
} finally { await browser.close(); }
