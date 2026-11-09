import assert from 'node:assert/strict';
import { test } from 'node:test';
import { groupCoreStats } from '../../client/src/coreStats.js';

// The live character the bug was found on (0.4.2): a two-hander and a ranged weapon, NO off-hand, and Blizzard still
// sends off-hand weapon numbers (the bare-hand placeholder). Shapes copied from the live API, values as it sent them.
const attributes = [
  ['main_hand_damage_min', 45.14], ['main_hand_damage_max', 64.14], ['main_hand_speed', 2.9], ['main_hand_dps', 18.84],
  ['off_hand_damage_min', 1.93], ['off_hand_damage_max', 1.93], ['off_hand_speed', 2], ['off_hand_dps', 0.96],
  ['ranged_damage_min', 14], ['ranged_damage_max', 28], ['ranged_crit', 4.85], ['attack_power', 120],
].map(([key, value]) => ({ key, label: key, value, percent: false }));
const weapon = (slot) => ({ slot, tooltip: { weapon: { damage: 'x', speed: 'y', dps: 'z' } } });
const keysOf = (groups) => groups.flatMap((g) => g.rows.map((r) => r.key));

test('core stats: an empty off-hand shows no off-hand weapon numbers; filled weapon slots keep theirs', () => {
  const keys = keysOf(groupCoreStats(attributes, [weapon('MAIN_HAND'), weapon('RANGED'), { slot: 'HEAD', tooltip: {} }]));
  assert.ok(keys.includes('main_hand_damage') && keys.includes('main_hand_dps'));
  assert.ok(keys.includes('ranged_damage'));
  assert.ok(!keys.some((k) => k.startsWith('off_hand')), keys.join(', '));
  assert.ok(keys.includes('ranged_crit') && keys.includes('attack_power'), 'ratings are not weapon-slot numbers');
});

test('core stats: a shield in the off hand has no weapon stats either; nothing ranged equipped hides ranged damage', () => {
  const keys = keysOf(groupCoreStats(attributes, [weapon('MAIN_HAND'), { slot: 'OFF_HAND', tooltip: { armor: '1,200 Armor' } }]));
  assert.ok(!keys.some((k) => k.startsWith('off_hand')));
  assert.ok(!keys.includes('ranged_damage'));
});

test('core stats: equipment unknown (never fetched) hides nothing, since we can’t tell', () => {
  const keys = keysOf(groupCoreStats(attributes, null));
  assert.ok(keys.includes('off_hand_damage') && keys.includes('ranged_damage'));
});

test('settings highlight: the section in view, the first on load, the last at the bottom of the page', async () => {
  const { activeSection } = await import('../../client/src/settings/sectionSpy.js');
  const ids = ['profile', 'appearance', 'signin', 'twofa', 'characters', 'merge', 'delete'];
  const at = (...tops) => ids.map((id, i) => ({ id, top: tops[i] }));
  // First load, Profile's top just under the bar, Appearance further down (0.4.2 lit Appearance here).
  assert.equal(activeSection({ tops: at(120, 700, 1200, 1600, 2000, 2600, 3000), line: 260 }), 'profile');
  // Scrolled to Characters: everything above has passed the line.
  assert.equal(activeSection({ tops: at(-1800, -1200, -700, -300, 100, 700, 1100), line: 260 }), 'characters');
  // Scrolled to the bottom: Delete account (its top never reaches the line on a page that ends below it).
  assert.equal(activeSection({ tops: at(-2400, -1800, -1300, -900, -500, 120, 480), line: 260, atBottom: true }), 'delete');
  assert.equal(activeSection({ tops: [], line: 0 }), null);
});
