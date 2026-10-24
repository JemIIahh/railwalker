// throwaway: node scripts/peek.mjs <route> <width> <height> <light|dark> <out.png> [reduce|motion] [waitMs] [fullpage|view]
import { chromium } from 'playwright-core';
const [route, w, h, scheme, out, motion = 'reduce', wait = '2500', mode = 'fullpage', scrollY = '0'] = process.argv.slice(2);
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });
const ctx = await browser.newContext({ viewport: { width: +w, height: +h }, colorScheme: scheme, reducedMotion: motion === 'reduce' ? 'reduce' : 'no-preference', deviceScaleFactor: 1 });
const page = await ctx.newPage();
const logs = [];
page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) logs.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
const res = await page.goto(`http://localhost:3411${route}`, { waitUntil: 'domcontentloaded', timeout: 90000 });
await page.waitForTimeout(+wait);
if (+scrollY > 0) { await page.evaluate((y) => window.scrollTo(0, y), +scrollY); await page.waitForTimeout(900); }
const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
await page.screenshot({ path: out, fullPage: mode === 'fullpage', timeout: 120000 });
console.log(`${route} ${w}x${h} ${scheme} http=${res?.status()} overflow=${overflow}`);
for (const l of logs.slice(0, 12)) console.log(l);
await browser.close();
