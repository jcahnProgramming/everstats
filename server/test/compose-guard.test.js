import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

// Comment lines are prose (they may say "never 0.0.0.0"); the checks read only the configuration itself.
const code = (text) => text.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
const compose = code(readFileSync(new URL('../../docker-compose.yml', import.meta.url), 'utf8'));
const dockerfile = readFileSync(new URL('../../Dockerfile', import.meta.url), 'utf8');
const workflow = code(readFileSync(new URL('../../.gitea/workflows/deploy.yml', import.meta.url), 'utf8'));

test('host ports bind to BIND_IP only, never 0.0.0.0 or all interfaces', () => {
  const ports = [...compose.matchAll(/^\s+- "(.*:3\d{3})"$/gm)].map((m) => m[1]);
  assert.equal(ports.length, 2, 'exactly the web and worker ports');
  for (const p of ports) assert.match(p, /^\$\{BIND_IP:\?[^}]+\}:\$\{(WEB|WORKER)_PORT:-326[01]\}:326[01]$/);
  assert.doesNotMatch(compose, /0\.0\.0\.0/);
});

test('the database publishes no port', () => {
  const db = compose.slice(compose.indexOf('  everstats-db:'), compose.indexOf('  everstats:\n'));
  assert.doesNotMatch(db, /ports:/);
});

test('database folders are required, never created by Docker, never under /mnt/user', () => {
  assert.equal((compose.match(/create_host_path: false/g) ?? []).length, 2);
  assert.match(compose, /PG_DATA_DIR:\?/);
  assert.match(compose, /PG_SNAPSHOT_DIR:\?/);
  assert.match(workflow, /\*\/mnt\/user\/\*\)/);
});

test('the image carries CHANGELOG.json, and the deploy checks the version and .env', () => {
  assert.match(dockerfile, /CHANGELOG\.json/);
  assert.match(workflow, /releases\[0\]\.version/);
  assert.match(workflow, /Confirm \.env untouched/);
  assert.doesNotMatch(workflow, /reset --hard|git clean/);
});

test('ports agree everywhere: config, Dockerfile, compose and deploy', async () => {
  const { DEFAULT_WEB_PORT, DEFAULT_WORKER_PORT } = await import('../core/config.js');
  for (const text of [dockerfile, compose, workflow]) {
    assert.ok(text.includes(String(DEFAULT_WEB_PORT)));
    assert.ok(text.includes(String(DEFAULT_WORKER_PORT)));
  }
});
