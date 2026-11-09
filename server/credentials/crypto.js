import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from 'node:crypto';

/**
 * Encryption at rest (from home-dashboard): AES-256-GCM, a fresh 12-byte IV per value, and the value's slot name
 * ("blizzard.clientSecret", "totp.42") bound in as associated data, so a ciphertext copied into another slot fails
 * instead of decrypting as something else.
 *
 * The root key is EVERSTATS_ROOT_KEY in .env (32 bytes, base64; `npm run gen-key` prints one). It is read on every
 * call, so nothing caches it. Each sealed value records a fingerprint of the key that sealed it, so a changed key is
 * reported as "key changed" rather than as damage. Changing the key makes every stored credential and 2FA secret
 * unreadable: CLAUDE.md, "Credentials".
 */
const ALGORITHM = 'aes-256-gcm';
const AAD_PREFIX = 'everstats:';

export class DecryptError extends Error {
  /** @param {'key_changed' | 'damaged'} reason */
  constructor(reason) {
    super(reason === 'key_changed' ? "can't decrypt: the root key changed" : "can't decrypt: the stored value is damaged");
    this.name = 'DecryptError';
    this.reason = reason;
  }
}

export function rootKey() {
  const key = Buffer.from((process.env.EVERSTATS_ROOT_KEY ?? '').trim(), 'base64');
  if (key.length !== 32) throw new Error('EVERSTATS_ROOT_KEY is missing or not 32 bytes of base64');
  return key;
}

/** Stops a process at start-up when the root key is unusable, with a message that says how to fix it. */
export function requireRootKey(processName) {
  try {
    rootKey();
  } catch {
    console.error(`[${processName}] EVERSTATS_ROOT_KEY is missing or not 32 bytes of base64. Run \`npm run gen-key\` and add the line it prints to .env by hand.`);
    process.exit(1);
  }
}

export function keyFingerprint(key = rootKey()) {
  return createHmac('sha256', key).update('everstats key fingerprint v1').digest('hex').slice(0, 16);
}

const aad = (slot) => Buffer.from(AAD_PREFIX + slot, 'utf8');

export function seal(slot, plaintext) {
  const key = rootKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  cipher.setAAD(aad(slot));
  const ciphertext = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  return { ciphertext, iv, authTag: cipher.getAuthTag(), keyFp: keyFingerprint(key) };
}

export function open(slot, { ciphertext, iv, authTag, keyFp }) {
  const key = rootKey();
  if (keyFp !== keyFingerprint(key)) throw new DecryptError('key_changed');
  try {
    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAAD(aad(slot));
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  } catch {
    throw new DecryptError('damaged');
  }
}

/** HMAC under a key derived from the root key: for values that are only ever compared (recovery codes). */
export function keyedHash(label, value) {
  const sub = createHmac('sha256', rootKey()).update(`everstats subkey: ${label}`).digest();
  return createHmac('sha256', sub).update(String(value), 'utf8').digest('hex');
}

export const sha256Hex = (value) => createHash('sha256').update(String(value), 'utf8').digest('hex');

/** A random token for a cookie or link: 32 bytes, base64url. Only its sha256Hex is ever stored. */
export const newToken = () => randomBytes(32).toString('base64url');
