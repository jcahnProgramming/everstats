import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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
