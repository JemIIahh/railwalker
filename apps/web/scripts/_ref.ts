import { chromium } from 'playwright-core';
const OUT = process.argv[2]!;
const targets: [string, string][] = [
  ['ferry-landing', 'http://localhost:5290/'],
  ['ferry-app', 'http://localhost:5290/app'],
  ['ferry-how', 'http://localhost:5290/how-it-works'],
  ['blindmarket', 'file:///Users/ram/Desktop/blindmarket-waitlist/index.html'],
];
const browser = await chromium.launch();
for (const [name, url] of targets) {
  for (const [tag, width, height, dpr] of [['1440', 1440, 900, 1], ['390', 390, 844, 2]] as const) {
    const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: dpr, colorScheme: 'light' });
    const page = await ctx.newPage();
    await page.goto(url, { waitUntil: 'load' }).catch((e) => console.error(name, String(e)));
    await page.waitForTimeout(1500);
    // scroll through so lazy reveals run, then back to the top
    const h = await page.evaluate(() => document.documentElement.scrollHeight);
    for (let y = 0; y < h; y += 500) { await page.evaluate((yy) => window.scrollTo(0, yy), y); await page.waitForTimeout(120); }
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(900);
    await page.screenshot({ path: `${OUT}/${name}-${tag}-fold.png` });
    await page.screenshot({ path: `${OUT}/${name}-${tag}-full.png`, fullPage: true });
    await ctx.close();
  }
  console.log('shot', name);
}
await browser.close();
