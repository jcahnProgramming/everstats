import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Icon } from '../chrome/Icon.jsx';
import { BadgeIcon } from '../badges/Badges.jsx';
import { GuildBadgeIcon } from '../guildBadges/GuildBadges.jsx';

/**
 * Toasts (design/v1/components/toasts.md): feedback for async actions (saved, copied, linked).
 *
 *   const toast = useToast(); toast({ kind: 'ok', title: 'Theme saved', body: 'Horde applies on every device.' })
 *
 * kind: info (accent gem) | ok | warn | err. Info and ok dismiss after 5 s (paused while hovered); errors stay
 * until dismissed. They never take focus. Errors that belong to a form are shown in the form, not here.
 *
 * 0.7.0, badge toasts (design/v2-badges/components/badge-toast.md): `badge` shows the badge (with the "new" glow) in
 * place of the gem (0.7.1: `guildBadge`, a guild badge, for the GM and officers), `ms` overrides the delay (earned and granted badges stay 8 s), `action` { to, label } adds a link.
 */
const ToastContext = createContext(() => {});
const AUTO_MS = 5000;
let nextId = 1;

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const dismiss = useCallback((id) => setToasts((list) => list.filter((t) => t.id !== id)), []);
  const push = useCallback((t) => {
    const id = nextId++;
    setToasts((list) => [...list.slice(-3), { kind: 'info', ...t, id }]);
    return id;
  }, []);
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="toasts" aria-live="polite">
        {toasts.map((t) => <Toast key={t.id} toast={t} onDismiss={() => dismiss(t.id)} />)}
      </div>
    </ToastContext.Provider>
  );
}

function Toast({ toast, onDismiss }) {
  const [paused, setPaused] = useState(false);
  const done = useRef(onDismiss);
  done.current = onDismiss;
  const sticky = toast.kind === 'err';
  useEffect(() => {
    if (sticky || paused) return undefined;
    const timer = setTimeout(() => done.current(), toast.ms ?? AUTO_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [sticky, paused, toast.ms]);
  const cls = { ok: 'ok', warn: 'warn', err: 'err' }[toast.kind] ?? '';
  return (
    <div className={`toast ${cls}${toast.badge ? ' badge-toast' : ''}${toast.guildBadge ? ' gbadge-toast' : ''}`} role={sticky ? 'alert' : 'status'} onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}>
      {toast.guildBadge ? <GuildBadgeIcon badge={toast.guildBadge} isNew={toast.kind !== 'warn'} state={toast.kind === 'warn' ? 'lost' : null} />
        : toast.badge ? <BadgeIcon badge={toast.badge} isNew={toast.kind !== 'warn'} locked={toast.kind === 'warn'} /> : <span className="gemtag" aria-hidden="true" />}
      <div className="body">
        <b>{toast.title}</b>
        {(toast.body || toast.action) && (
          <span>
            {toast.body}
            {toast.action && <>{toast.body ? ' ' : ''}<Link to={toast.action.to} onClick={onDismiss}>{toast.action.label}</Link></>}
          </span>
        )}
      </div>
      <button type="button" className="btn ghost sm icon x" aria-label="Dismiss" onClick={onDismiss}>
        <Icon name="close" size="sm" />
      </button>
    </div>
  );
}

export const useToast = () => useContext(ToastContext);

/** Memoised helpers for the common cases. */
export function useToasts() {
  const push = useToast();
  return useMemo(() => ({
    ok: (title, body) => push({ kind: 'ok', title, body }),
    info: (title, body) => push({ kind: 'info', title, body }),
    warn: (title, body) => push({ kind: 'warn', title, body }),
    err: (title, body) => push({ kind: 'err', title, body }),
  }), [push]);
}
