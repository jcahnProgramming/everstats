// Share-card render cost (0.8.0): every type × format once, then bursts in parallel, with Chromium's memory sampled.
// Uses FIXTURE data (names say so; no Blizzard values, no Blizzard images) and the real renderer (server/cards/render.js).
//
//   node scripts/measure-cards.js                    on a dev machine (Chromium from `npx playwright-core install --only-shell chromium`)
//   docker exec everstats node scripts/measure-cards.js   on the server (the image carries Chromium)
//
// Prints times in ms and the resident memory of the Chromium processes (Linux: /proc via ps; Windows: tasklist).
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);
import { createCardRenderer } from '../server/cards/render.js';

const FIX = 'Fixture';
const stats = Array.from({ length: 6 }, (_, i) => ({ label: `Fixture statistic ${i + 1}`, value: (1000 * (6 - i)).toLocaleString('en-US'), rank: `#${i + 1} · Fixture` }));
const DATA = {
  character: { theme: 'forever', accent: 'accent', url: 'everstats.example/c/fixture-card', asof: 'Nov 9, 2026', first: FIX, last: 'Card', initials: 'FC', meta: 'Level 60 · Fixture · Fixture', faction: 'Horde', ruleset: FIX, guild: 'Fixture Guild', render: null, tier: { letter: 'A', cls: 'a', pct: 'Top 12%' }, badge: { svg: '', name: '' }, stats, gear: Array.from({ length: 16 }, () => ({ q: 'q-epic', icon: null })), show: { tier: true, badge: false, guild: true, gear: true } },
  guild: { theme: 'horde', accent: 'c2', url: 'everstats.example/g/fixture-guild', asof: 'Nov 9, 2026', name: 'Fixture Guild', faction: 'Horde', ruleset: FIX, members: '42 tracked members', pinned_svg: '', badges: [], totals: stats.slice(0, 4).map((s) => ({ label: s.label, value: s.value })), place: { rank: '#3', stat: 'Fixture statistic 1', scope: 'Guild board · total · Fixture · Overall' }, tiers: [{ k: 's', w: 10, t: 'S' }, { k: 'a', w: 30, t: 'A' }, { k: 'u', w: 60, t: '–' }], discord: '', show: { recruiting: false } },
  board: { theme: 'alliance', accent: 'accent', url: 'everstats.example/leaderboards/1/2', asof: 'Nov 9, 2026', rank: '#2', rank_cls: 'r2', stat: 'Fixture statistic 1', scope: 'Fixture · Last 29 days', value: '5,000', unit: '', subject: 'Fixture Card', sub: 'Fixture Fixture · Fixture Guild', render: null, subject_svg: '', top3: [1, 2, 3].map((r) => ({ rank: `#${r}`, name: `Fixture ${r}`, value: '1,000', cls: r === 2 ? 'me' : '' })), neighbours: [1, 2, 3].map((r) => ({ rank: `#${r}`, name: `Fixture ${r}`, value: '1,000', cls: r === 2 ? 'me' : '' })) },
  tier: { theme: 'forever', accent: 'c3', url: 'everstats.example/c/fixture-card/tier', asof: 'Nov 9, 2026', first: FIX, last: 'Card', meta: 'Level 60 · Fixture', faction: 'Horde', ruleset: FIX, tier: { letter: 'B', cls: 'b' }, pct: 'Top 40% on Fixture', next: { show: true, text: '4.2 score points to A', sub: 'A = top 20% of Fixture · score out of 100', w: 55 }, cats: Array.from({ length: 8 }, (_, i) => ({ name: `Fixture ${i + 1}`, L: 'C', cls: 'c' })), show: { cats: true } },
};

async function chromiumMemoryMb() {
  try {
    if (process.platform === 'win32') {
      const { stdout: out } = await run('tasklist', ['/fo', 'csv', '/nh'], { encoding: 'utf8' });
      const kb = out.split(/\r?\n/).filter((l) => /headless/i.test(l)).map((l) => Number(l.split('","').at(-1).replace(/[^0-9]/g, '')) || 0);
      return Math.round(kb.reduce((a, b) => a + b, 0) / 1024);
    }
    const { stdout: out } = await run('ps', ['-eo', 'rss=,args='], { encoding: 'utf8' });
    const kb = out.split('\n').filter((l) => /headless_shell|chrome-headless/i.test(l) && !/ps -eo/.test(l)).map((l) => Number(l.trim().split(/\s+/)[0]) || 0);
    return Math.round(kb.reduce((a, b) => a + b, 0) / 1024);
  } catch {
    return null;
  }
}

const stats5 = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return `min ${s[0]} · median ${s[Math.floor(s.length / 2)]} · max ${s.at(-1)} ms`;
};

const r = createCardRenderer({ maxConcurrent: () => 8, maxQueue: 64 });
try {
  const t0 = Date.now();
  await r.render({ type: 'tier', format: 'wide', layout: 'a', data: DATA.tier });
  console.log(`Cold start (Chromium launch + first card): ${Date.now() - t0} ms · Chromium memory ${await chromiumMemoryMb()} MB`);
  const one = [];
  for (const type of Object.keys(DATA)) {
    for (const format of ['square', 'story', 'wide']) {
      for (const layout of ['a', 'b']) {
        const { ms, png } = await r.render({ type, format, layout, data: DATA[type] });
        one.push(ms);
        console.log(`  ${type.padEnd(9)} ${format.padEnd(6)} ${layout}  ${String(ms).padStart(4)} ms  ${Math.round(png.length / 1024)} KB`);
      }
    }
  }
  console.log(`One at a time (${one.length} cards): ${stats5(one)}`);
  for (const n of [1, 2, 4]) {
    let peak = 0;
    let sampling = true;
    const sampler = (async () => { while (sampling) { peak = Math.max(peak, (await chromiumMemoryMb()) ?? 0); await new Promise((res) => setTimeout(res, 100)); } })();
    const t = Date.now();
    const jobs = Array.from({ length: n * 3 }, (_, i) => {
      const type = Object.keys(DATA)[i % 4];
      return r.render({ type, format: ['square', 'story', 'wide'][i % 3], layout: i % 2 ? 'b' : 'a', data: DATA[type] });
    });
    // Run in waves of n (the production cap is cards.maxConcurrent, default 2).
    const times = [];
    for (let k = 0; k < jobs.length; k += n) times.push(...(await Promise.all(jobs.slice(k, k + n))).map((x) => x.ms));
    sampling = false;
    await sampler;
    console.log(`${n} in parallel (${jobs.length} cards in ${Date.now() - t} ms): ${stats5(times)} · Chromium memory peak ${peak} MB`);
  }
} finally {
  await r.close();
}
