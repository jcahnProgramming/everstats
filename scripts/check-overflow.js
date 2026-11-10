// The visual pass's overflow check (0.9.1). Opens pages in headless Chromium at every width and theme and FAILS (exit 1)
// on any unintended overflow:
//   - the page itself scrolls sideways;
//   - any element that scrolls (overflow auto/scroll) has content bigger than its box, unless it is one of the
//     INTENDED sideways scrollers below, at a width where it is meant to scroll, scrolling sideways only, with no track.
// 0.9.0 shipped a one-pixel scrollbar on the character tab bar and a gear strip whose hidden names escaped it; this is
// the check that would have caught both.
//
//   node scripts/check-overflow.js http://localhost:3000 [/c/name-surname] [/g/guild-slug] [--profile=/u/name] [--cookie=name=value]
//
// Pages: the character page (both tabs), the Collections transmog screen, a guild page and the leaderboards index;
// 0.9.2: a public profile with --profile, and the signed-in home page (the dashboard, "Your guilds") with --cookie (a
// session cookie of a test account, e.g. es_session=… on a local server; never a real player's). Give a real
// character and guild that exist on the server you point it at. Chromium: `npx playwright-core install --only-shell
// chromium`. Themes are switched on the page (data-theme), so no sign-in is needed for them.
import { chromium } from 'playwright-core';

const flags = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => {
  const i = a.indexOf('=');
  return [a.slice(2, i < 0 ? undefined : i), i < 0 ? '' : a.slice(i + 1)];
}));
const [base = 'http://localhost:3000', character = '/c/path-vexley', guild = '/g/post-nerf-clarity'] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const PAGES = [character, `${character}/collections`, `${character}/collections/transmog`, guild, '/leaderboards',
  ...(flags.profile ? [flags.profile] : []), ...(flags.cookie ? ['/'] : [])];
const WIDTHS = [1920, 1440, 1024, 720, 390];
const THEMES = ['forever', 'alliance', 'horde'];
const PHONE = 719;
// Sideways scrollers that are meant to scroll on a phone (and only there): the design's chip rows, icon strips and the
// wide tables. Anything else that overflows is a bug.
const INTENDED = ['.seg.phone-scroll', '.armory-col', '.armory-bottom', '.slotpick', '.tblbox'];

const browser = await chromium.launch();
const problems = [];
for (const width of WIDTHS) {
  const ctx = await browser.newContext({ viewport: { width, height: 1000 } });
  if (flags.cookie) {
    const [name, ...rest] = flags.cookie.split('=');
    await ctx.addCookies([{ name, value: rest.join('='), url: base }]);
  }
  const page = await ctx.newPage();
  for (const path of PAGES) {
    await page.goto(base + path, { waitUntil: 'networkidle' });
    for (const theme of THEMES) {
      await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
      await page.waitForTimeout(100);
      const found = await page.evaluate(({ intended, phone }) => {
        const out = [];
        const label = (e) => `${e.tagName.toLowerCase()}${e.className && typeof e.className === 'string' ? `.${e.className.trim().split(/\s+/).join('.')}` : ''}`;
        const d = document.documentElement;
        if (d.scrollWidth > d.clientWidth) out.push(`the page scrolls sideways (${d.scrollWidth} > ${d.clientWidth})`);
        for (const e of document.querySelectorAll('body *')) {
          const cs = getComputedStyle(e);
          const scrolls = (v) => v === 'auto' || v === 'scroll';
          const ox = scrolls(cs.overflowX) && e.scrollWidth > e.clientWidth;
          const oy = scrolls(cs.overflowY) && e.scrollHeight > e.clientHeight;
          if (!ox && !oy) continue;
          const ok = intended.some((s) => e.matches(s)) && innerWidth <= phone && ox && !oy && (cs.scrollbarWidth === 'none' || e.offsetHeight === e.clientHeight + parseFloat(cs.borderTopWidth) + parseFloat(cs.borderBottomWidth));
          if (!ok) out.push(`${label(e)} overflows its box (content ${e.scrollWidth}×${e.scrollHeight}, box ${e.clientWidth}×${e.clientHeight})`);
        }
        return out;
      }, { intended: INTENDED, phone: PHONE });
      for (const f of found) problems.push(`${path} @${width}px ${theme}: ${f}`);
    }
  }
  await ctx.close();
}
await browser.close();
if (problems.length) {
  console.error(`Unintended overflow (${problems.length}):\n${problems.map((p) => `  ${p}`).join('\n')}`);
  process.exit(1);
}
console.log(`No unintended overflow: ${PAGES.length} pages × ${WIDTHS.length} widths × ${THEMES.length} themes.`);
