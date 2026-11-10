import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '../../chrome/Icon.jsx';

/**
 * ONE refresh system for every admin page (0.10.3, design/v5-admin README "The refresh system"; components/refresh-control.md).
 *
 *   usePanel(key, load, deps)   a panel's data. The shell's Refresh and auto-refresh reload every registered panel; a
 *                               panel never has its own refresh button, unless it runs on its own clock
 *                               (usePanel(…, { everyMs }): Worker jobs, "Live · own 5 s clock").
 *   <Panel panel={p} title=…>   the .ap box: its own "Updated 12 s ago" stamp, "Updating…" with a progress line along the
 *                               top and its body dimmed while it reloads (the layout never moves), a red edge and an inline
 *                               error with Retry that keeps its height when it fails (never blank, other panels stay
 *                               live), and a warning edge with "Stale · N min old" when its last good data is old.
 *   useRefreshState()           what the top bar shows: idle / refreshing / partly failed / stale.
 *
 * Admin actions (Grade everyone now, Re-analyse, Save…) use useAction (actions.jsx): working → done → result, in place.
 */
export const STALE_MS = 5 * 60 * 1000;

// Two contexts: the actions (register / report / refreshAll) never change, so a panel's effects never re-run when any
// panel's state changes; the state (for the top bar and the stamps) changes as often as it likes. One context for both
// looped: a report changed the value, which re-registered every panel, whose cleanup removed its state, re-reported…
const RefreshActions = createContext(null);
const RefreshState = createContext(null);

export function RefreshProvider({ children, autoSeconds = 0 }) {
  const panels = useRef(new Map()); // key → { reload, everyMs }
  const [states, setStates] = useState({}); // key → { loading, failed, lastGood }
  const [now, setNow] = useState(() => Date.now());
  const [lastRun, setLastRun] = useState(null);

  // A clock for the stamps ("12 s ago"): every 5 s is enough and costs nothing.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 5000);
    return () => {
      clearInterval(t);
    };
  }, []);

  const register = useCallback((key, entry) => {
    panels.current.set(key, entry);
    return () => {
      panels.current.delete(key);
      setStates((s) => {
        if (!(key in s)) return s;
        const next = { ...s };
        delete next[key];
        return next;
      });
    };
  }, []);

  const report = useCallback((key, st) => {
    setStates((s) => {
      const was = s[key];
      if (was && was.loading === st.loading && was.failed === st.failed && was.lastGood === st.lastGood) return s;
      return { ...s, [key]: st };
    });
  }, []);

  const refreshAll = useCallback(async () => {
    const list = [...panels.current.values()].filter((p) => !p.everyMs);
    await Promise.allSettled(list.map((p) => p.reload()));
    setLastRun(Date.now());
  }, []);

  // Auto-refresh (remembered per admin, chosen in the top bar). Paused while the tab is hidden.
  useEffect(() => {
    if (!autoSeconds) return undefined;
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') refreshAll();
    }, autoSeconds * 1000);
    return () => {
      clearInterval(t);
    };
  }, [autoSeconds, refreshAll]);

  const actions = useMemo(() => ({ register, report, refreshAll }), [register, report, refreshAll]);
  const state = useMemo(() => ({ states, now, lastRun }), [states, now, lastRun]);
  return (
    <RefreshActions.Provider value={actions}>
      <RefreshState.Provider value={state}>{children}</RefreshState.Provider>
    </RefreshActions.Provider>
  );
}

/** The page refresh: { refreshAll, lastRun } (the shell's Refresh button and the sidebar counts). */
export function useRefresh() {
  const a = useContext(RefreshActions);
  const st = useContext(RefreshState);
  return a ? { refreshAll: a.refreshAll, lastRun: st?.lastRun ?? null } : null;
}

/** The top bar's view: idle, refreshing, partly failed or stale. */
export function useRefreshState() {
  const ctx = useContext(RefreshState);
  const list = Object.values(ctx?.states ?? {});
  const now = ctx?.now ?? Date.now();
  const busy = list.some((s) => s.loading);
  const failed = list.filter((s) => s.failed).length;
  const goods = list.map((s) => s.lastGood).filter(Boolean);
  const newest = goods.length ? Math.max(...goods) : null;
  const oldest = goods.length ? Math.min(...goods) : null;
  const stale = oldest !== null && now - oldest > STALE_MS;
  return { busy, failed, newest, oldest, stale, now, panels: list.length };
}

/**
 * A panel's data. `load` returns a promise of the data; it reloads when `deps` change, on the shell's Refresh and
 * auto-refresh, and on Retry. Keeps the last good data while reloading or after a failure, so nothing blanks.
 * opts.everyMs: this panel runs on its own clock and is left out of the page refresh.
 */
export function usePanel(key, load, deps = [], { everyMs = 0 } = {}) {
  const ctx = useContext(RefreshActions);
  const clock = useContext(RefreshState);
  const [data, setData] = useState(undefined);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [lastGood, setLastGood] = useState(null);
  const seq = useRef(0);
  const loadRef = useRef(load);
  loadRef.current = load;

  const reload = useCallback(async () => {
    const mine = ++seq.current;
    setLoading(true);
    try {
      const d = await loadRef.current();
      if (mine !== seq.current) return;
      setData(d);
      setError(null);
      setLastGood(Date.now());
    } catch (err) {
      if (mine !== seq.current) return;
      setError(err);
    } finally {
      if (mine === seq.current) setLoading(false);
    }
  }, []);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    reload();
  }, deps);

  useEffect(() => ctx?.register(key, { reload, everyMs }), [ctx, key, reload, everyMs]);

  useEffect(() => {
    ctx?.report(key, { loading, failed: Boolean(error), lastGood });
  }, [ctx, key, loading, error, lastGood]);

  useEffect(() => {
    if (!everyMs) return undefined;
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') reload();
    }, everyMs);
    return () => {
      clearInterval(t);
    };
  }, [everyMs, reload]);

  return { key, data, error, loading, lastGood, reload, setData, everyMs, now: clock?.now ?? Date.now() };
}

export function ago(ms, now = Date.now()) {
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 60) return `${s} s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return `${h} h ago`;
}

/** Plain words for an error: what failed and why. */
export function errorWords(err) {
  if (!err) return '';
  if (err.status === 0 || err.code === 'offline') return 'Couldn’t reach Everstats.';
  if (err.status === 404) return 'The admin session has ended, or this isn’t there any more.';
  if (err.status >= 500) return `The server answered ${err.status}. ${err.message ?? ''}`.trim();
  return err.message ?? 'Something went wrong.';
}

/**
 * The .ap panel. children: (data) => content, rendered whenever there is data (old data stays while reloading or after
 * a failure). ghostRows: how many skeleton rows to show before the first data or under an error with nothing to show.
 */
export function Panel({ panel, title, id, sub = null, actions = null, footer = null, className = '', flush = false, ghostRows = 4, children, as: Tag = 'section', live = null }) {
  const { data, error, loading, lastGood, reload, everyMs, now } = panel;
  const body = useRef(null);
  const [minH, setMinH] = useState(null);
  const stale = !error && lastGood !== null && now - lastGood > STALE_MS;
  // Keep the panel's height when it fails or reloads, so nothing jumps.
  useLayoutEffect(() => {
    if (!error && !loading && body.current) setMinH(body.current.offsetHeight);
  }, [error, loading, data]);
  const cls = ['ap', className, loading && data !== undefined ? 'is-loading' : '', error ? 'is-error' : '', stale ? 'is-stale' : ''].filter(Boolean).join(' ');
  const hid = id ? `${id}-h` : undefined;
  const stamp = loading ? (data === undefined ? 'Loading…' : 'Updating…') : error ? 'Update failed' : lastGood ? `Updated ${ago(lastGood, now)}` : '';
  return (
    <Tag className={cls} id={id} aria-labelledby={hid} aria-busy={loading || undefined}>
      <div className="pbar" aria-hidden="true"><i /></div>
      <div className="hd">
        <h2 id={hid}>{title}</h2>
        {sub}
        <span className="spacer" />
        {stale && <span className="chip warn"><Icon name="warning" />Stale · {ago(lastGood, now).replace(' ago', '')} old</span>}
        {everyMs ? <span className="chip info"><Icon name="refresh" />{live ?? `Live · own ${Math.round(everyMs / 1000)} s clock`}</span> : null}
        {actions}
        <span className="stamp" aria-live="polite">{stamp}</span>
      </div>
      <div className={`bd${flush ? ' flush' : ''}`} ref={body} style={error && minH ? { minHeight: minH } : undefined}>
        {error && (
          <div className="perr" role="alert">
            <Icon name="error" />
            <span><b>Couldn’t update {title}.</b> {errorWords(error)}{lastGood ? ` Showing what loaded ${ago(lastGood, now)}.` : ''}</span>
            <span className="spacer" />
            <button type="button" className="btn sm" onClick={reload}><Icon name="refresh" size="sm" />Retry</button>
          </div>
        )}
        {data !== undefined ? children(data) : <div className="ghostrows" aria-hidden="true">{Array.from({ length: ghostRows }, (_, i) => <i key={i} />)}</div>}
      </div>
      {footer && data !== undefined && <div className="ft">{typeof footer === 'function' ? footer(data) : footer}</div>}
    </Tag>
  );
}
