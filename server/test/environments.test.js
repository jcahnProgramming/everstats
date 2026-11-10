import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { ENVIRONMENTS, environmentDefault, resolveEnvironment } from '../core/environment.js';
import { checkEnvironmentMarker, recordEnvironmentMarker } from '../core/prepare.js';
import { startApp, startDb } from './helpers.js';

// 0.10.2: production (everstats.app) and the private test site (dev.everstats.app) run the same image. These are the
// guards inside the app that keep them apart (RELEASING.md "How the guards work").

const PROD = {
  NODE_ENV: 'production', ENVIRONMENT: 'production', PUBLIC_ORIGIN: 'https://everstats.app',
  DATABASE_URL: 'postgres://everstats:secret@everstats-db:5432/everstats',
};
const DEV = {
  NODE_ENV: 'production', ENVIRONMENT: 'dev', PUBLIC_ORIGIN: 'https://dev.everstats.app',
  DATABASE_URL: 'postgres://everstats_dev:secret@everstats-dev-db:5432/everstats_dev',
};

test('a deployed process needs ENVIRONMENT, and only production or dev', () => {
  assert.match(resolveEnvironment({ ...PROD, ENVIRONMENT: undefined }).problems.join(), /ENVIRONMENT is not set/);
  assert.match(resolveEnvironment({ ...PROD, ENVIRONMENT: 'staging' }).problems.join(), /not one of production, dev/);
  // Outside Docker it may be left out: local, with no checks.
  const local = resolveEnvironment({});
  assert.equal(local.env.id, 'local');
  assert.deepEqual(local.problems, []);
});

test('production and dev each start only with their own origin and database', () => {
  assert.deepEqual(resolveEnvironment(PROD).problems, []);
  assert.deepEqual(resolveEnvironment(DEV).problems, []);
  assert.equal(resolveEnvironment(DEV).env.marker, 'DEV');
  assert.equal(resolveEnvironment(PROD).env.marker, null);

  // Dev handed production's database URL: refused, and the message says whose it is (never the password).
  const crossed = resolveEnvironment({ ...DEV, DATABASE_URL: PROD.DATABASE_URL }).problems.join(' ');
  assert.match(crossed, /database host "everstats-dev-db"/);
  assert.match(crossed, /database name "everstats_dev"/);
  assert.match(crossed, /database user "everstats_dev"/);
  assert.match(crossed, /points at production's database container/);
  assert.doesNotMatch(crossed, /secret/);

  // Production with dev's address or database: refused too.
  assert.match(resolveEnvironment({ ...PROD, PUBLIC_ORIGIN: DEV.PUBLIC_ORIGIN }).problems.join(), /PUBLIC_ORIGIN is dev's address/);
  assert.match(resolveEnvironment({ ...PROD, DATABASE_URL: DEV.DATABASE_URL }).problems.join(), /points at dev's database container/);
  assert.match(resolveEnvironment({ ...PROD, PUBLIC_ORIGIN: undefined }).problems.join(), /must serve https:\/\/everstats\.app/);
  assert.match(resolveEnvironment({ ...DEV, DATABASE_URL: 'not a url' }).problems.join(), /DATABASE_URL is missing or not a URL/);
});

test('dev starts with the background crawl paused and a low budget; production keeps the registry defaults', () => {
  assert.equal(environmentDefault('crawler.paused', false, ENVIRONMENTS.dev), true);
  assert.equal(environmentDefault('crawler.requestsPerSecond', 8, ENVIRONMENTS.dev), 2);
  assert.equal(environmentDefault('crawler.paused', false, ENVIRONMENTS.production), false);
  assert.equal(environmentDefault('crawler.requestsPerSecond', 8, ENVIRONMENTS.production), 8);
  assert.equal(environmentDefault('grading.minPopulation', 50, ENVIRONMENTS.dev), 50);
});

test('dev keeps the last 3 nightly backups and no monthly copies; production 14 plus the first of each month', async () => {
  const { planPrune } = await import('../core/backup.js');
  const day = (d) => ({ name: `everstats-ours-2026-${d}.dump`, date: `2026-${d}`, legacy: false });
  const backups = ['09-01', '10-01', '10-20', '11-05', '11-06', '11-07', '11-08', '11-09'].map(day);
  const now = Date.parse('2026-11-09T12:00:00Z');
  const devGone = planPrune(backups, { now, nightly: ENVIRONMENTS.dev.backups.nightly, monthly: ENVIRONMENTS.dev.backups.monthly });
  assert.deepEqual(devGone.sort(), ['09-01', '10-01', '10-20', '11-05', '11-06'].map((d) => day(d).name).sort());
  const prodGone = planPrune(backups, { now, nightly: ENVIRONMENTS.production.backups.nightly, monthly: ENVIRONMENTS.production.backups.monthly });
  assert.deepEqual(prodGone, []);
});

let d;
before(async () => {
  d = await startDb();
});
after(() => d?.close());

test('the database remembers its environment, and another environment refuses it before any migration', async () => {
  await d.db.withClient(async (q) => {
    // Tests run as local: the first start wrote that.
    assert.equal((await q.one('SELECT environment FROM environment_marker')).environment, 'local');
    await assert.rejects(checkEnvironmentMarker(q, ENVIRONMENTS.dev, { deployed: true }), /belongs to the local environment and this process is dev/);
    await assert.rejects(checkEnvironmentMarker(q, ENVIRONMENTS.production, { deployed: true }), /refusing to touch it/);
    await checkEnvironmentMarker(q, ENVIRONMENTS.local);

    // A database with no marker yet that holds accounts (production's before 0.10.2, say): production takes it as its
    // own; a deployed dev process refuses it, because a dev database must start empty.
    await q.query('DELETE FROM environment_marker');
    await q.query('INSERT INTO accounts DEFAULT VALUES');
    await assert.rejects(checkEnvironmentMarker(q, ENVIRONMENTS.dev, { deployed: true }), /a dev database must start empty, and this one already has rows in accounts/);
    await checkEnvironmentMarker(q, ENVIRONMENTS.production, { deployed: true });
    await recordEnvironmentMarker(q, ENVIRONMENTS.production);
    await assert.rejects(checkEnvironmentMarker(q, ENVIRONMENTS.dev, { deployed: true }), /belongs to the production environment and this process is dev/);
    await assert.rejects(recordEnvironmentMarker(q, ENVIRONMENTS.dev), /belongs to the production environment, not dev/);
  });
});

test('the dev site says DEV before first paint, is never indexed and has no sitemap; production is unchanged', async () => {
  const dev = await startApp({ environment: ENVIRONMENTS.dev });
  const prod = await startApp({ environment: ENVIRONMENTS.production });
  try {
    const h = await dev.client().get('/api/health');
    assert.equal(h.json.environment, 'dev');
    assert.equal(h.headers.get('x-robots-tag'), 'noindex, nofollow, noarchive');
    assert.match((await dev.client().get('/api/theme-boot.js')).text, /setAttribute\('data-es-env','dev'\)/);
    const robots = await dev.client().get('/robots.txt');
    assert.equal(robots.text, 'User-agent: *\nDisallow: /\n');
    assert.equal((await dev.client().get('/sitemap.xml')).status, 404);

    const p = await prod.client().get('/api/health');
    assert.equal(p.json.environment, 'production');
    assert.equal(p.headers.get('x-robots-tag'), null);
    assert.doesNotMatch((await prod.client().get('/api/theme-boot.js')).text, /data-es-env/);
    assert.notEqual((await prod.client().get('/robots.txt')).text, 'User-agent: *\nDisallow: /\n');
  } finally {
    await dev.close();
    await prod.close();
  }
});

test('link previews on dev say DEV and ask not to be indexed', async () => {
  const { previewTags } = await import('../cards/meta.js');
  const p = { title: 'Path Vexley', description: 'A character.', image: null };
  const dev = previewTags(p, 'https://dev.everstats.app/c/path-vexley', { environment: ENVIRONMENTS.dev });
  assert.match(dev, /<title>\[DEV\] Path Vexley · Everstats<\/title>/);
  assert.match(dev, /og:site_name" content="Everstats DEV"/);
  assert.match(dev, /og:title" content="\[DEV\] Path Vexley"/);
  assert.match(dev, /<meta name="robots" content="noindex, nofollow" \/>/);
  const prod = previewTags(p, 'https://everstats.app/c/path-vexley', { environment: ENVIRONMENTS.production });
  assert.match(prod, /<title>Path Vexley · Everstats<\/title>/);
  assert.match(prod, /og:site_name" content="Everstats"/);
  assert.doesNotMatch(prod, /DEV|robots/);
});
