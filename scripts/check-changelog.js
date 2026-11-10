#!/usr/bin/env node
/**
 * Validates CHANGELOG.json before the build.
 *
 * Wire into package.json:
 *   "build": "node scripts/check-changelog.js && <your build command>"
 *
 * A malformed entry fails the build, and with it the deploy. That is the
 * whole point: a changelog you can forget is a changelog that rots.
 *
 * Dates are the day a release was made, never a day still to come: a date
 * later than today is refused. "Today" is the latest calendar date anywhere
 * on Earth (UTC+14), so a release dated today in the author's time zone, or in
 * UTC on the build server, is never refused by mistake.
 *
 * 0.10.2: two sites (RELEASING.md). An entry may say what it is with `kind`:
 *   "dev"      a build on the dev site only, shown there as "In testing". A PATCH (x.y.z, z > 0).
 *   "release"  a release to production: the next MINOR (x.y.0). `scripts/release.js` makes it on the dev branch,
 *              rolling the dev builds since the last release into it; they are kept under it in `tested`.
 *   "hotfix"   a patch straight to production (x.y.z, z > 0), merged back into dev afterwards.
 * An entry without a kind is a release made before 0.10.2.
 *
 * CHANGELOG_TARGET says which site the build is for:
 *   production  (the main branch, docker-compose.yml): no "dev" entry may be left at the top level, and the newest
 *               entry must be a dated release or hotfix. A dev branch merged into main without running the release
 *               script fails here, before anything is deployed.
 *   dev         (the dev branch, docker-compose.dev.yml): dev builds are allowed.
 *   unset       (local builds, tests): both are allowed.
 *
 * For tests: CHANGELOG_FILE reads another file; CHANGELOG_NOW (an ISO moment)
 * stands in for the current time.
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FILE = process.env.CHANGELOG_FILE ? resolve(process.env.CHANGELOG_FILE) : resolve(ROOT, 'CHANGELOG.json');
const NOW = process.env.CHANGELOG_NOW ? Date.parse(process.env.CHANGELOG_NOW) : Date.now();
const TARGET = (process.env.CHANGELOG_TARGET ?? '').trim().toLowerCase() || null;
// The calendar date in the time zone furthest ahead (UTC+14): no place on Earth is past it yet.
const LATEST_TODAY = new Date(NOW + 14 * 60 * 60 * 1000).toISOString().slice(0, 10);

const ALLOWED_SECTIONS = ['New', 'Improved', 'Fixed', 'Removed'];
const KINDS = ['release', 'hotfix', 'dev'];
const TARGETS = ['production', 'dev'];
const SEMVER = /^\d+\.\d+\.\d+$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function fail(message) {
  console.error(`\nCHANGELOG.json: ${message}\n`);
  process.exit(1);
}

if (TARGET && !TARGETS.includes(TARGET)) fail(`CHANGELOG_TARGET must be one of ${TARGETS.join(', ')} — got ${JSON.stringify(TARGET)}`);

let raw;
try {
  raw = readFileSync(FILE, 'utf8');
} catch {
  fail(`not found at ${FILE}`);
}

let doc;
try {
  doc = JSON.parse(raw);
} catch (err) {
  fail(`is not valid JSON — ${err.message}`);
}

if (!Array.isArray(doc.releases) || doc.releases.length === 0) {
  fail('needs a non-empty "releases" array');
}

const compare = (a, b) => {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] - pb[i];
  }
  return 0;
};
const patchOf = (v) => Number(v.split('.')[2]);

/** The checks every entry gets, top level or tested under a release. */
function checkEntry(entry, where) {
  if (typeof entry !== 'object' || entry === null) fail(`${where} must be an object`);
  if (typeof entry.version !== 'string' || !SEMVER.test(entry.version)) {
    fail(`${where}.version must look like 1.2.3 — got ${JSON.stringify(entry.version)}`);
  }
  if (typeof entry.date !== 'string' || !ISO_DATE.test(entry.date)) {
    fail(`${where}.date must be YYYY-MM-DD — got ${JSON.stringify(entry.date)}`);
  }
  if (Number.isNaN(Date.parse(entry.date)) || new Date(`${entry.date}T00:00:00Z`).toISOString().slice(0, 10) !== entry.date) {
    fail(`${where}.date is not a real date — got ${entry.date}`);
  }
  if (entry.date > LATEST_TODAY) {
    fail(`${where}.date (${entry.date}) is in the future — date a release the day it is made`);
  }
  if (typeof entry.title !== 'string' || entry.title.trim() === '') {
    fail(`${where}.title must be a non-empty string`);
  }
  if (entry.kind !== undefined && !KINDS.includes(entry.kind)) {
    fail(`${where}.kind must be one of ${KINDS.join(', ')} (or left out for a release before 0.10.2) — got ${JSON.stringify(entry.kind)}`);
  }
  if (typeof entry.sections !== 'object' || entry.sections === null) {
    fail(`${where}.sections must be an object`);
  }

  const names = Object.keys(entry.sections);
  if (names.length === 0) {
    fail(`${where}.sections is empty — omit sections that don't apply, but keep at least one`);
  }
  for (const name of names) {
    if (!ALLOWED_SECTIONS.includes(name)) {
      fail(`${where}.sections has unknown section "${name}" — allowed: ${ALLOWED_SECTIONS.join(', ')}`);
    }
    const items = entry.sections[name];
    if (!Array.isArray(items) || items.length === 0) {
      fail(`${where}.sections.${name} must be a non-empty array — omit the section instead`);
    }
    items.forEach((item, i) => {
      if (typeof item !== 'string' || item.trim() === '') {
        fail(`${where}.sections.${name}[${i}] must be a non-empty string`);
      }
    });
  }

  // The version rule (RELEASING.md): dev builds and hotfixes are patches, a release is the next minor.
  if (entry.kind === 'release' && patchOf(entry.version) !== 0) {
    fail(`${where} is a release, so its version must end in .0 (the next minor) — got ${entry.version}. Dev builds and hotfixes are the patches.`);
  }
  if ((entry.kind === 'dev' || entry.kind === 'hotfix') && patchOf(entry.version) === 0) {
    fail(`${where} is a ${entry.kind}, so it is a patch (x.y.z with z above 0) — got ${entry.version}. Only a release ends in .0.`);
  }
}

const seen = new Set();
const once = (version, where) => {
  if (seen.has(version)) fail(`${where}.version ${version} appears twice — every build has its own number`);
  seen.add(version);
};

let previous = null;

doc.releases.forEach((entry, index) => {
  const where = `releases[${index}]`;
  checkEntry(entry, where);
  once(entry.version, where);

  if (entry.tested !== undefined) {
    if (entry.kind !== 'release') fail(`${where}.tested belongs to a release only (the dev builds it was tested as)`);
    if (!Array.isArray(entry.tested) || entry.tested.length === 0) fail(`${where}.tested must be a non-empty array, or left out`);
    let last = null;
    entry.tested.forEach((build, i) => {
      const w = `${where}.tested[${i}]`;
      checkEntry(build, w);
      if (build.kind !== 'dev') fail(`${w} must be a dev build (kind "dev")`);
      if (build.tested !== undefined) fail(`${w} can't have builds of its own`);
      if (compare(build.version, entry.version) >= 0) fail(`${w}.version (${build.version}) must be lower than the release it rolled into (${entry.version})`);
      if (last && compare(build.version, last) >= 0) fail(`${w}.version (${build.version}) is not lower than the build above it (${last}) — newest first`);
      last = build.version;
      once(build.version, w);
    });
  }

  if (previous && compare(entry.version, previous) >= 0) {
    fail(
      `${where}.version (${entry.version}) is not lower than the entry above it (${previous}) — ` +
      'newest release goes first'
    );
  }
  previous = entry.version;
});

// Every dev build carries on from production's line (RELEASING.md): production on 0.10.2 → dev builds 0.10.3, 0.10.4 …;
// after the release 0.11.0 they are 0.11.1, 0.11.2 …; after a hotfix 0.11.1 the next is 0.11.2.
doc.releases.forEach((entry, index) => {
  if (entry.kind !== 'dev') return;
  const below = doc.releases.slice(index + 1).find((e) => e.kind !== 'dev');
  if (!below) return;
  const line = (v) => v.split('.').slice(0, 2).join('.');
  if (line(entry.version) !== line(below.version)) {
    fail(`releases[${index}] is a dev build ${entry.version}, but production's newest is ${below.version}: dev builds are its next patches (${line(below.version)}.x)`);
  }
});

const top = doc.releases[0];
const devAtTop = doc.releases.filter((e) => e.kind === 'dev');

if (TARGET === 'production') {
  if (devAtTop.length > 0) {
    fail(
      `${devAtTop.map((e) => e.version).join(', ')} ${devAtTop.length === 1 ? 'is a dev build' : 'are dev builds'} ("In testing"), ` +
      'which never reach production on their own. If this is dev being promoted to main, the release script was skipped: ' +
      'on the dev branch run `node scripts/release.js`, commit, push dev, and promote again (RELEASING.md).'
    );
  }
  if (top.kind !== 'release' && top.kind !== 'hotfix') {
    fail(`the newest entry (${top.version}) must be a release (kind "release") or a hotfix (kind "hotfix") on production`);
  }
}

const label = TARGET ? ` for ${TARGET}` : '';
console.log(`CHANGELOG.json ok${label} — ${doc.releases.length} entr${doc.releases.length === 1 ? 'y' : 'ies'}, current ${top.version}${top.kind ? ` (${top.kind})` : ''}`);
