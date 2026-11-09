import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isGraded, tierForRank } from '../stats/tiers.js';
import { characterSlug, parseSlug } from '../stats/slug.js';

test('tiers: S top 5 %, A next 15 %, B next 30 %, C next 30 %, D bottom 20 %', () => {
  const counts = { S: 0, A: 0, B: 0, C: 0, D: 0 };
  for (let rank = 1; rank <= 1000; rank++) counts[tierForRank(rank, 1000)] += 1;
  assert.deepEqual(counts, { S: 50, A: 150, B: 300, C: 300, D: 200 });
  assert.equal(tierForRank(1, 1), 'S');
  assert.equal(tierForRank(0, 10), null);
  assert.equal(tierForRank(11, 10), null);
});

test('a ruleset is graded only at the minimum population', () => {
  assert.equal(isGraded(499, 500), false);
  assert.equal(isGraded(500, 500), true);
  assert.equal(isGraded(null, 500), false);
});

test('character slugs: {name}-{surname}, lower case, accents kept', () => {
  assert.deepEqual(characterSlug(' Éowyn ', 'Stormward'), { ok: true, slug: 'éowyn-stormward' });
  assert.equal(characterSlug('Ab-c', 'D').ok, false);
  assert.equal(characterSlug('', 'D').ok, false);
  assert.deepEqual(parseSlug('%C3%A9owyn-stormward'), { name: 'éowyn', surname: 'stormward', slug: 'éowyn-stormward' });
  assert.equal(parseSlug('a-b-c'), null);
});
