import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { after, test } from 'node:test';

// scripts/check-changelog.js runs before every build (and so every deploy). 0.5.0: a release dated in the future is
// refused; "today" is the latest calendar date anywhere (UTC+14), so a release dated today in any time zone passes.
const SCRIPT = resolve(import.meta.dirname, '..', '..', 'scripts', 'check-changelog.js');
const dir = mkdtempSync(join(tmpdir(), 'es-changelog-'));
after(() => rmSync(dir, { recursive: true, force: true }));

function check(date, now) {
  const file = join(dir, `${date}.json`);
  writeFileSync(file, JSON.stringify({ releases: [{ version: '1.2.3', date, title: 'Fixture', sections: { Fixed: ['A fixture line.'] } }] }));
  try {
    execFileSync(process.execPath, [SCRIPT], { env: { ...process.env, CHANGELOG_FILE: file, CHANGELOG_NOW: now }, stdio: 'pipe' });
    return 'ok';
  } catch (err) {
    return String(err.stderr);
  }
}

test('the changelog check refuses a release dated in the future, and only that', () => {
  // 2026-11-09 16:00 in Arizona (−07:00) is 23:00 UTC: today is the 9th there and in UTC.
  const now = '2026-11-09T23:00:00Z';
  assert.equal(check('2026-11-09', now), 'ok');
  assert.equal(check('2026-11-08', now), 'ok');
  // The 10th has already begun in UTC+14 (it's 13:00 there), so a release made there today is the 10th: allowed.
  assert.equal(check('2026-11-10', now), 'ok');
  assert.match(check('2026-11-11', now), /2026-11-11\) is in the future/);
  assert.match(check('2026-11-12', '2026-11-09T07:00:00Z'), /is in the future/);
  assert.match(check('2026-02-30', now), /not a real date/);
});

test('the real CHANGELOG.json passes', () => {
  execFileSync(process.execPath, [SCRIPT], { stdio: 'pipe' });
});

// 0.10.2: two sites (RELEASING.md). Dev builds are patches shown only on dev; a release is the next minor and rolls
// them up; production's build refuses a changelog with a dev build left in (a promotion that skipped the release).
const RELEASE = resolve(import.meta.dirname, '..', '..', 'scripts', 'release.js');
const entry = (version, kind, extra = {}) => ({ version, date: '2026-11-09', title: `Build ${version}`, ...(kind ? { kind } : {}), sections: { Fixed: [`Line of ${version}.`] }, ...extra });

function checkDoc(releases, target) {
  const file = join(dir, `doc-${Math.random().toString(36).slice(2)}.json`);
  writeFileSync(file, JSON.stringify({ releases }));
  try {
    execFileSync(process.execPath, [SCRIPT], { env: { ...process.env, CHANGELOG_FILE: file, CHANGELOG_NOW: '2026-11-09T23:00:00Z', CHANGELOG_TARGET: target ?? '' }, stdio: 'pipe' });
    return 'ok';
  } catch (err) {
    return String(err.stderr);
  }
}

test('dev builds are allowed on dev and refused on production, with what to do instead', () => {
  const devLine = [entry('0.10.4', 'dev'), entry('0.10.3', 'dev'), entry('0.10.2', 'hotfix'), entry('0.10.1')];
  assert.equal(checkDoc(devLine, 'dev'), 'ok');
  assert.equal(checkDoc(devLine), 'ok');
  assert.match(checkDoc(devLine, 'production'), /0\.10\.4, 0\.10\.3 are dev builds .*the release script was skipped.*node scripts\/release\.js/s);
  // Production's newest must be a dated release or hotfix (an old kind-less entry on top isn't enough).
  assert.match(checkDoc([entry('0.10.1')], 'production'), /must be a release .* or a hotfix/);
  assert.equal(checkDoc([entry('0.11.0', 'release', { tested: [entry('0.10.4', 'dev'), entry('0.10.3', 'dev')] }), entry('0.10.2', 'hotfix')], 'production'), 'ok');
  assert.match(checkDoc([entry('0.10.2')], 'staging'), /CHANGELOG_TARGET must be one of production, dev/);
});

test('the version rule: dev builds and hotfixes are patches of production\'s line, a release is the next .0', () => {
  assert.match(checkDoc([entry('0.11.1', 'release'), entry('0.10.2', 'hotfix')]), /release, so its version must end in \.0/);
  assert.match(checkDoc([entry('0.11.0', 'dev'), entry('0.10.2', 'hotfix')]), /dev, so it is a patch/);
  assert.match(checkDoc([entry('0.11.3', 'dev'), entry('0.10.2', 'hotfix')]), /dev build 0\.11\.3, but production's newest is 0\.10\.2: dev builds are its next patches \(0\.10\.x\)/);
  // After a hotfix, dev carries on from it.
  assert.equal(checkDoc([entry('0.11.2', 'dev'), entry('0.11.1', 'hotfix'), entry('0.11.0', 'release')]), 'ok');
  assert.match(checkDoc([entry('0.11.0', 'release', { tested: [entry('0.10.3', 'dev')] }), entry('0.10.3', 'hotfix')]), /appears twice/);
  assert.match(checkDoc([entry('0.10.3', 'hotfix', { tested: [entry('0.10.2', 'dev')] })]), /tested belongs to a release only/);
  assert.match(checkDoc([entry('0.10.3', 'beta')]), /kind must be one of release, hotfix, dev/);
});

function runRelease(releases, args = []) {
  const file = join(dir, `rel-${Math.random().toString(36).slice(2)}.json`);
  writeFileSync(file, `${JSON.stringify({ releases }, null, 2)}\n`);
  try {
    const out = execFileSync(process.execPath, [RELEASE, '--any-branch', ...args], { env: { ...process.env, CHANGELOG_FILE: file }, stdio: 'pipe', encoding: 'utf8' });
    return { out, doc: JSON.parse(readFileSync(file, 'utf8')) };
  } catch (err) {
    return { error: String(err.stderr), doc: JSON.parse(readFileSync(file, 'utf8')) };
  }
}

test('the release script rolls the dev builds into the next minor and prints the git steps', () => {
  const builds = [
    { version: '0.10.5', date: '2026-11-09', title: 'Third', kind: 'dev', sections: { Fixed: ['Fixed C.'], New: ['Added A.'] } },
    { version: '0.10.4', date: '2026-11-09', title: 'Second', kind: 'dev', sections: { Improved: ['Changed B.'] } },
    { version: '0.10.3', date: '2026-11-09', title: 'First', kind: 'dev', sections: { New: ['Added A.', 'Added D.'] } },
  ];
  const { out, doc } = runRelease([...builds, entry('0.10.2', 'hotfix'), entry('0.10.1')], ['--title', 'The admin rework']);
  const r = doc.releases[0];
  assert.equal(r.version, '0.11.0');
  assert.equal(r.kind, 'release');
  assert.equal(r.title, 'The admin rework');
  assert.match(r.date, /^\d{4}-\d{2}-\d{2}$/);
  assert.deepEqual(r.sections, { New: ['Added A.', 'Added D.'], Improved: ['Changed B.'], Fixed: ['Fixed C.'] });
  assert.deepEqual(r.tested.map((b) => b.version), ['0.10.5', '0.10.4', '0.10.3']);
  assert.deepEqual(doc.releases.map((e) => e.version), ['0.11.0', '0.10.2', '0.10.1']);
  assert.match(out, /rolling up 0\.10\.3–0\.10\.5/);
  assert.match(out, /git merge --ff-only dev/);
  assert.doesNotMatch(out, /&&/); // PowerShell 5.1 has no &&
  // The result is what production's build accepts.
  assert.equal(checkDoc(doc.releases, 'production'), 'ok');
});

test('the release script refuses when there is nothing to release, and changes nothing', () => {
  const releases = [entry('0.10.2', 'hotfix')];
  const { error, doc } = runRelease(releases);
  assert.match(error, /no dev builds/);
  assert.deepEqual(doc.releases, releases);
  assert.equal(execFileSync(process.execPath, [RELEASE, 'next'], { env: { ...process.env, CHANGELOG_FILE: writeTemp([entry('0.11.1', 'hotfix'), entry('0.11.0', 'release')]) }, encoding: 'utf8' }).trim(), '0.11.2');
});

function writeTemp(releases) {
  const file = join(dir, `next-${Math.random().toString(36).slice(2)}.json`);
  writeFileSync(file, JSON.stringify({ releases }));
  return file;
}
