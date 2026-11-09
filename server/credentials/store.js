import { HttpError } from '../core/errors.js';
import { DecryptError, open, seal } from './crypto.js';
import { CREDENTIALS, getCredential } from './registry.js';

/**
 * Stored credentials. Resolution: the database (sealed with the root key) → .env → "not configured".
 * The app NEVER writes .env (the deploy fingerprints it and fails if it changed).
 *
 * Shapes that leave this module:
 *   resolveCredential(db, id)  server side only: { state, source, values, setAt, problem }
 *   publicStatus(db, id)       safe for the browser: state, source, set-on date, problem. Never a value or a last four.
 */
const slot = (id, field) => `${id}.${field}`;

const envOf = (f) => (process.env[f.env] ?? '').trim();

function fromEnv(def) {
  const set = def.fields.filter((f) => envOf(f));
  if (set.length === 0) return null;
  const missing = def.fields.find((f) => !envOf(f));
  if (missing) return { state: 'incomplete', source: 'env', values: {}, setAt: null, problem: `${missing.env} is not set in .env` };
  const values = Object.fromEntries(def.fields.map((f) => [f.name, envOf(f)]));
  for (const f of def.fields) {
    const problem = f.validate?.(values[f.name]);
    if (problem) return { state: 'incomplete', source: 'env', values: {}, setAt: null, problem: `${f.env} in .env: ${problem}` };
  }
  return { state: 'configured', source: 'env', values, setAt: null, problem: null };
}

export async function resolveCredential(db, id) {
  const def = getCredential(id);
  if (!def) throw new Error(`unknown credential ${id}`);
  const rows = await db.query('SELECT * FROM credentials WHERE provider = $1 ORDER BY field LIMIT 32', [id]);
  if (rows.length === 0) return fromEnv(def) ?? { state: 'not_configured', source: null, values: {}, setAt: null, problem: null };

  const byField = new Map(rows.map((r) => [r.field, r]));
  const setAt = rows.map((r) => r.set_at.toISOString()).sort().at(-1);
  const values = {};
  for (const f of def.fields) {
    const row = byField.get(f.name);
    if (!row) return { state: 'incomplete', source: 'database', values: {}, setAt, problem: `${f.label} is missing; save these keys again` };
    try {
      values[f.name] = open(slot(id, f.name), { ciphertext: row.ciphertext, iv: row.iv, authTag: row.auth_tag, keyFp: row.key_fp });
    } catch (err) {
      if (!(err instanceof DecryptError)) throw err;
      return { state: 'cant_decrypt', source: 'database', values: {}, setAt, problem: err.message };
    }
  }
  return { state: 'configured', source: 'database', values, setAt, problem: null };
}

export async function isConfigured(db, id) {
  return (await resolveCredential(db, id)).state === 'configured';
}

export async function publicStatus(db, id) {
  const def = getCredential(id);
  const r = await resolveCredential(db, id);
  return {
    id: def.id,
    label: def.label,
    unlocks: def.unlocks,
    obtain: def.obtain,
    fields: def.fields.map((f) => ({ name: f.name, label: f.label, env: f.env })),
    test: def.test ? { does: def.test.does } : null,
    state: r.state,
    source: r.source,
    setAt: r.setAt,
    problem: r.problem,
  };
}

export const listPublic = (db) => Promise.all(CREDENTIALS.map((c) => publicStatus(db, c.id)));

export async function saveCredential(db, id, input) {
  const def = getCredential(id);
  if (!def) throw new HttpError(404, 'Unknown credential');
  const values = {};
  for (const f of def.fields) {
    const raw = typeof input?.[f.name] === 'string' ? input[f.name].trim() : '';
    if (!raw) throw new HttpError(400, `${f.label} is required`, 'invalid');
    const problem = f.validate?.(raw);
    if (problem) throw new HttpError(400, problem, 'invalid');
    values[f.name] = raw;
  }
  await db.tx(async (q) => {
    const had = await q.one('SELECT 1 AS x FROM credentials WHERE provider = $1 LIMIT 1', [id]);
    await q.query('DELETE FROM credentials WHERE provider = $1', [id]);
    for (const f of def.fields) {
      const s = seal(slot(id, f.name), values[f.name]);
      await q.query(
        'INSERT INTO credentials (provider, field, ciphertext, iv, auth_tag, key_fp) VALUES ($1, $2, $3, $4, $5, $6)',
        [id, f.name, s.ciphertext, s.iv, s.authTag, s.keyFp],
      );
    }
    await q.query("INSERT INTO admin_events (type, detail) VALUES ('credential.saved', $1)", [{ provider: id, change: had ? 'replaced' : 'added' }]);
  });
  return publicStatus(db, id);
}

/** Removes the stored keys. A .env fallback, if there is one, applies again afterwards. */
export async function removeCredential(db, id) {
  if (!getCredential(id)) throw new HttpError(404, 'Unknown credential');
  await db.tx(async (q) => {
    await q.query('DELETE FROM credentials WHERE provider = $1', [id]);
    await q.query("INSERT INTO admin_events (type, detail) VALUES ('credential.removed', $1)", [{ provider: id }]);
  });
  return publicStatus(db, id);
}

export async function testCredential(db, id, deps) {
  const def = getCredential(id);
  if (!def?.test) throw new HttpError(404, 'Nothing to test for this credential');
  const r = await resolveCredential(db, id);
  if (r.state !== 'configured') return { ok: false, message: r.problem ?? 'Not configured yet.' };
  return def.test.run(r.values, deps);
}
