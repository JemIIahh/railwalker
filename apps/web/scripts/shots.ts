/**
 * Screenshots of the running site, for looking at it with your own eyes: the map, a replay, the ledger and the methodology, on a
 * phone and a desktop, light and dark. Needs the site running (default http://localhost:3411) and a Chromium that
 * playwright-core can find, or CHROMIUM_PATH.
 *
 *   pnpm --filter @railwalker/web shots            (writes apps/web/.shots)
 */
import { mkdir, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser } from 'playwright-core';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(HERE, '..', '.shots');
const SAMPLE = path.resolve(HERE, '..', '.sample-data');
const RUNS = path.join(SAMPLE, 'runs');
const BASE = process.env.BASE_URL ?? 'http://localhost:3411';

const SIZES = [
  { name: 'phone', width: 390, height: 844 },
  { name: 'desktop', width: 1280, height: 900 },
] as const;
const SCHEMES = ['light', 'dark'] as const;

/** The run pages worth looking at: one clean, a few that broke after payment, and a real-service route. */
const RUN_ENDS = ['/ok', '/paid/empty', '/paid/slow', '/bad/permit2-method', 'social/x/posts/search'];

async function runIds(): Promise<Record<string, string>> {
  const found: Record<string, string> = {};
  for (const file of await readdir(RUNS).catch(() => [])) {
    const run = JSON.parse(await readFile(path.join(RUNS, file), 'utf8')) as { id: string; endpoint: { url: string } };
    for (const end of RUN_ENDS) if (run.endpoint.url.endsWith(end)) found[end.replace(/^\//, '').replace(/[^\w]+/g, '-')] = run.id;
  }
  return found;
}

async function main(): Promise<void> {
  await mkdir(OUT, { recursive: true });
  const executablePath = process.env.CHROMIUM_PATH;
  const browser: Browser = await chromium.launch(executablePath ? { executablePath } : {});
  const pages: Record<string, string> = { home: '/', explore: '/explore', proof: '/proof', how: '/how' };
  for (const [name, id] of Object.entries(await runIds())) pages[`run-${name}`] = `/run/${id}`;
  // `pnpm shots home proof` takes only the pages named, the rest are skipped
  const only = process.argv.slice(2);
  if (only.length > 0) for (const name of Object.keys(pages)) if (!only.some((o) => name.startsWith(o))) delete pages[name];

  try {
    for (const size of SIZES) {
      for (const colorScheme of SCHEMES) {
        // Reduced motion: the replay is drawn whole instead of playing, so the page can be judged as a still.
        const context = await browser.newContext({ viewport: { width: size.width, height: size.height }, colorScheme, reducedMotion: 'reduce', deviceScaleFactor: 2 });
        const page = await context.newPage();
        for (const [name, route] of Object.entries(pages)) {
          const response = await page.goto(`${BASE}${route}`, { waitUntil: 'networkidle' });
          if (!response || !response.ok()) console.error(`!! ${route}: HTTP ${response?.status()}`);
          const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
          if (overflow > 0) console.error(`!! ${route} at ${size.width}px scrolls sideways by ${overflow}px`);
          await page.screenshot({ path: path.join(OUT, `${name}-${size.name}-${colorScheme}.png`), fullPage: true });
        }
        await context.close();
      }
    }

    // The interactive states: a cell pointed at, the drawer it opens, and the result of a check (answered from the sample report).
    for (const size of SIZES) {
      const context = await browser.newContext({ viewport: { width: size.width, height: size.height }, colorScheme: 'light', deviceScaleFactor: 2, reducedMotion: 'reduce' });
      const page = await context.newPage();
      await page.route('**/api/scan*', async (route) => route.fulfill({ status: 200, contentType: 'application/json', body: await readFile(path.join(SAMPLE, 'scan-demo.json'), 'utf8') }));
      await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
      await page.locator('#map').scrollIntoViewIfNeeded();
      const cell = page.locator('a.cell.v-fail.confirmed').first();
      if (size.name === 'desktop') {
        await cell.hover();
        await page.waitForTimeout(300);
        await page.screenshot({ path: path.join(OUT, `state-popover-${size.name}.png`) });
        await page.mouse.move(2, 2);
      }
      await cell.click();
      await page.waitForSelector('.sheet');
      await page.waitForTimeout(700);
      await page.screenshot({ path: path.join(OUT, `state-drawer-${size.name}.png`) });
      await page.keyboard.press('Escape');
      await page.waitForTimeout(500);
      await page.locator('#check').scrollIntoViewIfNeeded();
      await page.fill('#check input[type=url]', 'https://seller.sample.example/api/data');
      await page.click('#check button[type=submit]');
      await page.waitForTimeout(500);
      await page.locator('#check').scrollIntoViewIfNeeded();
      await page.waitForTimeout(900);
      await page.locator('#check .check').screenshot({ path: path.join(OUT, `state-check-${size.name}.png`) });
      await context.close();
    }

    // The replay as it plays: motion allowed, a few seconds in.
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: 'light', deviceScaleFactor: 2 });
    const page = await context.newPage();
    const first = Object.entries(pages).find(([name]) => name.startsWith('run-ok'));
    if (first) {
      await page.goto(`${BASE}${first[1]}`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(3600);
      await page.screenshot({ path: path.join(OUT, 'replay-playing-desktop-light.png'), fullPage: true });
    }
    await context.close();
  } finally {
    await browser.close();
  }
  console.log(`screenshots in ${OUT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
