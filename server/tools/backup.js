// Backups by hand (RESTORE.md). Runs inside the worker container, where BACKUP_DIR and DATABASE_URL are set:
//
//   docker exec everstats-worker node server/tools/backup.js now             take a backup now, exactly as the nightly one does
//   docker exec everstats-worker node server/tools/backup.js list            the backups in BACKUP_DIR, newest first, with sizes
//   docker exec everstats-worker node server/tools/backup.js verify <file>   read a backup through: its contents list, that it holds
//                                                                             no Blizzard data, and every table's data
//
// `now` is recorded like the nightly run (the admin page and the worker's health show it), and replaces today's file.
import { statSync } from 'node:fs';
import { basename, join } from 'node:path';
import { devNull } from 'node:os';
import { checkArchive, listBackups, recordedBackup, run } from '../core/backup.js';
import { config } from '../core/config.js';
import { createDb } from '../core/db.js';

const [command, file] = process.argv.slice(2);
const fail = (message) => {
  console.error(`[backup] FAILED: ${message}`);
  process.exit(1);
};

try {
  if (command === 'verify' && file) {
    const { stdout } = await run('pg_restore', ['--list', file]);
    let c;
    try {
      c = checkArchive(stdout);
    } catch (err) {
      fail(`${basename(file)}: ${err.message}`);
    }
    await run('pg_restore', [`--file=${devNull}`, file]);
    console.log(`[backup] ${basename(file)}: readable all the way through, ${c.tables} tables with data, no Blizzard data`);
  } else if (command === 'list' || command === 'now') {
    if (!config.backupDir) fail('BACKUP_DIR is not set (run this inside the everstats-worker container)');
    if (command === 'list') {
      for (const b of listBackups(config.backupDir)) {
        console.log(`${b.name}  ${statSync(join(config.backupDir, b.name)).size} bytes${b.legacy ? '  (before 0.5.0: holds Blizzard data, deleted 3 days after it was taken)' : ''}`);
      }
    } else {
      const db = createDb({ max: 2 });
      const r = await recordedBackup({ db, dir: config.backupDir, databaseUrl: config.databaseUrl, trigger: 'manual' });
      await db.close();
      if (r.outcome !== 'ok') process.exit(1);
    }
  } else {
    console.error('Usage: node server/tools/backup.js now | list | verify <file>');
    process.exit(2);
  }
} catch (err) {
  fail(`${err?.code ? `${err.code}: ` : ''}${err?.message ?? err}`);
}
