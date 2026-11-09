// Cross-platform dev launcher: the dev database (scripts/dev-db.js), the web server and the worker (watch mode) and
// the Vite dev server on http://localhost:3000 (the address the OAuth providers have registered). Ctrl+C stops all.
import { spawn } from 'node:child_process';
import { connect } from 'node:net';

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function start(name, cmd, args) {
  // Windows can only start npm.cmd through a shell, and Node deprecates an argument list with shell: true (DEP0190),
  // so there the command goes as one string. The arguments are the fixed ones below, never user input.
  const opts = { stdio: ['ignore', 'pipe', 'pipe'] };
  const child = process.platform === 'win32' && cmd === npm ? spawn([cmd, ...args].join(' '), { ...opts, shell: true }) : spawn(cmd, args, opts);
  const prefix = (chunk) => chunk.toString().split(/\r?\n/).filter(Boolean).map((line) => `[${name}] ${line}`).join('\n');
  child.stdout.on('data', (d) => console.log(prefix(d)));
  child.stderr.on('data', (d) => console.error(prefix(d)));
  child.on('exit', (code) => console.log(`[${name}] exited with code ${code}`));
  return child;
}

const portOpen = (port) =>
  new Promise((res) => {
    const s = connect({ port, host: '127.0.0.1' }, () => {
      s.end();
      res(true);
    });
    s.on('error', () => res(false));
  });

const procs = [];
if (!process.env.DATABASE_URL) {
  procs.push(start('db', process.execPath, ['scripts/dev-db.js']));
  for (let i = 0; i < 50 && !(await portOpen(Number(process.env.DEV_DB_PORT) || 5439)); i++) await new Promise((r) => setTimeout(r, 200));
}
procs.push(start('web', npm, ['run', 'dev', '--workspace', 'server']));
procs.push(start('worker', npm, ['run', 'dev:worker', '--workspace', 'server']));
procs.push(start('client', npm, ['run', 'dev', '--workspace', 'client']));

const stop = () => {
  for (const p of procs) p.kill();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
