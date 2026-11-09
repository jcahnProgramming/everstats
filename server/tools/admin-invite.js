// Prints a one-time admin enrolment link (valid 15 minutes): open it and register a passkey, and that passkey can
// sign in to the admin area. Run it where the database is, e.g. on the server:
//   docker exec -it everstats node server/tools/admin-invite.js
// The link carries the invite in its #fragment, so it never reaches a server log. Only its hash is stored.
import { config } from '../core/config.js';
import { createDb } from '../core/db.js';
import { newToken, sha256Hex } from '../credentials/crypto.js';

const db = createDb({ max: 1 });
try {
  const token = newToken();
  await db.query(`INSERT INTO admin_invites (token_hash, expires_at) VALUES ($1, now() + interval '15 minutes')`, [sha256Hex(token)]);
  console.log(`One-time admin enrolment link (15 minutes):\n${config.publicOrigin}/admin/enroll#invite=${token}`);
} finally {
  await db.close();
}
