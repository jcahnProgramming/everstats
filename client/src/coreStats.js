/**
 * Core stats grouped like the in-game character sheet (0.4.2). Built from the field names Forever's
 * /profile/wow/character/{slug}/statistics really returns (discovery runs 1–2): only the stats Blizzard sent are
 * shown, a group with none is hidden, and anything not listed here goes to "Other", never dropped.
 *
 * Zeros: shown in Base, Health & power, Defense and Resistances (a resistance of 0 is a real number on the sheet);
 * left out elsewhere, where Forever's response carries fields its era doesn't use (mastery, versatility, lifesteal,
 * avoidance, haste ratings), always 0. Damage min / max pairs are shown as one "25.5 – 34.5" line.
 */
export const CORE_GROUPS = [
  { id: 'base', label: 'Base', keys: ['strength', 'agility', 'stamina', 'intellect', 'spirit'], zeros: true },
  { id: 'health', label: 'Health & power', keys: ['health', 'power'], zeros: true },
  {
    id: 'melee', label: 'Melee',
    keys: ['attack_power', 'main_hand_damage', 'main_hand_speed', 'main_hand_dps', 'off_hand_damage', 'off_hand_speed', 'off_hand_dps',
      'melee_crit', 'melee_hit', 'off_hand_hit', 'melee_haste', 'expertise', 'off_hand_expertise', 'armor_penetration'],
  },
  { id: 'ranged', label: 'Ranged', keys: ['ranged_attack_power', 'ranged_damage', 'ranged_crit', 'ranged_hit', 'ranged_haste'] },
  { id: 'spell', label: 'Spell', keys: ['spell_power', 'spell_healing', 'spell_crit', 'spell_hit', 'spell_haste', 'spell_penetration', 'mana_regen', 'mana_regen_combat'] },
  { id: 'defense', label: 'Defense', keys: ['armor', 'defense', 'dodge', 'parry', 'block', 'bonus_armor'], zeros: true },
  { id: 'resist', label: 'Resistances', keys: ['arcane_resistance', 'fire_resistance', 'frost_resistance', 'nature_resistance', 'shadow_resistance'], zeros: true },
  { id: 'other', label: 'Other', keys: [] },
];

const LABELS = {
  main_hand_damage: 'Main hand damage', off_hand_damage: 'Off hand damage', ranged_damage: 'Ranged damage',
  main_hand_dps: 'Main hand DPS', off_hand_dps: 'Off hand DPS', mana_regen: 'Mana regen (5 s)', mana_regen_combat: 'Mana regen in combat',
  arcane_resistance: 'Arcane', fire_resistance: 'Fire', frost_resistance: 'Frost', nature_resistance: 'Nature', shadow_resistance: 'Shadow',
};

const fmt = (v) => (Number.isInteger(v) ? v.toLocaleString('en-US') : v.toLocaleString('en-US', { maximumFractionDigits: 2 }));

/** attributes (crawler/parse.js parseAttributes) → [{ id, label, rows: [{ key, label, value }] }], empty groups out. */
export function groupCoreStats(attributes) {
  const byKey = new Map((attributes ?? []).map((a) => [a.key, a]));
  // Fold min / max pairs into one row.
  for (const base of ['main_hand_damage', 'off_hand_damage', 'ranged_damage']) {
    const lo = byKey.get(`${base}_min`);
    const hi = byKey.get(`${base}_max`);
    if (lo && hi) {
      byKey.delete(`${base}_min`);
      byKey.delete(`${base}_max`);
      byKey.set(base, { key: base, label: LABELS[base], text: `${fmt(lo.value)} – ${fmt(hi.value)}`, value: hi.value });
    }
  }
  const placed = new Set();
  const groups = CORE_GROUPS.map((g) => {
    const keys = g.id === 'other' ? [...byKey.keys()].filter((k) => !placed.has(k)) : g.keys.filter((k) => byKey.has(k));
    const rows = [];
    for (const k of keys) {
      placed.add(k);
      const a = byKey.get(k);
      if (a.value === 0 && !g.zeros) continue;
      rows.push({ key: k, label: LABELS[k] ?? a.label, value: a.text ?? `${fmt(a.value)}${a.percent ? '%' : ''}` });
    }
    return { id: g.id, label: g.label, rows };
  });
  return groups.filter((g) => g.rows.length);
}
