// Collections request cost (0.9.0), measured against Blizzard's real API with the configured keys: one character's
// collections refresh (every endpoint the registry asks for it: count, status, bytes), then what the catalogs have cost
// so far (collection_catalog_state counts every catalog request and its bytes as it happens) and the tracked count.
// Read-only: it stores nothing it fetches, logs no body, and goes through the same source the crawler uses.
//
//   docker exec everstats-worker node server/tools/measure-collections.js <name-surname>
import { BLIZZARD_API } from '../core/config.js';
import { createDb } from '../core/db.js';
import { config } from '../core/config.js';
import { openSource } from '../sources/registry.js';
import { catalogStatus, catalogTotals } from '../collections/catalog.js';
import { KINDS } from '../collections/registry.js';
import { characterPath } from '../crawler/fetch.js';

const slug = String(process.argv[2] ?? '').toLowerCase();
if (!/^[^-\s]+-[^-\s]+$/.test(slug)) {
  console.error('usage: node server/tools/measure-collections.js <name-surname>');
  process.exit(2);
}
const db = createDb({ url: config.databaseUrl, max: 2 });
try {
  const source = await openSource(db, 'blizzard', { perSecond: 5, maxAttempts: 2 });
  const prof = await source.get(characterPath(slug), { namespace: BLIZZARD_API.namespaces.profile });
  if (prof.status !== 200) throw new Error(`profile answered ${prof.status}`);
  const cls = prof.json?.character_class?.name ?? null;
  const totals = await catalogTotals(db);
  const kinds = KINDS.filter((k) => !k.when || k.when({ character: { class: cls }, catalogTotals: totals }));
  let bytes = 0;
  console.log(`Collections refresh for ${slug} (${cls ?? 'class unknown'}): ${kinds.length} requests`);
  for (const k of kinds) {
    const r = await source.get(`${characterPath(slug)}${k.path}`, { namespace: BLIZZARD_API.namespaces.profile });
    bytes += r.bytes ?? 0;
    console.log(`  ${k.id.padEnd(18)} ${String(r.status).padEnd(4)} ${String(r.bytes ?? 0).padStart(8)} bytes  ${r.latencyMs} ms`);
  }
  console.log(`  total              ${kinds.length} requests, ${bytes} bytes (${Math.round(bytes / 1024)} KB)`);
  console.log('\nCatalogs (measured as they were fetched):');
  let req = 0;
  let b = 0;
  for (const c of await catalogStatus(db)) {
    if (c.kind === 'namespace') continue;
    req += c.requests;
    b += c.bytes;
    console.log(`  ${c.label.padEnd(30)} ${String(c.state).padEnd(9)} ${String(c.total ?? '-').padStart(6)} entries  ${String(c.requests).padStart(6)} requests  ${Math.round(c.bytes / 1024)} KB`);
  }
  console.log(`  total                          ${req} requests, ${Math.round(b / 1024)} KB per full catalog refresh (every 14 days)`);
  const t = await db.one("SELECT count(*)::int AS n FROM characters WHERE profile_state = 'ok' AND level >= 10 AND stats_fetched_at IS NOT NULL");
  console.log(`\nTracked level 10+ characters: ${t.n}. Weekly refreshes ≈ ${Math.round((t.n * kinds.length) / 7)} requests a day (tracked × ${kinds.length} ÷ 7), plus sign-ins and tab opens.`);
} catch (err) {
  console.error(`failed: ${err.message ?? err.name}`);
  process.exitCode = 1;
} finally {
  await db.close();
}
