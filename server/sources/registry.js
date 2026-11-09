import { resolveCredential } from '../credentials/store.js';
import { SourceError, createBlizzardSource } from './blizzard.js';

/**
 * The data-source registry: everything Everstats reads game data from declares itself here. Callers (discovery now,
 * the crawler later) open a source by id and use its get(); none of them knows how a source authenticates.
 *
 *   id            stable name
 *   label         what the admin sees
 *   credential    the credentials/registry.js id holding its keys
 *   userProvider  the sign-in provider (auth/providers.js) whose user token reads account-scoped endpoints, or null
 *   create(values, opts) → { get(pathOrHref, { namespace, auth, userToken, query }), … }
 */
export const SOURCES = [
  {
    id: 'blizzard',
    label: 'Blizzard Battle.net API',
    credential: 'blizzard',
    userProvider: 'battlenet',
    create: (values, opts) => createBlizzardSource({ clientId: values.clientId, clientSecret: values.clientSecret, ...opts }),
  },
];

const byId = new Map(SOURCES.map((s) => [s.id, s]));
export const getSource = (id) => byId.get(id) ?? null;

/** Opens a source with its stored keys. Throws SourceError('not_configured') when they aren't set. */
export async function openSource(db, id, opts = {}) {
  const def = getSource(id);
  if (!def) throw new Error(`unknown source ${id}`);
  const cred = await resolveCredential(db, def.credential);
  if (cred.state !== 'configured') throw new SourceError(`${def.label}: keys not configured (${cred.state})`, 'not_configured');
  return def.create(cred.values, opts);
}
