// Prints new secret lines for .env. It never writes .env: add the lines yourself.
//   EVERSTATS_ROOT_KEY  encrypts every credential and 2FA secret in the database. Back it up somewhere safe: losing
//                       or changing it makes all of them unreadable (keys must be re-entered, 2FA re-enrolled).
//   POSTGRES_PASSWORD   the database password (docker-compose.yml). URL-safe, so it can go in DATABASE_URL as is.
import { randomBytes } from 'node:crypto';

const want = process.argv[2];
if (!want || want === 'root') console.log(`EVERSTATS_ROOT_KEY=${randomBytes(32).toString('base64')}`);
if (!want || want === 'postgres') console.log(`POSTGRES_PASSWORD=${randomBytes(24).toString('base64url')}`);
