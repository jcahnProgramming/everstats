// Prints a one-time admin enrolment link (valid 15 minutes): open it and register a passkey, and that passkey can
// sign in to the admin area. Run it where the database is, e.g. on the server:
//   docker exec -it everstats node server/tools/admin-invite.js
// The link carries the invite in its #fragment, so it never reaches a server log. Only its hash is stored.
//   dev site (0.10.2): docker exec -it everstats-dev node server/tools/admin-invite.js
import { config } from '../core/config.js';
import { createDb } from '../core/db.js';
import { assertEnvironment, ENVIRONMENT, ENVIRONMENTS } from '../core/environment.js';
import { checkEnvironmentMarker } from '../core/prepare.js';
import { newToken, sha256Hex } from '../credentials/crypto.js';

// 0.10.2: an invite is only ever written into this environment's own database.
assertEnvironment('admin-invite');
const db = createDb({ max: 1 });
try {
  const deployed = process.env.NODE_ENV === 'production';
  await db.withClient((q) => checkEnvironmentMarker(q, deployed ? ENVIRONMENT : ENVIRONMENTS.local, { deployed }));
  const token = newToken();
  await db.query(`INSERT INTO admin_invites (token_hash, expires_at) VALUES ($1, now() + interval '15 minutes')`, [sha256Hex(token)]);
  console.log(`One-time admin enrolment link (15 minutes):\n${config.publicOrigin}/admin/enroll#invite=${token}`);
} finally {
  await db.close();
}
