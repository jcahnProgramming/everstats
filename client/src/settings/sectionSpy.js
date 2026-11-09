/**
 * Which settings section is "current" (SettingsPage.jsx SectionNav), as a pure function so the rule is tested alone.
 *
 *   tops      [{ id, top }] each section's top edge, in page order, relative to the viewport
 *   line      the reading line: just under the sticky bars, a little way into the page
 *   atBottom  the page is scrolled all the way down
 *
 * → the last section whose top has passed the line; at the very bottom, the last section (it can never reach the
 * line on a page that ends below it); above every section, the first. null when there are no sections.
 */
export function activeSection({ tops, line, atBottom = false }) {
  if (!tops.length) return null;
  if (atBottom) return tops.at(-1).id;
  let id = tops[0].id;
  for (const t of tops) if (t.top <= line) id = t.id;
  return id;
}
