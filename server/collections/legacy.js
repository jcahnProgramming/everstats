/**
 * Legacy Points (0.9.0). The 0.8.3 probe found no Legacy endpoint (every guessed path 404s), but Forever's achievement
 * catalog names them in `reward_description`, e.g. "Earn 1 Legacy Point." (achievement 62041, "Rank 3"). So a
 * character's Legacy Points are the sum of N over the achievements it has EARNED whose reward text says exactly
 * "Earn N Legacy Point" or "Earn N Legacy Points" (an optional full stop after it). Nothing else is counted: a reward
 * that mentions "Legacy" any other way is reported by legacyPatterns() for the owner to look at, never guessed at.
 */
export const LEGACY_RE = /^Earn (\d{1,6}) Legacy Points?\.?$/;

/** The points a reward text grants, or null when it isn't exactly the pattern. */
export function legacyPointsOf(reward) {
  if (typeof reward !== 'string') return null;
  const m = LEGACY_RE.exec(reward.trim());
  return m ? Number(m[1]) : null;
}

/**
 * Every reward text in the achievement catalog, sorted into: counted (the exact pattern) and mentionsLegacy (contains
 * "legacy" but isn't the pattern: NOT counted). → { counted: [{ text, achievements }], uncounted: [{ text, achievements }],
 * otherRewards: n }
 */
export function legacyPatterns(achievements) {
  const counted = new Map();
  const uncounted = new Map();
  let other = 0;
  for (const a of achievements) {
    const r = typeof a.reward === 'string' ? a.reward.trim() : '';
    if (!r) continue;
    const bucket = legacyPointsOf(r) !== null ? counted : /legacy/i.test(r) ? uncounted : null;
    if (!bucket) {
      other += 1;
      continue;
    }
    const key = r.replace(/\d+/, 'N');
    if (!bucket.has(key)) bucket.set(key, { text: key, achievements: 0 });
    bucket.get(key).achievements += 1;
  }
  return { counted: [...counted.values()], uncounted: [...uncounted.values()], otherRewards: other };
}

/**
 * A character's Legacy Points from its earned achievements and the catalog (Map id → { reward, accountWide, name }).
 * → { points, earning: [{ id, name, points, completedAt, accountWide }], accountWide: true | false | null }
 *   accountWide: true when every Legacy-granting achievement in the catalog says is_account_wide, false when any says
 *   it isn't, null when the catalog has none (nothing to say).
 */
export function legacyOf(earned, catalog) {
  const earning = [];
  for (const a of earned) {
    if (!a.completedAt) continue;
    const c = catalog.get(a.id);
    const pts = legacyPointsOf(c?.reward);
    if (pts === null) continue;
    earning.push({ id: a.id, name: c.name ?? a.name, points: pts, completedAt: a.completedAt, accountWide: c.accountWide ?? null });
  }
  return { points: earning.reduce((n, e) => n + e.points, 0), earning: earning.sort((x, y) => (y.completedAt ?? '').localeCompare(x.completedAt ?? '')) };
}

export function legacyAccountWide(catalog) {
  const granting = [...catalog.values()].filter((c) => legacyPointsOf(c.reward) !== null);
  if (!granting.length) return null;
  if (granting.every((c) => c.accountWide === true)) return true;
  if (granting.some((c) => c.accountWide === false)) return false;
  return null;
}
