import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { APP_VERSION } from '../release.js';
import { Icon } from './Icon.jsx';
import { editingNow, routeChanged, serverVersion } from './updates.js';

/**
 * The "Everstats was updated" bar (0.8.2; the rules are in updates.js). Checks the server's version on route changes
 * (at most once a minute), when the tab comes back into view, and every 5 minutes. When it differs from this bundle's:
 *   - a small bar under the top bar: "Everstats was updated. Refresh" (non-blocking, no dismiss: it stays honest)
 *   - the next route change reloads the page it lands on, unless something is being edited; then only the bar shows,
 *     and the route change after that tries again.
 */
const EVERY_MS = 5 * 60 * 1000;
const ROUTE_MIN_GAP_MS = 60 * 1000;

export function UpdateBar() {
  const { pathname } = useLocation();
  const [newer, setNewer] = useState(null);
  const lastCheck = useRef(0);
  const first = useRef(true);

  const check = async () => {
    lastCheck.current = Date.now();
    const v = await serverVersion();
    if (v && v !== APP_VERSION) setNewer(v);
    return v;
  };

  useEffect(() => {
    check();
    const timer = setInterval(check, EVERY_MS);
    // 'focus' and 'visibilitychange' often arrive together: one check is enough.
    const onVisible = () => {
      if (document.visibilityState === 'visible' && Date.now() - lastCheck.current > 10_000) check();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // A route change: reload into the new version if one is known and nothing is being edited; else check (throttled).
  useEffect(() => {
    if (first.current) {
      first.current = false;
      routeChanged();
      return;
    }
    const busy = editingNow();
    routeChanged();
    if (newer && !busy) {
      window.location.reload();
      return;
    }
    if (Date.now() - lastCheck.current > ROUTE_MIN_GAP_MS) check();
  }, [pathname]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!newer) return null;
  return (
    <div className="update-bar" role="status">
      <div className="wrap in">
        <Icon name="refresh" size="sm" />
        <span className="flex-fill">Everstats was updated.</span>
        <button type="button" className="btn sm gold" onClick={() => window.location.reload()}>Refresh</button>
      </div>
    </div>
  );
}
