#!/usr/bin/env node
/**
 * The release step (0.10.2, RELEASING.md). Run on the `dev` branch when dev has been good for a while and is ready to
 * become production:
 *
 *   node scripts/release.js             make the release entry, then print the git steps to promote dev → main
 *   node scripts/release.js --dry-run   show the entry it would make, change nothing
 *   node scripts/release.js --title "…" the release's title (default: the dev builds' titles)
 *   node scripts/release.js --version 1.0.0
 *                                       a different release number (only a .0 above production's; for 1.0.0)
 *   node scripts/release.js next        print the version the next dev build should use, change nothing
 *
 * What it does to CHANGELOG.json (the only file it touches):
 *   1. Takes every dev build ("kind": "dev", "In testing") since the last release.
 *   2. Makes ONE release entry: the next minor after production's newest version (0.10.2 → 0.11.0), dated today, its
 *      lines rolled up from those builds (newest first, each line once) under the usual section names: New (added),
 *      Improved (changed), Fixed, Removed.
 *   3. Keeps the dev builds underneath it in `tested` ("Tested as 0.10.3–0.10.5" on the dev site's changelog).
 *   4. Checks the result as production's build will (CHANGELOG_TARGET=production).
 * The newest entry is the app's version, so that is also the version change. Nothing is committed or pushed: it prints
 * the steps, one at a time, PowerShell-safe.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FILE = process.env.CHANGELOG_FILE ? resolve(process.env.CHANGELOG_FILE) : resolve(ROOT, 'CHANGELOG.json');
const SECTION_ORDER = ['New', 'Improved', 'Fixed', 'Removed'];

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const stop = (message) => {
  console.error(`\nrelease: ${message}\n`);
  process.exit(1);
};

const compare = (a, b) => {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] - pb[i];
  return 0;
};

/** Today as the person running this sees it (their local calendar date). */
function localToday(now = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function git(...a) {
  try {
    return execFileSync('git', a, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
}

const doc = JSON.parse(readFileSync(FILE, 'utf8'));
const entries = doc.releases;
const devBuilds = entries.filter((e) => e.kind === 'dev');
const production = entries.filter((e) => e.kind !== 'dev');
const productionNewest = production[0];
if (!productionNewest) stop('CHANGELOG.json has no production release to build on');

const [maj, min] = productionNewest.version.split('.').map(Number);

if (args[0] === 'next') {
  // The next dev build: one patch above the newest entry, whatever it is (0.10.2 → 0.10.3, 0.11.0 → 0.11.1, a hotfix
  // 0.11.1 → 0.11.2, a dev build 0.10.3 → 0.10.4).
  const [a, b, c] = entries[0].version.split('.').map(Number);
  console.log(`${a}.${b}.${c + 1}`);
  process.exit(0);
}

const branch = git('rev-parse', '--abbrev-ref', 'HEAD');
if (branch !== null && branch !== 'dev' && !flag('--any-branch')) {
  stop(`you're on "${branch}". Run this on the dev branch (git checkout dev), where the dev builds are.`);
}
if (devBuilds.length === 0) stop(`there are no dev builds ("kind": "dev") to release. Production is on ${productionNewest.version}.`);
if (entries.findIndex((e) => e.kind !== 'dev') < devBuilds.length) {
  stop('a dev build sits below a release or hotfix in CHANGELOG.json; fix the order (newest first) before releasing');
}

const asked = option('--version');
const version = asked ?? `${maj}.${min + 1}.0`;
if (!/^\d+\.\d+\.0$/.test(version)) stop(`a release version ends in .0 — got ${version}`);
if (compare(version, devBuilds[0].version) <= 0 || compare(version, productionNewest.version) <= 0) {
  stop(`${version} must be above production's ${productionNewest.version} and the newest dev build ${devBuilds[0].version}`);
}

// The lines, newest build first, each said once, in the usual section order.
const sections = {};
for (const name of SECTION_ORDER) {
  const lines = [];
  for (const build of devBuilds) for (const line of build.sections[name] ?? []) if (!lines.includes(line)) lines.push(line);
  if (lines.length) sections[name] = lines;
}
const titles = [...new Set(devBuilds.map((b) => b.title))];
const title = option('--title') ?? (titles.length === 1 ? titles[0] : titles.slice(0, 3).join('; ') + (titles.length > 3 ? '; and more' : ''));

const release = {
  version,
  date: localToday(),
  title,
  kind: 'release',
  sections,
  tested: devBuilds.map((b) => ({ ...b, kind: 'dev' })),
};
const next = { ...doc, releases: [release, ...entries.slice(devBuilds.length)] };
const text = `${JSON.stringify(next, null, 2)}\n`;
const range = devBuilds.length === 1 ? devBuilds[0].version : `${devBuilds.at(-1).version}–${devBuilds[0].version}`;

if (flag('--dry-run')) {
  console.log(JSON.stringify(release, null, 2));
  console.log(`\n(dry run: CHANGELOG.json not changed. ${version} would roll up ${range}.)`);
  process.exit(0);
}

writeFileSync(FILE, text);
try {
  execFileSync(process.execPath, [resolve(ROOT, 'scripts', 'check-changelog.js')], {
    cwd: ROOT, env: { ...process.env, CHANGELOG_FILE: FILE, CHANGELOG_TARGET: 'production' }, stdio: 'inherit',
  });
} catch {
  writeFileSync(FILE, `${JSON.stringify(doc, null, 2)}\n`);
  stop('the release entry failed the production check, so CHANGELOG.json was put back as it was');
}

const steps = [
  ['Read the new entry. Edit the title or any line so it reads well for players (the rolled-up lines are the dev builds\' own wording).', 'git diff CHANGELOG.json'],
  ['Stage it.', 'git add CHANGELOG.json'],
  ['Commit it on dev.', `git commit -m "${version}: release (tested as ${range})"`],
  ['Push dev. The dev site deploys the release build first: wait for the Deploy dev run to go green and check https://dev.everstats.app/api/health says ' + version + '.', 'git push origin dev'],
  ['Switch to main.', 'git checkout main'],
  ['Bring main up to date.', 'git pull --ff-only origin main'],
  ['Merge dev into main. If git says it can\'t fast-forward, main has a hotfix dev doesn\'t: stop and merge main into dev first (RELEASING.md, "Hotfix").', 'git merge --ff-only dev'],
  ['Push main. Production deploys ' + version + ': wait for the Deploy run to go green and check https://everstats.app/api/health.', 'git push origin main'],
  ['Go back to dev for the next round (its next build is ' + `${version.split('.').slice(0, 2).join('.')}.1` + ').', 'git checkout dev'],
];
console.log(`\nMade ${version} (${release.date}), rolling up ${range}. Next, one step at a time (PowerShell):\n`);
steps.forEach(([why, cmd], i) => console.log(`  ${i + 1}. ${why}\n       ${cmd}\n`));
