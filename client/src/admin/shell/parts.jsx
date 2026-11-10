import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Icon } from '../../chrome/Icon.jsx';
import { Modal } from '../../components/Controls.jsx';
import { useScope } from './scope.jsx';

/**
 * The v5 admin's shared parts (design/v5-admin/components). Every admin page builds from these, so the pages look and
 * behave alike:
 *
 *   <PageHead title desc crumbs tabs actions>   the .ahead block: breadcrumbs, h1, a one-line description, tab links
 *   <Chip kind icon>                            status chip: icon + text + colour, always all three (status-chip.md)
 *   <ScopeChip />                               "All versions" / "WoW Forever · US" on a card or panel
 *   <Empty icon title>                          .aempty: an honest empty or error state inside a panel
 *   <ConfirmDialog …>                           a question, what happens, whether players see it, the affected list, a
 *                                               required reason (audit-logged), an optional acknowledgement (confirm-dialog.md)
 *   useAction() + <ActionButton> + <ActionStatus>   an admin action shows working → done → result IN PLACE
 *   useHit()                                    the row a settings-search result points at gets .is-hit and is scrolled to
 *   <ScopedLink>                                a Link that keeps ?v=&r=
 */

const CHIP_ICONS = { ok: 'check-circle', warn: 'warning', err: 'x-circle', off: 'no-coverage', info: 'info', run: 'refresh', vis: 'eye', scope: 'globe' };

export function Chip({ kind = 'info', icon = null, children, title = undefined }) {
  return <span className={`chip ${kind}`} title={title}><Icon name={icon ?? CHIP_ICONS[kind] ?? 'info'} />{children}</span>;
}

/** The version scope of a card or panel: the switcher's choice, or "All versions" for global data. */
export function ScopeChip({ global = false }) {
  const { versionName, region } = useScope();
  return <Chip kind="scope" icon="globe">{global ? 'All versions' : `${versionName} · ${region.toUpperCase()}`}</Chip>;
}

export function ScopedLink({ to, children, ...rest }) {
  const { query } = useScope();
  const [path, hash = ''] = String(to).split('#');
  const sep = path.includes('?') ? '&' : '?';
  return <Link to={`${path}${query ? `${sep}${query}` : ''}${hash ? `#${hash}` : ''}`} {...rest}>{children}</Link>;
}

export function PageHead({ title, desc = null, crumbs = null, tabs = null, actions = null, chips = null }) {
  return (
    <div className="ahead">
      {crumbs && (
        <nav className="crumbs" aria-label="Breadcrumb">
          {crumbs.map((c, i) => (
            <span key={c.label} className="row gap-6">
              {i > 0 && <span aria-hidden="true">›</span>}
              {c.to ? <Link to={c.to}>{c.label}</Link> : <span>{c.label}</span>}
            </span>
          ))}
        </nav>
      )}
      <div className="row1">
        <h1 tabIndex={-1} data-admin-heading="">{title}</h1>
        {chips}
        {actions && <><span className="spacer" />{actions}</>}
      </div>
      {desc && <p className="desc">{desc}</p>}
      {tabs && <AdminTabs tabs={tabs} />}
    </div>
  );
}

/** v1 .tabs where each tab is a link with its own address and an optional count (tab-switcher.md). */
export function AdminTabs({ tabs, label = 'Sections' }) {
  const { query } = useScope();
  const { pathname } = useLocation();
  return (
    <nav className="tabs" aria-label={label}>
      {tabs.map((t) => {
        const on = t.active ?? (t.prefix ? pathname.startsWith(t.to) : pathname === t.to);
        return (
          <Link key={t.to} role="tab" aria-selected={on} aria-current={on ? 'page' : undefined}
            to={`${t.to}${t.keepScope === false || !query ? '' : `?${query}`}`}>
            {t.label}{t.count ? <span className="count">{t.count}</span> : null}
          </Link>
        );
      })}
    </nav>
  );
}

export function Empty({ icon = 'info', title, children = null, action = null }) {
  return (
    <div className="aempty">
      <Icon name={icon} />
      <b>{title}</b>
      {children && <span className="small">{children}</span>}
      {action}
    </div>
  );
}

/**
 * Admin actions: working → done → result, shown where the button is. Never "nothing until a reload".
 *   const a = useAction();
 *   <ActionButton action={a} onRun={() => api(…)} done={(r) => `Queued: ${r.n}`}>Grade everyone now</ActionButton>
 *   <ActionStatus action={a} />
 */
export function useAction() {
  const [state, setState] = useState({ phase: 'idle', text: null, at: null });
  const mounted = useRef(true);
  useEffect(() => () => {
    mounted.current = false;
  }, []);
  const run = useCallback(async (fn, { done = null, working = 'Working…' } = {}) => {
    setState({ phase: 'working', text: working, at: Date.now() });
    try {
      const r = await fn();
      const text = typeof done === 'function' ? done(r) : done ?? 'Done';
      if (mounted.current) setState({ phase: 'done', text, at: Date.now() });
      return r;
    } catch (err) {
      if (mounted.current) setState({ phase: 'failed', text: err.message ?? 'Failed', at: Date.now(), error: err });
      return undefined;
    }
  }, []);
  const set = useCallback((phase, text) => setState({ phase, text, at: Date.now() }), []);
  const reset = useCallback(() => setState({ phase: 'idle', text: null, at: null }), []);
  return { ...state, run, set, reset, busy: state.phase === 'working' };
}

export function ActionButton({ action, onRun, done = null, working = 'Working…', className = 'btn sm', icon = null, children, disabled = false, ...rest }) {
  return (
    <button type="button" className={`${className}${action.busy ? ' is-loading' : ''}`} disabled={disabled || action.busy} aria-busy={action.busy || undefined}
      onClick={() => action.run(onRun, { done, working })} {...rest}>
      {icon ? <Icon name={icon} size="sm" /> : null}
      {children}
    </button>
  );
}

export function ActionStatus({ action, idle = null }) {
  if (action.phase === 'idle') return idle ? <span className="muted xsmall">{idle}</span> : null;
  const kind = action.phase === 'working' ? 'run' : action.phase === 'done' ? 'ok' : 'err';
  return <span role="status" aria-live="polite"><Chip kind={kind}>{action.text}</Chip></span>;
}

/**
 * Confirm dialog (confirm-dialog.md). `affected`: [{ name, fallback }]. The reason is required and goes to the audit
 * log; `ack` (text) adds a checkbox for changes players see. onConfirm(reason) may throw: the error shows in the dialog.
 */
export function ConfirmDialog({ title, what, playersSee = null, affected = [], confirmLabel, danger = true, ack = null, reasonLabel = 'Reason (saved to the audit log)', onConfirm, onClose, reasonRequired = true }) {
  const [reason, setReason] = useState('');
  const [acked, setAcked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState(null);
  const ok = (!reasonRequired || reason.trim().length >= 3) && (!ack || acked);
  const go = async () => {
    if (!ok) return;
    setBusy(true);
    setProblem(null);
    try {
      await onConfirm(reason.trim());
      onClose();
    } catch (err) {
      setProblem(err.message);
      setBusy(false);
    }
  };
  return (
    <Modal title={title} onClose={onClose} busy={busy}
      actions={(
        <>
          <button type="button" className="btn ghost" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className={`btn ${danger ? 'danger' : 'gold'}${busy ? ' is-loading' : ''}`} onClick={go} disabled={!ok || busy} aria-busy={busy || undefined}>
            {confirmLabel}
          </button>
        </>
      )}>
      <div className="stack gap-14 adlg-body">
        <p className="t2 small">{what}</p>
        {playersSee !== null && <Chip kind={playersSee ? 'vis' : 'off'}>{playersSee ? 'Players see this' : 'Admin and background only'}</Chip>}
        {affected.length > 0 && (
          <div className="stack gap-6">
            <span className="eyebrow">Also affected</span>
            <div className="affect">
              {affected.map((a) => <div key={a.name}><Icon name="warning" size="sm" /><span><b>{a.name}</b>{a.fallback ? ` — ${a.fallback}` : ''}</span></div>)}
            </div>
          </div>
        )}
        <label className="field">
          <span className="lab">{reasonLabel}{reasonRequired ? '' : ' (optional)'}</span>
          <textarea className="inp" value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} />
        </label>
        {ack && (
          <label className="check">
            <input type="checkbox" checked={acked} onChange={(e) => setAcked(e.target.checked)} />
            <span>{ack}</span>
          </label>
        )}
        {problem && <div className="perr" role="alert"><Icon name="error" /><span>{problem}</span></div>}
      </div>
    </Modal>
  );
}

/**
 * Settings search lands here: the element whose id is the address's #fragment gets .is-hit and is scrolled into view
 * once it exists (pages load their data first). Call once per page; `ready` = the data that renders the rows.
 */
export function useHit(ready) {
  const { hash } = useLocation();
  useEffect(() => {
    if (!hash || !ready) return undefined;
    const id = decodeURIComponent(hash.slice(1));
    let tries = 0;
    let el = null;
    const t = setInterval(() => {
      el = document.getElementById(id);
      tries += 1;
      if (el || tries > 30) {
        clearInterval(t);
        if (el) {
          el.classList.add('is-hit');
          el.scrollIntoView({ block: 'center' });
        }
      }
    }, 100);
    return () => {
      clearInterval(t);
      if (el) el.classList.remove('is-hit');
    };
  }, [hash, ready]);
}

/** A table cell value for "before → after" (data-table.md .chg). */
export function Change({ before, after, recorded = true }) {
  const fmt = (v) => (v === null || v === undefined ? '—' : typeof v === 'boolean' ? (v ? 'On' : 'Off') : typeof v === 'object' ? JSON.stringify(v) : String(v));
  return <span className="chg">{recorded ? <><del>{fmt(before)}</del> → </> : <span className="muted">not recorded → </span>}<ins>{fmt(after)}</ins></span>;
}
