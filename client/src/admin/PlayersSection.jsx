import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { Icon } from '../chrome/Icon.jsx';
import { Button, Field, Modal } from '../components/Controls.jsx';
import { useToasts } from '../components/Toasts.jsx';
import { formatDateTime } from '../format.js';

/**
 * Admin: find a player by username (or a former username, or account id), see their rename history and holds, set
 * their rename allowance, grant a name the rules would refuse (a verified partner), or reclaim a name (impersonation
 * or abuse: they drop to a placeholder and are asked to choose again; their allowance isn't touched). All logged.
 */
export function PlayersSection() {
  const [q, setQ] = useState('');
  const [list, setList] = useState(null);
  const search = async (e) => {
    e?.preventDefault();
    setList((await api(`/api/admin/players?q=${encodeURIComponent(q)}`)).players);
  };
  return (
    <section className="panel pad-20 stack gap-16" aria-labelledby="players-h">
      <div className="row gap-8 wrap-row"><h2 className="h2 h2-panel flex-fill" id="players-h">Players</h2><Link className="btn sm" to="/admin/accounts">All accounts</Link></div>
      <form className="row gap-8 align-end" onSubmit={search}>
        <Field label="Username, former username or account id" className="flex-fill" value={q} onChange={(e) => setQ(e.target.value)} />
        <Button type="submit" className="gold">Find</Button>
      </form>
      {list && (list.length === 0 ? <span className="muted small">Nobody matches.</span> : (
        <div className="listbox">
          {list.map((p) => (
            <Link key={p.id} className="listrow linkrow" to={`/admin/accounts/${p.id}`}>
              <span className="mono">{p.claimed ? `@${p.username}` : `${p.username} (placeholder)`}</span>
              <span className="muted xsmall flex-fill">#{p.id}{p.displayName ? ` · ${p.displayName}` : ''}</span>
            </Link>
          ))}
        </div>
      ))}
    </section>
  );
}

/** The username tools for one account (admin only): allowance, grant, reclaim, history, holds. On /admin/accounts/:id. */
export function PlayerDetail({ player: p, onChange }) {
  const toast = useToasts();
  const [allowance, setAllowance] = useState(String(p.renamesLeft));
  const [grant, setGrant] = useState('');
  const [note, setNote] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => setAllowance(String(p.renamesLeft)), [p.renamesLeft]);
  const act = async (fn, ok) => {
    setBusy(true);
    try {
      onChange((await fn()).player);
      toast.ok(ok);
    } catch (err) {
      toast.err("Couldn't do that", err.message);
    }
    setBusy(false);
  };
  return (
    <div className="raised pad-16 stack gap-12">
      <div className="row gap-10"><b className="mono">{p.claimed ? `@${p.username}` : `${p.username} (placeholder)`}</b><span className="muted xsmall">account #{p.id} · since {formatDateTime(p.createdAt)} · {p.characters} characters{p.beta ? ' · beta member' : ''}</span></div>
      <form className="row gap-8 align-end" onSubmit={(e) => { e.preventDefault(); act(() => api(`/api/admin/players/${p.id}/allowance`, { method: 'PUT', body: { value: Number(allowance) } }), 'Rename allowance set'); }}>
        <Field label="Renames left" inputClassName="num" inputMode="numeric" value={allowance} onChange={(e) => setAllowance(e.target.value)} />
        <Button type="submit" className="sm" loading={busy}>Set</Button>
      </form>
      <form className="row gap-8 align-end" onSubmit={(e) => { e.preventDefault(); act(() => api(`/api/admin/players/${p.id}/grant`, { method: 'POST', body: { username: grant, note } }), `Granted @${grant}`); }}>
        <Field label="Grant a name (past the reserved list)" className="flex-fill" inputClassName="mono" value={grant} onChange={(e) => setGrant(e.target.value.toLowerCase())} />
        <Button type="submit" className="sm" loading={busy} disabled={!grant}>Grant</Button>
      </form>
      <Field label="Note for the log (optional)" value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} />
      {p.claimed && <button type="button" className="btn danger sm self-start" onClick={() => setConfirm(true)}>Reclaim @{p.username}</button>}
      {confirm && (
        <Modal title={`Reclaim @${p.username}?`} busy={busy} onClose={() => setConfirm(false)} actions={<><button type="button" className="btn ghost" onClick={() => setConfirm(false)}>Cancel</button><Button className="danger" loading={busy} onClick={() => { setConfirm(false); act(() => api(`/api/admin/players/${p.id}/reclaim`, { method: 'POST', body: { note } }), 'Reclaimed'); }}>Reclaim</Button></>}>
          <p className="t2 small">The account drops to a placeholder, its display name is cleared, and it's asked to choose again at its next page load. Its renames aren't used up. @{p.username} is held until you release it below.</p>
        </Modal>
      )}
      <span className="eyebrow">Username history</span>
      {p.history.length === 0 ? <span className="muted xsmall">None.</span> : (
        <ul className="plain stack gap-4 small">
          {p.history.map((h) => <li key={`${h.at}-${h.to}`}><span className="mono">{h.from} → {h.to}</span> <span className="muted">· {h.kind}{h.byAdmin ? ' by admin' : ''} · {formatDateTime(h.at)}{h.note ? ` · ${h.note}` : ''}</span></li>)}
        </ul>
      )}
      {p.holds.length > 0 && (
        <>
          <span className="eyebrow">Names held for this account</span>
          <ul className="plain stack gap-4 small">{p.holds.map((h) => <li key={h.name}><span className="mono">{h.name}</span> <span className="muted">· {h.reason} · until {h.until ? formatDateTime(h.until) : 'released'}</span></li>)}</ul>
        </>
      )}
    </div>
  );
}

/** The reserved list: admin only (it is never sent to anyone else). Add or remove names; held names can be released. */
export function ReservedSection() {
  const toast = useToasts();
  const [list, setList] = useState(null);
  const [name, setName] = useState('');
  const [hold, setHold] = useState('');
  const load = async () => setList((await api('/api/admin/reserved')).reserved);
  useEffect(() => {
    load();
  }, []);
  const add = async (e) => {
    e.preventDefault();
    try {
      await api('/api/admin/reserved', { method: 'POST', body: { name, kind: 'admin' } });
      setName('');
      load();
    } catch (err) {
      toast.err("Couldn't add it", err.message);
    }
  };
  const remove = async (n) => {
    try {
      await api(`/api/admin/reserved/${encodeURIComponent(n)}`, { method: 'DELETE' });
      load();
    } catch (err) {
      toast.err("Couldn't remove it", err.message);
    }
  };
  const release = async (e) => {
    e.preventDefault();
    try {
      await api(`/api/admin/holds/${encodeURIComponent(hold)}`, { method: 'DELETE' });
      toast.ok(`${hold} released`, 'Anyone can claim it now (unless it is reserved).');
      setHold('');
    } catch (err) {
      toast.err("Couldn't release it", err.message);
    }
  };
  const groups = {};
  for (const r of list ?? []) (groups[r.kind] ??= []).push(r.name);
  return (
    <section className="panel pad-20 stack gap-14" aria-labelledby="reserved-h">
      <h2 className="h2 h2-panel" id="reserved-h">Reserved names</h2>
      <p className="t2 small">Compared after lookalike normalization (0→o, 1→i/l, 3→e…, separators ignored). On top of this list, any username containing admin, staff, official, moderator, support or blizzard is refused, and the profanity list (server/accounts/profanity.json). Players only ever see “That name is reserved”.</p>
      <form className="row gap-8 align-end" onSubmit={add}>
        <Field label="Reserve a name" className="flex-fill" inputClassName="mono" value={name} onChange={(e) => setName(e.target.value.toLowerCase())} />
        <Button type="submit" className="sm" disabled={!name}><Icon name="plus" size="sm" />Add</Button>
      </form>
      {Object.entries(groups).map(([kind, names]) => (
        <details key={kind}>
          <summary className="small">{kind} · {names.length}</summary>
          <div className="row gap-6 reserved-list">{names.map((n) => <button key={n} type="button" className="tag mono" title="Remove from the list" onClick={() => remove(n)}>{n} ×</button>)}</div>
        </details>
      ))}
      <form className="row gap-8 align-end" onSubmit={release}>
        <Field label="Release a held name (reclaimed, or inside its 30 days)" className="flex-fill" inputClassName="mono" value={hold} onChange={(e) => setHold(e.target.value.toLowerCase())} />
        <Button type="submit" className="sm" disabled={!hold}>Release</Button>
      </form>
    </section>
  );
}
