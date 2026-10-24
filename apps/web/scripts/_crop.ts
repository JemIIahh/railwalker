import { chromium } from 'playwright-core';
const OUT = process.argv[2]!;
const url = process.argv[3] ?? 'http://localhost:3411/';
const sels = process.argv.slice(4);
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2, reducedMotion: 'reduce' })).newPage();
await page.goto(url, { waitUntil: 'networkidle' });
for (const [i, sel] of sels.entries()) {
  const el = page.locator(sel).first();
  await el.scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  await el.screenshot({ path: `${OUT}/crop-${i}.png` });
}
await browser.close();
