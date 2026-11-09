/**
 * JSON calls to this app's own API. Same origin only: the browser adds the Origin header the server's CSRF check
 * needs, and the session cookie (httpOnly: page script never sees it).
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

export async function api(path, { method = 'GET', body } = {}) {
  let res;
  try {
    res = await fetch(path, {
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
