import { getSetting } from '../admin/settings.js';

/**
 * "Show Blizzard renders" (0.8.1, admin settings renders.show / renders.pausedNote). Blizzard's Forever render service
 * drew the wrong race for every character at the time (Undead → dwarf, Tauren → elf, Gnome → human) while Everstats'
 * URLs and data were right. Off: no render or avatar URL is sent anywhere (character pages, profiles, the card maker),
 * share cards and link previews use the crest version, and pages show the admin's note instead. On: as before.
 * → { paused: boolean, note: string }
 */
export async function renderSwitch(db) {
  const show = await getSetting(db, 'renders.show');
  return { paused: show === false, note: await getSetting(db, 'renders.pausedNote') };
}

export const RENDER_SETTING_KEYS = Object.freeze(['renders.show', 'renders.pausedNote']);
