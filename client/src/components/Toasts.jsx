import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '../chrome/Icon.jsx';

/**
 * Toasts (design/v1/components/toasts.md): feedback for async actions (saved, copied, linked).
 *
 *   const toast = useToast(); toast({ kind: 'ok', title: 'Theme saved', body: 'Horde applies on every device.' })
 *
 * kind: info (accent gem) | ok | warn | err. Info and ok dismiss after 5 s (paused while hovered); errors stay
 * until dismissed. They never take focus. Errors that belong to a form are shown in the form, not here.
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
    const timer = setTimeout(() => done.current(), AUTO_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [sticky, paused]);
  const cls = { ok: 'ok', warn: 'warn', err: 'err' }[toast.kind] ?? '';
  return (
    <div className={`toast ${cls}`} role={sticky ? 'alert' : 'status'} onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}>
      <span className="gemtag" aria-hidden="true" />
      <div className="body">
        <b>{toast.title}</b>
        {toast.body && <span>{toast.body}</span>}
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
