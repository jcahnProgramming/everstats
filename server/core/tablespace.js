/**
 * The "snapshots" tablespace: where the bulk time-series tables (daily character snapshots, kept forever) will live.
 * In production SNAPSHOT_TABLESPACE_DIR is a path inside the database container that docker-compose.yml mounts from
 * the array disk (PG_SNAPSHOT_DIR on the host), so the big, append-mostly tables sit on the array and everything else
 * stays on the fast pool. Checked at every start-up (not a migration), so setting it later still takes effect.
 *
 * A snapshot table's migration writes `CREATE TABLE … ${await snapshotTablespace(q)}`: the clause, or '' in local dev.
 */
export const SNAPSHOT_TABLESPACE = 'snapshots';

export async function ensureSnapshotTablespace(db, dir, { production }) {
  if (!dir) {
    if (production) throw new Error('SNAPSHOT_TABLESPACE_DIR is not set: production keeps snapshot tables on the array disk');
    return { state: 'default', dir: null };
  }
  if (!/^\/[A-Za-z0-9/_.-]+$/.test(dir)) throw new Error('SNAPSHOT_TABLESPACE_DIR must be an absolute path of plain characters');
  const existing = await db.one('SELECT pg_tablespace_location(oid) AS location FROM pg_tablespace WHERE spcname = $1', [SNAPSHOT_TABLESPACE]);
  if (existing) {
    if (existing.location !== dir) {
      throw new Error(`tablespace "${SNAPSHOT_TABLESPACE}" is at ${existing.location}, but SNAPSHOT_TABLESPACE_DIR says ${dir}`);
    }
    return { state: 'ready', dir };
  }
  // Can't be parameterised, and can't run inside a transaction. dir is checked above.
  await db.query(`CREATE TABLESPACE ${SNAPSHOT_TABLESPACE} LOCATION '${dir}'`);
  console.log(`[db] created tablespace ${SNAPSHOT_TABLESPACE} at ${dir}`);
  return { state: 'ready', dir };
}

/** The clause a snapshot table's CREATE TABLE ends with. */
export async function snapshotTablespace(q) {
  const row = await q.one('SELECT 1 FROM pg_tablespace WHERE spcname = $1', [SNAPSHOT_TABLESPACE]);
  return row ? `TABLESPACE ${SNAPSHOT_TABLESPACE}` : '';
}
