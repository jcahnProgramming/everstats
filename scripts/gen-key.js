// Prints new secret lines for .env. It never writes .env: add the lines yourself.
//   EVERSTATS_ROOT_KEY  encrypts every credential and 2FA secret in the database. Back it up somewhere safe: losing
//                       or changing it makes all of them unreadable (keys must be re-entered, 2FA re-enrolled).
//   POSTGRES_PASSWORD   the database password (docker-compose.yml). URL-safe, so it can go in DATABASE_URL as is.
//   DEV_TESTER_SECRET   0.10.3, only with `devtester`: the shared secret the dev site uses to ask production "does this
//                       sign-in hold Dev Tester?" (server/devgate/). The SAME value goes in production's .env and dev's
//                       (RELEASING.md). Not printed without the argument: each run makes a new one.
import { randomBytes } from 'node:crypto';

const want = process.argv[2];
if (!want || want === 'root') console.log(`EVERSTATS_ROOT_KEY=${randomBytes(32).toString('base64')}`);
if (!want || want === 'postgres') console.log(`POSTGRES_PASSWORD=${randomBytes(24).toString('base64url')}`);
if (want === 'devtester') console.log(`DEV_TESTER_SECRET=${randomBytes(32).toString('base64url')}`);
