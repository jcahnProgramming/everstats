import assert from 'node:assert/strict';
import { test } from 'node:test';
import './helpers.js';

// 0.9.2: page titles, display names and the fill-grid spans (pure functions; no database).
test('every page has its own title: fixed ones from one table, unknown paths say Not found', async () => {
  const { pageTitleFor, fullTitle } = await import('../core/pageTitles.js');
  assert.equal(fullTitle(pageTitleFor('/leaderboards')), 'Leaderboards · Everstats');
  assert.equal(fullTitle(pageTitleFor('/settings')), 'Settings · Everstats');
  assert.equal(fullTitle(pageTitleFor('/tiers/how')), 'How tiers work · Everstats');
  assert.equal(fullTitle(pageTitleFor('/tiers')), 'Tier boards · Everstats');
  assert.equal(fullTitle(pageTitleFor('/')), 'Everstats');
  assert.equal(pageTitleFor('/c/path-vexley/collections/transmog'), 'Collections');
  assert.equal(pageTitleFor('/c/path-vexley/collections/share'), 'Share card');
  assert.equal(pageTitleFor('/leaderboards/2/60'), 'Leaderboard');
  assert.equal(pageTitleFor('/no/such/page'), undefined);
  // 0.11.1: a game version's pages, under its prefix, a character and a guild as realm + name.
  assert.equal(pageTitleFor('/retail/us/leaderboards'), 'Leaderboards');
  assert.equal(pageTitleFor('/retail/us/c/area-52/thrall'), 'Character');
  assert.equal(pageTitleFor('/retail/us/c/area-52/thrall/collections/mounts'), 'Collections');
  assert.equal(pageTitleFor('/retail/us/g/hyjal/fixture-guild/boards/7'), 'Guild members board');
  assert.equal(pageTitleFor('/retail/us/settings'), undefined, 'only version pages live under a version prefix');
  // The server writes the same title into the HTML for a page without a card preview.
  const { linkPreviewFor } = await import('../cards/meta.js');
  assert.equal((await linkPreviewFor(null, '/leaderboards', {})).title, 'Leaderboards');
  assert.equal((await linkPreviewFor(null, '/no/such/page', {})).title, 'Everstats');
});

test('board names read alike: a boss\'s "Kills (Instance)" is shown as "kills"; title-case names are untouched', async () => {
  const { displayName } = await import('../stats/names.js');
  assert.equal(displayName("Rath'mael Kills (Ruins of Lordaeron)"), "Rath'mael kills (Ruins of Lordaeron)");
  assert.equal(displayName("Aku'mai kills (Blackfathom Deeps)"), "Aku'mai kills (Blackfathom Deeps)");
  assert.equal(displayName('Total Honorable Kills'), 'Total Honorable Kills');
  assert.equal(displayName('Killing Blows'), 'Killing Blows');
  assert.equal(displayName(null), null);
});

test('fill grids: never more columns than items, so one item is full width (the last row grows in CSS)', async () => {
  const { fillCols, fillStyle } = await import('../../client/src/components/fillGrid.js');
  assert.equal(fillCols(1, 3), 1);
  assert.equal(fillCols(2, 3), 2);
  assert.equal(fillCols(10, 3), 3);
  assert.equal(fillCols(0, 3), 1);
  assert.deepEqual(fillStyle(9, { lg: 5, md: 3, sm: 2 }), { '--fg-lg': 5, '--fg-md': 3, '--fg-sm': 2 });
  assert.deepEqual(fillStyle(1, { lg: 3, md: 2, sm: 1 }), { '--fg-lg': 1, '--fg-md': 1, '--fg-sm': 1 });
});
