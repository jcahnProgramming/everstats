// What counts toward tiers right now, and the real letter distribution per ruleset. Read-only: nothing is written.
//
//   docker exec everstats node server/tools/tiers-report.js            what counts (from the live Discovery decisions),
//                                                                       inconsistent decisions, and each ruleset's letters
//                                                                       from its last full grading
//   docker exec everstats node server/tools/tiers-report.js preview    the same letters computed now with the current
//                                                                       settings (what the admin preview shows)
//   docker exec everstats node server/tools/tiers-report.js weights    each category's weight now (0.8.0), and the letters
//                                                                       computed with equal weights vs these weights
//
// Prints counts, category labels and statistic ids only: no character names and no Blizzard values.
import { config } from '../core/config.js';
import { createDb } from '../core/db.js';
import { categoryWeights } from '../tiers/engine.js';
import { countingNow, previewTiers, tierSettings } from '../tiers/store.js';

const db = createDb({ url: config.databaseUrl, max: 2 });
try {
  const settings = await tierSettings(db);
  const { counts, plan } = await countingNow(db, { fresh: true });
  console.log(`Settings: shares ${JSON.stringify(settings.shares)} · ruleset minimum ${settings.minPopulation} · category ${settings.categoryHalf}% · overall ${settings.overallHalf}%`);
  console.log('\nWhat counts (category: counted [overall] / bad / name+number / duplicate / undecided):');
  for (const c of counts.categories) {
    const flag = c.inOverall ? 'counts toward overall' : c.farmable ? 'farmable: own letter only' : c.counted.length ? 'own letter only' : 'no graded stats yet';
    console.log(`  ${c.label.padEnd(20)} ${String(c.counted.length).padStart(3)} [${c.overall.length}] / ${c.bad.length} / ${c.named.length} / ${c.duplicate.length} / ${c.undecided.length}   ${flag}`);
  }
  console.log(`\nInconsistent decisions: ${counts.issues.length}`);
  for (const i of counts.issues) console.log(`  id ${i.statisticId} (${i.category}): ${i.problem}`);
  const names = new Map((await db.query('SELECT id, name FROM rulesets LIMIT 100')).map((r) => [r.id, r.name]));
  if (process.argv[2] === 'weights') {
    const pct = (x) => `${(x * 100).toFixed(1)}%`;
    console.log('\nCategory weights now (statistics counting toward overall → square-root formula → weight used):');
    for (const w of categoryWeights(plan, settings)) {
      console.log(`  ${w.label.padEnd(20)} ${String(w.statistics).padStart(3)}  formula ${pct(w.formula).padStart(6)}  weight ${pct(w.weight).padStart(6)}${w.pinned !== null ? '  (pinned)' : ''}`);
    }
    const equal = await previewTiers(db, { ...settings, weighting: undefined, weights: {} });
    const weighted = await previewTiers(db, settings);
    console.log('\nOverall letters: equal weights → these weights (computed now, nothing saved):');
    for (const r of weighted.rulesets) {
      const e = equal.rulesets.find((x) => x.id === r.id);
      if (!r.graded) { console.log(`  ${String(r.name ?? r.id).padEnd(12)} ${r.population} eligible · below the minimum`); continue; }
      const cells = ['S', 'A', 'B', 'C', 'D', 'unranked'].map((l) => `${l} ${e.overall[l]}→${r.overall[l]}`).join(' · ');
      console.log(`  ${String(r.name ?? r.id).padEnd(12)} ${r.population} eligible · ${cells}`);
    }
  } else if (process.argv[2] === 'preview') {
    const p = await previewTiers(db, settings);
    console.log(`\nLetters computed now (${p.ms} ms, nothing saved):`);
    for (const r of p.rulesets) console.log(`  ${(r.name ?? r.id).toString().padEnd(12)} ${r.population} eligible · ${r.graded ? JSON.stringify(r.overall) : 'below the minimum'}`);
  } else {
    const run = await db.one("SELECT finished_at, summary FROM tier_runs WHERE status = 'done' ORDER BY finished_at DESC LIMIT 1");
    console.log(`\nLast full grading: ${run ? run.finished_at.toISOString() : 'none yet'}`);
    for (const r of run?.summary?.rulesets ?? []) console.log(`  ${(names.get(r.rulesetId) ?? r.rulesetId).toString().padEnd(12)} ${r.population} eligible · ${r.graded ? JSON.stringify(r.overall) : 'below the minimum'}`);
  }
} finally {
  await db.close();
}
