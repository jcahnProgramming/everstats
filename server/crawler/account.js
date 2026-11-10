import { config } from '../core/config.js';
import { blizzardContext, enabledVersions, versionById } from '../core/gameVersions.js';
import { SourceError } from '../sources/blizzard.js';
import { openSource } from '../sources/registry.js';
import { MIN_TRACKED_LEVEL, crawlKey } from './fetch.js';
import { parseAccountCharacters } from './parse.js';
import { PRIORITY, enqueue } from './queue.js';
import { countRequests } from './stats.js';
import { upsertKnown } from './store.js';

/**
 * Auto-fetch at sign-in: with the user token a Battle.net sign-in (or link, or "Refresh my characters") just
 * received, read /profile/user/wow, record every character on the account as owned by this Everstats account, and
 * queue the level-10+ ones for a full fetch at auto-fetch priority. The token is used for these requests and dropped:
 * it is never stored, logged or handed to the worker. (The web process's only own Blizzard calls; counted in the
 * crawler's hourly totals with everything else.)
 *
 * 0.10.0: read once per ENABLED game version in the configured region, each in that version's profile namespace
 * (Blizzard lists a game's characters per namespace). A version that isn't enabled is never read here: only the
 * Discovery probe reads those, and stores nothing of them.
 *
 * Every outcome is recorded (account_character_checks), so the dashboard can tell "no characters on this account" from
 * "we couldn't check".
 *   → { outcome: 'ok' | 'none' | 'error', characters, queued } (summed over versions; error only if every version failed)
 */
export async function importAccountCharacters({ db, accountId, providerId, userToken, fetch = globalThis.fetch }) {
  const results = [];
  for (const v of enabledVersions()) {
    if (!v.regions.includes(config.region)) continue;
    results.push(await importVersion({ db, accountId, providerId, userToken, fetch, scope: { version: v.id, region: config.region } }));
  }
  if (results.length === 1) return results[0];
  const ok = results.filter((r) => r.outcome === 'ok');
  return {
    outcome: ok.length ? 'ok' : results.every((r) => r.outcome === 'error') ? 'error' : 'none',
    characters: results.reduce((n, r) => n + (r.characters ?? 0), 0),
    queued: results.reduce((n, r) => n + (r.queued ?? 0), 0),
    versions: results,
  };
}

async function importVersion({ db, accountId, providerId, userToken, fetch, scope }) {
  const ctx = blizzardContext(scope.version, scope.region);
  const label = `${ctx.version}`;
  let r;
  try {
    const source = await openSource(db, 'blizzard', { fetch, maxAttempts: 1, perSecond: 100, region: scope.region });
    r = await source.get(ctx.paths.accountCharacters, { namespace: ctx.namespaces.profile, auth: 'user', userToken });
  } catch (err) {
    const detail = err instanceof SourceError ? err.code : (err?.code ?? err?.name ?? 'error');
    return record(db, accountId, providerId, 'error', null, `not read (${detail})`);
  }
  await countRequests(db, { requests: 1, errors: r.status === 200 || r.status === 404 ? 0 : 1, throttled: r.status === 429 ? 1 : 0 }).catch(() => {});
  // Blizzard answers 404 for a Battle.net account with no characters in this game.
  const none = `no ${versionName(scope.version)} characters on this Battle.net account`;
  if (r.status === 404) return record(db, accountId, providerId, 'none', 0, none);
  if (r.status !== 200 || !r.json) return record(db, accountId, providerId, 'error', null, r.status === null ? `no answer (${r.error ?? 'error'})` : `HTTP ${r.status}`);

  const list = parseAccountCharacters(r.json, { realms: ctx.realms });
  if (!list.length) return record(db, accountId, providerId, 'none', 0, none);
  let queued = 0;
  const tracked = [];
  await db.tx(async (q) => {
    for (const c of list) {
      const row = await upsertKnown(q, c, { source: 'account', ownerAccountId: accountId, scope });
      tracked.push({ ...c, localId: Number(row.id) });
      if (Number.isInteger(c.level) && c.level >= MIN_TRACKED_LEVEL) {
        await enqueue(q, { key: crawlKey(c), priority: PRIORITY.auto, mode: 'full', accountId, ...scope });
        queued += 1;
      }
    }
  });
  const result = await record(db, accountId, providerId, 'ok', list.length, null, queued);
  // 0.9.0: collections at sign-in priority (collections/fetch.js), and opt-in gold: the protected-character data is
  // read NOW, with this same token, because it answers only to the owner's token and the token is never kept.
  try {
    const { queueCollections } = await import('../collections/fetch.js');
    for (const c of list) if (Number.isInteger(c.level) && c.level >= MIN_TRACKED_LEVEL) await queueCollections(db, c, PRIORITY.auto, scope);
    const { importGold, protectedPath } = await import('../collections/gold.js');
    const source = await openSource(db, 'blizzard', { fetch, maxAttempts: 1, perSecond: 20, region: scope.region });
    result.gold = await importGold({
      db, accountId, source, userToken, namespace: ctx.namespaces.profile,
      characters: tracked.map((c) => ({ id: c.localId, blizzardId: c.id, protectedPath: protectedPath(c.protectedHref) })),
    });
  } catch (err) {
    console.error(`[collections] after sign-in (${label}): ${err.code ?? err.name}`);
  }
  // 0.7.1 Activity: characters looked up because their owner signed in (a count, nothing else).
  const { countActivity } = await import('../activity/count.js');
  countActivity(db, 'character.signin', queued);
  // 0.7.0: badges from the list Battle.net just gave (class, faction and level are on it), and Guild Master control of
  // any guild whose rank-0 character this account now owns. Neither can fail the sign-in.
  try {
    const { evaluateQuietly } = await import('../badges/rules.js');
    await evaluateQuietly(db, accountId);
    const { syncGuildsOwnedBy } = await import('../guilds/manage.js');
    await syncGuildsOwnedBy(db, accountId);
  } catch (err) {
    console.error(`[badges] after sign-in: ${err.code ?? err.name}`);
  }
  return result;
}

// The registry's short name: "no Forever characters on this Battle.net account", word for word as before 0.10.0.
const versionName = (id) => versionById(id)?.short ?? id;

async function record(db, accountId, providerId, outcome, characters, detail, queued = 0) {
  await db.query(
    'INSERT INTO account_character_checks (account_id, provider, outcome, characters, detail) VALUES ($1, $2, $3, $4, $5)',
    [accountId, providerId, outcome, characters, detail ? String(detail).slice(0, 200) : null],
  );
  if (outcome === 'error') console.warn(`[characters] couldn't read a Battle.net account's characters: ${detail}`);
  return { outcome, characters, queued };
}
