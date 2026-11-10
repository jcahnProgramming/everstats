/**
 * A statistic's name as pages show it (0.9.2). DISPLAY ONLY: the stored name stays exactly Blizzard's.
 *
 * Blizzard's own names mix "Kills" and "kills" inside a name ("Rath'mael Kills (Ruins of Lordaeron)" beside "Aku'mai
 * kills (Blackfathom Deeps)"), which reads like two different kinds of board. Only that pattern, a boss's kills in an
 * instance ("<boss> Kills (<instance>)"), is shown as "kills"; title-case names like "Total Honorable Kills" are
 * untouched. Shared by the client and the server (link-preview titles), so a name reads the same everywhere.
 */
export function displayName(name) {
  if (typeof name !== 'string') return name;
  return name.replace(/(\S\s+)Kills(\s+\()/g, '$1kills$2');
}
