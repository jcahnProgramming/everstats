import { BlockList, isIP } from 'node:net';
import { networkInterfaces } from 'node:os';

/**
 * The visitor's network, the key every rate limit counts against.
 *
 * Behind the Cloudflare tunnel every request's socket comes from cloudflared, so the socket address is the same for
 * everyone; the visitor's address is the CF-Connecting-IP header, which Cloudflare's edge sets on every request it
 * proxies (overwriting any value the visitor sent). Requests that don't come through the tunnel (the LAN port, local
 * dev) don't have a trustworthy one, so:
 *
 *   - TRUSTED_PROXIES set (IPs or CIDRs, comma-separated: where cloudflared's connections come from as the container
 *     sees them): the header is honoured only on connections from those addresses. Everything else is keyed by its
 *     own socket address, header or not.
 *   - TRUSTED_PROXIES unset: the header is honoured from any connection. Safe from the internet (port 3260 is reachable
 *     only through the tunnel), but a device on the LAN could send its own header to dodge a limit.
 *   - No usable header: the socket address. Never one shared bucket for the tunnel: tunnel traffic always has it.
 *
 * IPv6 addresses are grouped by /64 (one home or one server gets at least that many), IPv4 per address.
 */
export function createNetworkResolver({ trustedProxies = process.env.TRUSTED_PROXIES, onHeader } = {}) {
  const trusted = parseTrusted(trustedProxies);
  // One answer per request: the app's every-request pass and a route's rate limiter both ask, and the header source
  // must be counted once.
  const answered = new WeakMap();
  return function networkOf(req) {
    if (answered.has(req)) return answered.get(req);
    const network = resolve(req);
    answered.set(req, network);
    return network;
  };
  function resolve(req) {
    const socket = cleanIp(req.socket?.remoteAddress);
    const header = req.headers['cf-connecting-ip'];
    const fromHeader = typeof header === 'string' ? cleanIp(header.trim()) : null;
    const honour = Boolean(fromHeader && (!trusted || (socket && trusted.check(socket, isIP(socket) === 6 ? 'ipv6' : 'ipv4'))));
    if (fromHeader && onHeader) onHeader(socket, honour, Boolean(trusted));
    return groupOf(honour ? fromHeader : socket) ?? 'unknown';
  }
}

/**
 * onHeader for createNetworkResolver: logs each connection address the header arrives from, once, and whether it was
 * honoured. It is how TRUSTED_PROXIES is found (open the site through the tunnel, then
 * `docker logs everstats 2>&1 | grep CF-Connecting-IP`, or read the admin page) and how a wrong one shows up (every
 * tunnel visitor sharing one bucket would otherwise be silent). It never logs or keeps the header's value (a
 * visitor's address), only the address of the connection that carried it. At most `max` addresses are remembered,
 * in memory: a restart starts the list again.
 *
 * The app runs the resolver on EVERY request (app.js), not only on rate-limited routes: in 0.1.0 it ran only inside
 * the limiters, so an ordinary page load through the tunnel logged nothing.
 *
 * The returned function has .sources(): [{ address, honoured, firstSeenAt, lastSeenAt, requests }] for the admin page.
 */
export function logHeaderSources({ log = console, max = 32, now = Date.now } = {}) {
  const seen = new Map();
  const observe = (socket, honoured, restricted) => {
    const key = `${socket}|${honoured}`;
    const known = seen.get(key);
    if (known) {
      known.lastSeenAt = new Date(now()).toISOString();
      known.requests += 1;
      return;
    }
    if (seen.size >= max) return;
    const at = new Date(now()).toISOString();
    seen.set(key, { address: socket, honoured, firstSeenAt: at, lastSeenAt: at, requests: 1 });
    const from = socket ?? 'an unknown address';
    if (honoured) {
      log.log(`[web] CF-Connecting-IP arrived on a connection from ${from}: honoured (${restricted ? 'in TRUSTED_PROXIES' : 'TRUSTED_PROXIES not set'})`);
    } else {
      log.warn(`[web] CF-Connecting-IP arrived on a connection from ${from}: IGNORED, not in TRUSTED_PROXIES. Those requests are rate-limited as ${from}. If this is cloudflared, add it to TRUSTED_PROXIES.`);
    }
  };
  observe.sources = () => [...seen.values()].map((s) => ({ ...s }));
  return observe;
}

/** The configured TRUSTED_PROXIES entries, as written (for the admin page), or null when unset. */
export function trustedProxyEntries(trustedProxies = process.env.TRUSTED_PROXIES) {
  const entries = String(trustedProxies ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  return entries.length ? entries : null;
}

/** Describes the mode for the start-up log (no addresses). */
export function describeTrust(trustedProxies = process.env.TRUSTED_PROXIES) {
  return parseTrusted(trustedProxies)
    ? 'CF-Connecting-IP honoured only from TRUSTED_PROXIES'
    : 'CF-Connecting-IP honoured from any connection (TRUSTED_PROXIES not set)';
}

function parseTrusted(value) {
  const entries = String(value ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!entries.length) return null;
  const list = new BlockList();
  for (const entry of entries) {
    const [address, bits] = entry.split('/');
    const ip = cleanIp(address);
    if (!ip) throw new Error('TRUSTED_PROXIES has an entry that is not an IP address or CIDR');
    const family = isIP(ip) === 6 ? 'ipv6' : 'ipv4';
    if (bits === undefined) list.addAddress(ip, family);
    else list.addSubnet(ip, Number(bits), family);
  }
  return list;
}

// "::ffff:1.2.3.4" (IPv4 on a dual-stack socket) → "1.2.3.4". Anything that isn't an IP → null.
function cleanIp(value) {
  if (typeof value !== 'string') return null;
  const v = value.startsWith('::ffff:') && isIP(value.slice(7)) === 4 ? value.slice(7) : value;
  return isIP(v) ? v.toLowerCase() : null;
}

function groupOf(ip) {
  if (!ip) return null;
  if (isIP(ip) === 4) return ip;
  return `${expandV6(ip).slice(0, 4).join(':')}::/64`;
}

function expandV6(ip) {
  const [head, tail = ''] = ip.split('::');
  const a = head ? head.split(':') : [];
  const b = tail ? tail.split(':') : [];
  // An embedded IPv4 tail ("::1.2.3.4") counts as two groups; only the first four groups matter here.
  const fill = Array(Math.max(0, 8 - a.length - b.length)).fill('0');
  return [...a, ...fill, ...b].map((g) => (g.includes('.') ? g : g.replace(/^0+(?=.)/, '')));
}

/**
 * 0.4.1: is any TRUSTED_PROXIES entry inside the container's own network? cloudflared's connections arrive from the
 * Docker network's gateway, which is inside that network's subnet. If TRUSTED_PROXIES is set but none of it is, the
 * network was probably recreated on another subnet (docker-compose.yml now pins it): CF-Connecting-IP is then
 * silently ignored and every visitor shares one rate-limit bucket. Checked at start-up (index.js logs it) and shown on
 * the admin page.
 *   → { state: 'unset' | 'ok' | 'outside', networks: ['10.213.47.0/24', …] }
 */
export function trustedProxyCheck(trustedProxies = process.env.TRUSTED_PROXIES, interfaces = networkInterfaces()) {
  const entries = trustedProxyEntries(trustedProxies);
  const nets = [];
  for (const list of Object.values(interfaces ?? {})) {
    for (const i of list ?? []) {
      if (i.internal || !i.cidr) continue;
      nets.push({ cidr: i.cidr, family: i.family === 'IPv6' || i.family === 6 ? 'ipv6' : 'ipv4' });
    }
  }
  const networks = nets.map((n) => n.cidr);
  if (!entries) return { state: 'unset', networks };
  const own = new BlockList();
  for (const n of nets) {
    const [address, bits] = n.cidr.split('/');
    own.addSubnet(address, Number(bits), n.family);
  }
  const inside = entries.some((entry) => {
    const ip = cleanIp(entry.split('/')[0]);
    return ip && own.check(ip, isIP(ip) === 6 ? 'ipv6' : 'ipv4');
  });
  return { state: inside ? 'ok' : 'outside', networks };
}
