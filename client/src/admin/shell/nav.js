/**
 * The admin's navigation and page registry (0.10.3, design/v5-admin README "Navigation"). The sidebar, the phone menu,
 * the page titles, which pages follow the version switcher and the old-address redirects all come from here: add a
 * page here, never in the shell.
 *
 *   NAV       sidebar items in order: { id, label, icon, to, group, count (key in /api/admin/shell counts),
 *             match (path prefixes that light this item up), moderator (what a moderator would see) }
 *   PAGES     every admin address: { path (react-router pattern), title, scope ('version' = follows ?v=&r=,
 *             'global' = the dashed "All versions" pill), nav (which NAV item it belongs to) }
 *   REDIRECTS old addresses (0.4.0–0.10.2) → their new homes, so bookmarks and links in old notifications keep working
 */
export const NAV = Object.freeze([
  { id: 'dashboard', label: 'Dashboard', icon: 'dashboard', to: '/admin', group: null, exact: true },
  { id: 'inbox', label: 'Inbox', icon: 'inbox', to: '/admin/inbox/feedback', group: 'Moderation', count: 'inbox', match: ['/admin/inbox'], moderator: 'reports' },
  { id: 'directory', label: 'Directory', icon: 'directory', to: '/admin/directory/accounts', group: 'Moderation', match: ['/admin/directory'], moderator: 'accounts' },
  { id: 'badges', label: 'Badges', icon: 'badge', to: '/admin/badges/player', group: 'Moderation', match: ['/admin/badges'] },
  { id: 'tiers', label: 'Tiers', icon: 'tiers', to: '/admin/tiers', group: 'Game data', match: ['/admin/tiers'] },
  { id: 'discovery', label: 'Discovery', icon: 'discovery', to: '/admin/discovery/approvals', group: 'Game data', count: 'discovery', match: ['/admin/discovery'] },
  { id: 'data', label: 'Data', icon: 'data', to: '/admin/data/crawler', group: 'Game data', count: 'data', match: ['/admin/data'] },
  { id: 'retention', label: 'Data retention', icon: 'retention', to: '/admin/retention', group: 'Game data', count: 'retention', match: ['/admin/retention'] },
  { id: 'features', label: 'Features', icon: 'features', to: '/admin/features', group: 'Site', match: ['/admin/features'] },
  { id: 'settings', label: 'Settings', icon: 'settings', to: '/admin/settings', group: 'Site', match: ['/admin/settings'] },
  { id: 'audit', label: 'Audit log', icon: 'audit', to: '/admin/audit', group: 'Site', match: ['/admin/audit'], moderator: 'own' },
  // Not in the v5 design (it predates it): built from the design's own components, under Site.
  { id: 'release', label: 'Release tools', icon: 'flags', to: '/admin/release', group: 'Site', match: ['/admin/release'] },
]);

export const PAGES = Object.freeze([
  { path: '/admin', title: 'Dashboard', scope: 'version', nav: 'dashboard' },
  { path: '/admin/inbox/feedback', title: 'Inbox', scope: 'global', nav: 'inbox' },
  { path: '/admin/inbox/feedback/:id', title: 'Inbox', scope: 'global', nav: 'inbox' },
  { path: '/admin/inbox/reports', title: 'Inbox', scope: 'global', nav: 'inbox' },
  { path: '/admin/directory/accounts', title: 'Directory', scope: 'global', nav: 'directory' },
  { path: '/admin/directory/accounts/reserved', title: 'Reserved usernames', scope: 'global', nav: 'directory' },
  { path: '/admin/directory/accounts/:id', title: 'Account', scope: 'global', nav: 'directory' },
  { path: '/admin/directory/characters', title: 'Directory', scope: 'version', nav: 'directory' },
  { path: '/admin/directory/guilds', title: 'Directory', scope: 'version', nav: 'directory' },
  { path: '/admin/directory/guilds/links', title: 'Guild links', scope: 'global', nav: 'directory' },
  { path: '/admin/directory/guilds/:id/links', title: 'Guild links', scope: 'global', nav: 'directory' },
  { path: '/admin/badges/player', title: 'Badges', scope: 'global', nav: 'badges' },
  { path: '/admin/badges/guild', title: 'Badges', scope: 'global', nav: 'badges' },
  { path: '/admin/tiers', title: 'Tiers', scope: 'version', nav: 'tiers' },
  { path: '/admin/discovery/approvals', title: 'Discovery', scope: 'version', nav: 'discovery' },
  { path: '/admin/discovery/runs', title: 'Discovery', scope: 'version', nav: 'discovery' },
  { path: '/admin/discovery/probe', title: 'Discovery', scope: 'version', nav: 'discovery' },
  { path: '/admin/data/crawler', title: 'Data', scope: 'version', nav: 'data' },
  { path: '/admin/data/collections', title: 'Data', scope: 'version', nav: 'data' },
  { path: '/admin/data/backups', title: 'Data', scope: 'global', nav: 'data' },
  { path: '/admin/retention', title: 'Data retention', scope: 'version', nav: 'retention' },
  { path: '/admin/features', title: 'Features', scope: 'global', nav: 'features' },
  { path: '/admin/settings', title: 'Settings', scope: 'global', nav: 'settings' },
  { path: '/admin/audit', title: 'Audit log', scope: 'global', nav: 'audit' },
  { path: '/admin/release', title: 'Release tools', scope: 'version', nav: 'release' },
]);

/** Old admin addresses → new ones. `:id` carries over. The query string (e.g. Discovery's ?stat=) is kept. */
export const REDIRECTS = Object.freeze([
  { from: '/admin/discovery', to: '/admin/discovery/approvals' },
  { from: '/admin/feedback', to: '/admin/inbox/feedback' },
  { from: '/admin/reports', to: '/admin/inbox/reports' },
  { from: '/admin/accounts', to: '/admin/directory/accounts' },
  { from: '/admin/accounts/:id', to: '/admin/directory/accounts/:id' },
  { from: '/admin/badges', to: '/admin/badges/player' },
  { from: '/admin/guild-badges', to: '/admin/badges/guild' },
  { from: '/admin/guild-links', to: '/admin/directory/guilds/links' },
  { from: '/admin/inbox', to: '/admin/inbox/feedback' },
  { from: '/admin/directory', to: '/admin/directory/accounts' },
  { from: '/admin/data', to: '/admin/data/crawler' },
  { from: '/admin/reserved', to: '/admin/directory/accounts/reserved' },
]);

const toRegex = (pattern) => new RegExp(`^${pattern.replace(/:[a-z]+/g, '[^/]+')}/?$`);
const compiled = PAGES.map((p) => ({ ...p, re: toRegex(p.path) }));

/** The page entry for a pathname (most specific first: a literal segment beats a :param). */
export function pageFor(pathname) {
  const hits = compiled.filter((p) => p.re.test(pathname));
  const params = (p) => p.path.match(/:/g)?.length ?? 0;
  hits.sort((a, b) => params(a) - params(b));
  return hits[0] ?? null;
}

/** Is this nav item the current one? */
export function navActive(item, pathname) {
  if (item.exact) return pathname === item.to || pathname === `${item.to}/`;
  return (item.match ?? [item.to]).some((m) => pathname === m || pathname.startsWith(`${m}/`));
}
