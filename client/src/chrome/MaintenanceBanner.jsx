import { useEffect, useState } from 'react';
import { Icon } from './Icon.jsx';
import { formatDateTime } from '../format.js';

/**
 * The maintenance banner (0.10.3): an optional notice the admin sets on Release tools, shown to everyone at the top of
 * every page, only while now is inside its start..end (GET /api/maintenance answers null otherwise). Off by default.
 * Plain text: rendered as text, never as markup or a link. Asked once per page load and again every 5 minutes, and it
 * hides itself the moment its end passes. Not dismissible: it is about the site being unavailable, and it is short.
 *
 * <MaintenanceNotice> is the strip itself, also used as the admin's preview, so the preview is exactly what players see.
 */
const RECHECK_MS = 5 * 60 * 1000;

export function MaintenanceNotice({ text, end = null }) {
  return (
    <div className="maint-banner" role="status">
      <div className="wrap maint-banner-in">
        <Icon name="warning" size="sm" />
        <span className="maint-banner-text">{text}</span>
        {end && <span className="maint-banner-until">Until {formatDateTime(end)}</span>}
      </div>
    </div>
  );
}

export function MaintenanceBanner() {
  const [banner, setBanner] = useState(null);
  const [, setTick] = useState(0);

  useEffect(() => {
    let alive = true;
    const load = () => {
      fetch('/api/maintenance', { credentials: 'same-origin' })
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => {
          if (alive) setBanner(j?.banner ?? null);
        })
        .catch(() => {});
    };
    load();
    const t = setInterval(load, RECHECK_MS);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  // Hide at its end without waiting for the next check.
  useEffect(() => {
    if (!banner?.end) return undefined;
    const ms = Date.parse(banner.end) - Date.now();
    if (!(ms > 0) || ms > 2 ** 31 - 1) return undefined;
    const t = setTimeout(() => setTick((n) => n + 1), ms + 50);
    return () => {
      clearTimeout(t);
    };
  }, [banner]);

  if (!banner?.text) return null;
  if (banner.end && Date.now() >= Date.parse(banner.end)) return null;
  return <MaintenanceNotice text={banner.text} end={banner.end} />;
}
