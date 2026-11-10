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

test('database and backup folders are required, never created by Docker; database folders never under /mnt/user', () => {
  assert.equal((compose.match(/create_host_path: false/g) ?? []).length, 3);
  assert.match(compose, /BACKUP_DIR:\?/);
  assert.ok(workflow.includes('BACKUP_DIR: ${{ vars.BACKUP_DIR }}'));
  // Backups may live on /mnt/user (a flat file write); the refusal applies to the live database folders only.
  assert.ok(workflow.includes('case "$PG_DATA_DIR$PG_SNAPSHOT_DIR" in'));
  assert.match(compose, /PG_DATA_DIR:\?/);
  assert.match(compose, /PG_SNAPSHOT_DIR:\?/);
  assert.match(workflow, /\*\/mnt\/user\/\*\)/);
});

test('the image has pg_dump 17 for backups (the database is postgres:17)', () => {
  assert.match(dockerfile, /postgresql-client-17/);
  assert.match(compose, /image: postgres:17-/);
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

// 0.10.2: the private test site (docker-compose.dev.yml, deploy-dev.yml) shares nothing with production
// (RELEASING.md "How the guards work").
const devCompose = code(readFileSync(new URL('../../docker-compose.dev.yml', import.meta.url), 'utf8'));
const devWorkflow = code(readFileSync(new URL('../../.gitea/workflows/deploy-dev.yml', import.meta.url), 'utf8'));
const ciWorkflow = code(readFileSync(new URL('../../.gitea/workflows/ci.yml', import.meta.url), 'utf8'));

test('production and dev have their own project names, containers and images', () => {
  assert.match(compose, /^name: everstats$/m);
  assert.match(devCompose, /^name: everstats-dev$/m);
  const names = (text) => [...text.matchAll(/container_name: (\S+)/g)].map((m) => m[1]);
  assert.deepEqual(names(compose), ['everstats-db', 'everstats', 'everstats-worker']);
  assert.deepEqual(names(devCompose), ['everstats-dev-db', 'everstats-dev', 'everstats-dev-worker']);
  assert.match(compose, /image: everstats:local/);
  assert.match(devCompose, /image: everstats-dev:local/);
  assert.doesNotMatch(devCompose, /everstats:local/);
});

test('each stack names exactly its own environment\'s origin and database (core/environment.js)', async () => {
  const { ENVIRONMENTS } = await import('../core/environment.js');
  const dbOf = (e) => `${e.database.user}:\${POSTGRES_PASSWORD`;
  const { production: prod, dev } = ENVIRONMENTS;
  assert.ok(compose.includes(`postgres://${dbOf(prod)}`) && compose.includes(`@${prod.database.host}:5432/${prod.database.name}"`));
  assert.ok(devCompose.includes(`postgres://${dbOf(dev)}`) && devCompose.includes(`@${dev.database.host}:5432/${dev.database.name}"`));
  assert.ok(devCompose.includes(`POSTGRES_USER: ${dev.database.user}`) && devCompose.includes(`POSTGRES_DB: ${dev.database.name}`));
  assert.ok(devCompose.includes(`PUBLIC_ORIGIN: ${dev.origin}`));
  assert.ok(compose.includes(prod.origin));
  assert.doesNotMatch(devCompose, /@everstats-db:|everstats\.app"/);
  assert.match(compose, /ENVIRONMENT: "\$\{ENVIRONMENT:\?/);
  assert.match(devCompose, /ENVIRONMENT: "\$\{ENVIRONMENT:\?/);
  assert.match(compose, /CHANGELOG_TARGET: production/);
  assert.match(devCompose, /CHANGELOG_TARGET: dev/);
});

test('dev\'s folders, ports and subnet are its own variables, required, never production\'s', () => {
  // Only DEV_-prefixed folder and port variables: production's, exported in a shell, can't leak in.
  for (const v of ['PG_DATA_DIR', 'PG_SNAPSHOT_DIR', 'BACKUP_DIR', 'WEB_PORT', 'WORKER_PORT']) {
    assert.ok(!devCompose.includes(`\${${v}:`) && !devCompose.includes(`\${${v}}`), `${v} must be DEV_${v} in docker-compose.dev.yml`);
    assert.ok(devCompose.includes(`\${DEV_${v}`), `DEV_${v} is used`);
  }
  for (const v of ['DEV_PG_DATA_DIR', 'DEV_PG_SNAPSHOT_DIR', 'DEV_BACKUP_DIR']) assert.ok(devCompose.includes(`\${${v}:?`), `${v} is required`);
  assert.equal((devCompose.match(/create_host_path: false/g) ?? []).length, 3);
  const ports = [...devCompose.matchAll(/^\s+- "(.*:326[01])"$/gm)].map((m) => m[1]);
  assert.deepEqual(ports, ['${BIND_IP:?Set BIND_IP to the host address to publish on (see docker-compose.dev.yml)}:${DEV_WEB_PORT:-3270}:3260', '${BIND_IP:?Set BIND_IP to the host address to publish on (see docker-compose.dev.yml)}:${DEV_WORKER_PORT:-3271}:3261']);
  assert.doesNotMatch(devCompose, /0\.0\.0\.0/);
  const db = devCompose.slice(devCompose.indexOf('  everstats-dev-db:'), devCompose.indexOf('  everstats-dev:\n'));
  assert.doesNotMatch(db, /ports:/);
  // No default subnet: a forgotten prefix can't fall back to production's.
  assert.match(devCompose, /subnet: "\$\{EVERSTATS_DEV_SUBNET_PREFIX:\?/);
  assert.doesNotMatch(devCompose, /10\.213\.47/);
});

test('every dev container is capped so dev can never starve production', () => {
  for (const service of ['everstats-dev-db', 'everstats-dev', 'everstats-dev-worker']) {
    // The service's own block (depends_on names everstats-dev-db too, indented deeper).
    const start = devCompose.indexOf(`\n  ${service}:\n`);
    assert.ok(start > 0, `${service} found`);
    const rest = devCompose.slice(start + 2);
    const next = rest.search(/\n {2}[a-z][a-z-]*:\n|\nnetworks:/);
    const block = rest.slice(0, next);
    assert.match(block, /cpus: [0-9.]+/, `${service} has a CPU cap`);
    assert.match(block, /mem_limit: \d+[mg]/, `${service} has a memory cap`);
    assert.match(block, /pids_limit: \d+/, `${service} has a process cap`);
  }
  assert.match(devCompose, /cpu_shares: 256/);
  assert.match(devCompose, /oom_score_adj: 500/);
  assert.match(devCompose, /shared_buffers=64MB/);
  // Production is never capped by this build.
  assert.doesNotMatch(compose, /cpus:|mem_limit:|cpu_shares:/);
});

test('the dev deploy runs only for the dev branch, on dev\'s stack, behind every guard, and rolls back', () => {
  assert.match(devWorkflow, /push:\n\s+branches: \[dev\]/);
  assert.match(devWorkflow, /COMPOSE_FILE_NAME: docker-compose\.dev\.yml/);
  assert.match(devWorkflow, /PROJECT: everstats-dev/);
  // Every compose command names dev's project and file.
  const composeCalls = [...devWorkflow.matchAll(/docker compose ([^\n]*)/g)].map((m) => m[1]);
  assert.ok(composeCalls.length >= 4);
  for (const c of composeCalls) assert.match(c, /^-p (?:"\$PROJECT"|everstats-dev) -f (?:"\$COMPOSE_FILE_NAME"|docker-compose\.dev\.yml)/, c);
  assert.match(devWorkflow, /grep -qx "ENVIRONMENT=dev" \.env/);
  assert.match(devWorkflow, /clash\(\)/);
  assert.match(devWorkflow, /reuses production'"'"'s \$k/);
  assert.match(devWorkflow, /sh scripts\/ci-test\.sh dev/);
  assert.match(devWorkflow, /Roll back to the previous version/);
  assert.match(devWorkflow, /"environment":"dev"/);
  assert.match(devWorkflow, /Confirm dev \.env untouched/);
  assert.doesNotMatch(devWorkflow, /reset --hard|git clean/);
  // The Access token goes on stdin (-K -), never in a command line.
  assert.match(devWorkflow, /-K - "\$PUBLIC_URL\/api\/health"/);
  assert.doesNotMatch(devWorkflow, /-H "CF-Access/);
});

test('production refuses dev\'s folders, needs ENVIRONMENT=production and checks the changelog before touching the host', () => {
  assert.match(workflow, /push:\n\s+branches: \[main\]/);
  assert.match(workflow, /grep -qx "ENVIRONMENT=production" \.env/);
  assert.match(workflow, /clash\(\)/);
  assert.match(workflow, /CHANGELOG_TARGET=production/);
  assert.ok(workflow.indexOf('CHANGELOG_TARGET=production') < workflow.indexOf('Pull latest main'), 'the changelog is checked before the host moves');
  assert.match(workflow, /git merge --ff-only "\$CHECKED_SHA"/);
  assert.match(workflow, /Roll back to the previous version/);
  assert.match(workflow, /"environment":"production"/);
  assert.doesNotMatch(workflow, /docker-compose\.dev\.yml|everstats-dev:local/);
});

test('feature branches and pull requests are built and tested, never deployed', () => {
  assert.match(ciWorkflow, /branches-ignore: \[main, dev\]/);
  assert.match(ciWorkflow, /pull_request:/);
  assert.doesNotMatch(ciWorkflow, /docker compose|DEPLOY_DIR|\.env/);
  assert.match(ciWorkflow, /--cpus 2 --memory 3g/);
});

// 0.10.2 fix (production run #23, "CHECKED_SHA: parameter not set"): how values move inside and between steps.
const WORKFLOWS = { 'deploy.yml': workflow, 'deploy-dev.yml': devWorkflow, 'ci.yml': ciWorkflow };
const stepsOf = (text) => text.split('\n      - name: ').slice(1).map((s) => ({ name: s.split('\n')[0], body: s }));

test('every bare `docker run -e NAME` passes an exported variable (an env: entry), never a plain shell assignment', () => {
  for (const [file, text] of Object.entries(WORKFLOWS)) {
    const envKeys = new Set([...text.matchAll(/^\s+([A-Z][A-Z0-9_]*): /gm)].map((m) => m[1]));
    for (const step of stepsOf(text)) {
      for (const m of step.body.matchAll(/(?:^|\s)-e ([A-Z][A-Z0-9_]*)(?=\s)/g)) {
        assert.ok(envKeys.has(m[1]), `${file} › ${step.name}: -e ${m[1]} isn't an env: entry, so docker would pass nothing`);
      }
    }
  }
});

test('nothing passes between steps through /tmp: a file is read only in the step that wrote it', () => {
  for (const [file, text] of Object.entries(WORKFLOWS)) {
    for (const step of stepsOf(text)) {
      const used = new Set([...step.body.matchAll(/\/tmp\/([\w.-]+)/g)].map((m) => m[1]));
      for (const f of used) {
        assert.ok(new RegExp(`(?:^|[^<])>>? ?/tmp/${f.replace(/\./g, '[.]')}`).test(step.body), `${file} › ${step.name}: /tmp/${f} is used but not written in this step`);
      }
    }
  }
  // Values that later steps need are step outputs (ci.yml is a single step and needs none).
  for (const text of [workflow, devWorkflow]) assert.ok(text.includes('>> "$GITHUB_OUTPUT"'));
  assert.match(workflow, /CHECKED_SHA: \$\{\{ steps\.check\.outputs\.sha \}\}/);
  assert.match(devWorkflow, /TESTED_SHA: \$\{\{ steps\.tested\.outputs\.sha \}\}/);
});

test('a rollback runs only after the restart itself ran, so an early failure restarts nothing', () => {
  for (const text of [workflow, devWorkflow]) {
    const rollback = stepsOf(text).find((s) => s.name.startsWith('Roll back'));
    assert.ok(rollback);
    assert.match(rollback.body, /if: failure\(\) && \(steps\.restart\.outcome == 'success' \|\| steps\.restart\.outcome == 'failure'\) && steps\.build\.outputs\.previous == 'yes'/);
    // And the script checks the same again before it touches anything.
    assert.ok(rollback.body.indexOf('case "$RESTART_OUTCOME"') < rollback.body.indexOf('docker image tag'));
    assert.match(stepsOf(text).find((s) => /restart/i.test(s.name) && !s.name.startsWith('Roll back')).body, /id: restart/);
  }
});
