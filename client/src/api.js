import { scopedApi, versionOfLocation } from './scope.jsx';

/**
 * JSON calls to this app's own API. Same origin only: the browser adds the Origin header the server's CSRF check
 * needs, and the session cookie (httpOnly: page script never sees it).
 *
 * 0.11.1: a call about ONE game version (characters, guilds, leaderboards, tiers …) goes to that version's API:
 * /api/v/{version}/{region}/… for every version but the primary one (scope.jsx scopedApi). The version is the page's
 * own (from its address) unless the caller names one (`version`: pages that belong to no version, like home).
 *
 * Resolves to the parsed body; rejects with ApiError { status, code, message, retryAfterMs }.
 */
export class ApiError extends Error {
  constructor(status, body) {
    super(body?.error || `Request failed (${status})`);
    this.status = status;
    this.code = body?.code ?? null;
    this.retryAfterMs = body?.retryAfterMs ?? null;
  }
}

export async function api(path, { method = 'GET', body, version } = {}) {
  let res;
  try {
    res = await fetch(scopedApi(path, version === undefined ? versionOfLocation() : version), {
      method,
      credentials: 'same-origin',
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, { error: "Couldn't reach Everstats. Check your connection and try again.", code: 'offline' });
  }
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, json);
  return json;
}
