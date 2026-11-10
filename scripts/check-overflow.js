// The visual pass's overflow check (0.9.1). Opens pages in headless Chromium at every width and theme and FAILS (exit 1)
// on any unintended overflow:
//   - the page itself scrolls sideways;
//   - any element that scrolls (overflow auto/scroll) has content bigger than its box, unless it is one of the
//     INTENDED sideways scrollers below, at a width where it is meant to scroll, scrolling sideways only, with no track.
// 0.9.0 shipped a one-pixel scrollbar on the character tab bar and a gear strip whose hidden names escaped it; this is
// the check that would have caught both.
//
// 0.10.4: it also fails on content that ESCAPES its box without scrolling, which 0.10.3's admin tables did while this
// check passed: the site wrapper (.es) clips sideways overflow (overflow-x: clip), so the page never scrolls, and a
// table in an overflow: visible wrapper is no scroll box. Now: the wrapper's own content width, and every table and
// card against the bordered box it sits in. And it runs at 1568 (the owner's window) too. Fill the server with
// realistic lengths first: `node scripts/seed-overflow-fixtures.js` (a LOCAL database only; it prints the flags).
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
// 0.10.3: --admin=<es_admin cookie value> checks every admin page instead (client/src/admin/shell/nav.js PAGES), with
// --admin-ids=account:ID,guild:ID,feedback:ID filling the pages that need one (an admin session of a LOCAL server only).
const adminIds = Object.fromEntries((flags['admin-ids'] ?? '').split(',').filter(Boolean).map((x) => x.split(':')));
// 0.10.4: a page that follows the version switcher (scope 'version') is checked on a second version too: Tiers › Group
// decisions only shows its Suggestion column off the primary version, and that is where it overflowed.
const { GAME_VERSIONS } = await import('../server/core/gameVersions.js');
const OTHER_VERSION = GAME_VERSIONS.find((v) => !v.primary)?.id;
const ADMIN_PAGES = flags.admin === undefined ? [] : (await import('../client/src/admin/shell/nav.js')).PAGES.flatMap((p) => (p.scope === 'version' && OTHER_VERSION && !p.path.includes(':') ? [p.path, `${p.path}?v=${OTHER_VERSION}&r=us`] : [p.path]))
  .map((p) => p.replace('/accounts/:id', `/accounts/${adminIds.account ?? ''}`).replace('/guilds/:id', `/guilds/${adminIds.guild ?? ''}`).replace('/feedback/:id', `/feedback/${adminIds.feedback ?? ''}`))
  .filter((p) => !p.includes(':') && !p.includes('//') && !p.split('?')[0].endsWith('/'));
const PAGES = flags.admin !== undefined ? ADMIN_PAGES : [character, `${character}/collections`, `${character}/collections/transmog`, guild, '/leaderboards',
  ...(flags.profile ? [flags.profile] : []), ...(flags.cookie ? ['/'] : []),
  // 0.11.1: --pages=/a,/b adds any other addresses (another game version's character, guild and boards; the seed
  // script prints them). A comma never appears in an Everstats address.
  ...(flags.pages ? flags.pages.split(',').filter(Boolean) : [])];
// 0.11.1: --shots=<folder> also saves a picture of every page at every width in the Forever theme, for the eye.
const SHOTS = flags.shots || null;
// --only=a,b keeps the pages whose path contains one of them; --widths=1568,390 picks widths (0.10.4).
const ONLY = (flags.only ?? '').split(',').filter(Boolean);
const CHECKED = ONLY.length ? PAGES.filter((p) => ONLY.some((o) => p.includes(o))) : PAGES;
const WIDTHS = flags.widths ? flags.widths.split(',').map(Number) : [1920, 1568, 1440, 1024, 720, 390];
const THEMES = ['forever', 'alliance', 'horde'];
const PHONE = 719;
// Sideways scrollers that are meant to scroll on a phone (and only there): the design's chip rows, icon strips and the
// wide tables. Anything else that overflows is a bug.
const INTENDED = ['.seg.phone-scroll', '.armory-col', '.armory-bottom', '.slotpick', '.tblbox', '.adm .tabs', '.adm .inpage nav'];

const browser = await chromium.launch();
const problems = [];
for (const width of WIDTHS) {
  const ctx = await browser.newContext({ viewport: { width, height: 1000 } });
  if (flags.cookie) {
    const [name, ...rest] = flags.cookie.split('=');
    await ctx.addCookies([{ name, value: rest.join('='), url: base }]);
  }
  if (flags.admin) await ctx.addCookies([{ name: 'es_admin', value: flags.admin, url: base }]);
  const page = await ctx.newPage();
  // 0.10.0: a page that throws, or draws nothing, fails too. (A client bundle that crashed on load rendered every page
  // blank, and a blank page has no overflow: the check passed while nothing worked.)
  let thrown = null;
  page.on('pageerror', (e) => { thrown = String(e?.message ?? e).slice(0, 200); });
  for (const path of CHECKED) {
    thrown = null;
    await page.goto(base + path, { waitUntil: 'networkidle' });
    const drawn = await page.evaluate(() => (document.querySelector('main')?.innerText ?? document.body.innerText).trim().length);
    if (thrown || drawn < 20) problems.push(`${width}px ${path}: ${thrown ? `the page threw: ${thrown}` : 'the page drew nothing'}`);
    for (const theme of THEMES) {
      await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
      await page.waitForTimeout(100);
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/${width}-${theme}-${path.replace(/[^a-z0-9]+/gi, '_').slice(0, 80)}.png`, fullPage: false });
      const found = await page.evaluate(({ intended, phone }) => {
        const out = [];
        const label = (e) => `${e.tagName.toLowerCase()}${e.className && typeof e.className === 'string' ? `.${e.className.trim().split(/\s+/).join('.')}` : ''}`;
        const d = document.documentElement;
        if (d.scrollWidth > d.clientWidth) out.push(`the page scrolls sideways (${d.scrollWidth} > ${d.clientWidth})`);
        // Clipped, not scrolled: content wider than the wrapper that clips it.
        for (const w of document.querySelectorAll('.es, .adm')) {
          if (w.scrollWidth > w.clientWidth + 1) out.push(`${label(w)} holds content wider than the page (${w.scrollWidth} > ${w.clientWidth}), clipped instead of fitting`);
        }
        // Escaping its box: a table (or a card) wider than the bordered box around it. Never counts what is hidden.
        const boxed = (e) => {
          for (let a = e.parentElement; a && a !== document.body; a = a.parentElement) {
            const s = getComputedStyle(a);
            if (parseFloat(s.borderLeftWidth) > 0 && parseFloat(s.borderRightWidth) > 0) return a;
          }
          return null;
        };
        for (const e of document.querySelectorAll('table, .ap, .card')) {
          if (!e.offsetParent || e.closest('[aria-hidden="true"], .sr-only')) continue;
          const box = boxed(e);
          if (!box) continue;
          const r = e.getBoundingClientRect();
          const b = box.getBoundingClientRect();
          const scroller = (() => { for (let a = e.parentElement; a; a = a.parentElement) { const s = getComputedStyle(a).overflowX; if (s === 'auto' || s === 'scroll') return true; if (a === box) break; } return false; })();
          if (!scroller && (r.right > b.right + 1 || r.left < b.left - 1)) out.push(`${label(e)} escapes its box ${label(box)} by ${Math.round(Math.max(r.right - b.right, b.left - r.left))}px`);
        }
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
console.log(`No unintended overflow: ${CHECKED.length} pages × ${WIDTHS.length} widths × ${THEMES.length} themes.`);
