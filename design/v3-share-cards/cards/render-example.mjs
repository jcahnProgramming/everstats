// Reference server renderer (Node + Playwright, headless Chromium). Not production code — a working sketch.
// usage: node render-example.mjs character square a data.json out.png
import { chromium } from 'playwright';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const SIZES = { square: [1080, 1080], story: [1080, 1920], wide: [1200, 630] };
const [type, format, layout, dataFile, out] = process.argv.slice(2);
const [width, height] = SIZES[format];
const data = JSON.parse(await readFile(dataFile, 'utf8'));
const template = path.resolve(`cards/${type}/${format}-${layout}.html`);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
// Swap the example data script for the real payload before any page script runs.
await page.route('**/data/*.example.js', route =>
  route.fulfill({ contentType: 'application/javascript', body: 'window.CARD_DATA = ' + JSON.stringify(data) + ';' }));
await page.goto('file://' + template);
await page.waitForSelector('html[data-ready="1"]', { timeout: 15000 });
await page.locator('[data-card]').screenshot({ path: out, type: 'png' });
await browser.close();
