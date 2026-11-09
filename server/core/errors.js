/**
 * HttpError: an expected refusal. Its message is written by this app, never contains a value from the request, and
 * goes back to the browser as { error, code }.
 */
export class HttpError extends Error {
  constructor(status, message, code = undefined, details = undefined) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

/** Wraps an async route so a rejection reaches the error handler. (Express 5 does this itself; kept explicit.) */
export const route = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/**
 * Express error handler for both processes. It never puts an error's message into a log line: a JSON parse error
 * quotes the request body, and a request body can be a credential being saved. Expected errors (status < 500) go
 * back to the client. Unexpected ones log only their name, code and stack locations, and the path without its query
 * (OAuth callbacks carry codes in the query).
 */
export const loggablePath = (url) => String(url ?? '').split('?')[0].slice(0, 200);

export function createErrorHandler(processName) {
  // eslint-disable-next-line no-unused-vars
  return (err, req, res, _next) => {
    if (res.headersSent) return;
    if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: "The request body isn't valid JSON" });
    if (err?.type === 'entity.too.large') return res.status(413).json({ error: 'The request body is too large' });
    const status = Number.isInteger(err?.status) ? err.status : 500;
    if (status < 500) return res.status(status).json({ error: err.message, code: err.code, ...(err.details ?? {}) });
    const frames = String(err?.stack ?? '').split('\n').slice(1, 6).join('\n');
    console.error(`[${processName}] ${req.method} ${loggablePath(req.originalUrl)} failed: ${err?.name ?? 'Error'}${err?.code ? ` (${err.code})` : ''}\n${frames}`);
    res.status(500).json({ error: 'Something went wrong on our side.' });
  };
}
