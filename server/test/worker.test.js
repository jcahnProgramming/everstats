import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { startDb } from './helpers.js';

let d;
before(async () => {
  d = await startDb();
});
after(() => d.close());

test('the empty job loop ticks, writes its heartbeat, and reports healthy', async () => {
  const { createLoop } = await import('../worker/loop.js');
  const { createWorkerApp } = await import('../worker/app.js');
  const loop = createLoop({ db: d.db, jobs: [], workerId: 'test-worker', version: '0.0.0', tickMs: 60_000 });
  assert.equal(loop.health().healthy, false); // nothing has ticked yet
  await loop.tick();
  assert.equal(loop.health().healthy, true);
  const row = await d.db.one("SELECT state, jobs FROM worker_status WHERE worker_id = 'test-worker'");
  assert.deepEqual(row, { state: 'idle', jobs: [] });

  const server = await new Promise((res) => {
    const s = createWorkerApp({ loop, db: d.db }).listen(0, '127.0.0.1', () => res(s));
  });
  const body = await (await fetch(`http://127.0.0.1:${server.address().port}/api/health`)).json();
  assert.equal(body.status, 'ok');
  assert.equal(body.service, 'worker');
  assert.equal(body.loop.state, 'idle');
  await new Promise((res) => server.close(res));
});

test('a stalled loop is reported unhealthy (so the deploy and the healthcheck fail)', async () => {
  const { createLoop } = await import('../worker/loop.js');
  let clock = Date.now();
  const loop = createLoop({ db: d.db, jobs: [], workerId: 'stall', version: '0.0.0', tickMs: 1000, now: () => clock });
  await loop.tick();
  assert.equal(loop.health().healthy, true);
  clock += 10_000;
  assert.equal(loop.health().healthy, false);
});

test('a failing job is recorded, and the loop carries on', async () => {
  const { createLoop } = await import('../worker/loop.js');
  const job = { id: 'boom', label: 'Boom', everyMs: 0, run: async () => { throw Object.assign(new Error('secret body text'), { code: 'E_TEST' }); } };
  const loop = createLoop({ db: d.db, jobs: [job], workerId: 'fails', version: '0.0.0' });
  await loop.tick();
  const [view] = loop.health().jobs;
  assert.equal(view.lastOutcome, 'failed');
  assert.equal(view.lastSummary, 'Error (E_TEST)'); // never the message
});
