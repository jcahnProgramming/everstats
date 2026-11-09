import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { Icon } from '../chrome/Icon.jsx';
import { Button, Field, Modal } from '../components/Controls.jsx';
import { useToasts } from '../components/Toasts.jsx';
import { formatDateTime } from '../format.js';

/**
 * /admin/guild-links (0.7.0), linked only from /admin; its API sits behind the admin 404 gate. Links Guild Masters and
 * officers put on guild pages: the "Report this link" queue, removing any link (with a reason, logged on the guild),
 * and the blocklist of domains refused in new links (URL shorteners are refused by a built-in list as well).
 */
export function GuildLinksAdminPage() {
  const navigate = useNavigate();
  const toast = useToasts();
  const [state, setState] = useState(undefined);
  const [removing, setRemoving] = useState(null);
  const [host, setHost] = useState('');
  const [hostNote, setHostNote] = useState('');
  const [problem, setProblem] = useState(null);
  const load = useCallback(async () => {
    try {
      setState(await api('/api/admin/guild-links'));
    } catch (err) {
      if (err.status === 404) setState(null);
      else setProblem(err.message);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => {
    if (state === null) navigate('/admin/sign-in', { replace: true });
  }, [state, navigate]);
  if (state === null) return null;
  if (state === undefined) return <div className="wrap page-pad">{problem ? <div className="note err small" role="alert"><Icon name="error" /><span>{problem}</span></div> : <span className="t2 small" role="status">Loading…</span>}</div>;

  const dismiss = async (id) => {
    await api(`/api/admin/guild-links/reports/${id}/dismiss`, { method: 'POST', body: {} });
    load();
  };
  const block = async (e) => {
    e.preventDefault();
    setProblem(null);
    try {
      await api('/api/admin/guild-links/blocklist', { method: 'POST', body: { host, note: hostNote } });
      setHost('');
      setHostNote('');
      toast.ok('Blocked', 'New links to it are refused. Existing ones stay until removed.');
      load();
    } catch (err) {
      setProblem(err.message);
    }
  };
  const unblock = async (h) => {
    await api(`/api/admin/guild-links/blocklist/${encodeURIComponent(h)}`, { method: 'DELETE' });
    load();
  };
  const guildLink = (g) => (g ? <Link to={`/g/${encodeURIComponent(g.slug)}`}>{g.name}</Link> : <span className="muted">a guild Everstats no longer has</span>);

  return (
    <div className="wrap page-pad stack gap-28">
      <div className="row gap-12 wrap-row">
        <Link className="btn ghost sm" to="/admin"><Icon name="arrow-left" size="sm" />Admin</Link>
        <h1 className="h1 admin-title">Guild links</h1>
        <span className="tag gold">Owner only</span>
      </div>

      <section className="panel clip" aria-labelledby="rep-h">
        <div className="row board-head"><h2 className="h3" id="rep-h">Reported</h2><span className="muted xsmall">{state.reports.length} open</span></div>
        <div className="tblbox">
          <table className="tbl">
            <thead><tr><th scope="col">Reported</th><th scope="col">Guild</th><th scope="col">Link</th><th scope="col">Note</th><th scope="col" className="r"><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>
              {state.reports.length === 0 && <tr><td colSpan={5} className="muted">Nothing reported.</td></tr>}
              {state.reports.map((r) => (
                <tr key={r.id}>
                  <td className="t2 nowrap">{formatDateTime(r.at)}</td>
                  <td>{guildLink(r.guild)}</td>
                  <td><b>{r.link.label}</b> <span className="mono xsmall">{r.link.url}</span>{r.link.removed && <span className="tag">removed</span>}</td>
                  <td className="t2">{r.note ?? '—'}</td>
                  <td className="r nowrap">
                    {!r.link.removed && <button type="button" className="btn danger sm" onClick={() => setRemoving(r.link)}>Remove link</button>}
                    <button type="button" className="btn ghost sm" onClick={() => dismiss(r.id)}>Dismiss</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel clip" aria-labelledby="recent-h">
        <div className="row board-head"><h2 className="h3" id="recent-h">Newest links</h2></div>
        <div className="tblbox">
          <table className="tbl">
            <thead><tr><th scope="col">Added</th><th scope="col">Guild</th><th scope="col">Link</th><th scope="col" className="r"><span className="sr-only">Action</span></th></tr></thead>
            <tbody>
              {state.recent.length === 0 && <tr><td colSpan={4} className="muted">No guild links yet.</td></tr>}
              {state.recent.map((l) => (
                <tr key={l.id}>
                  <td className="t2 nowrap">{formatDateTime(l.createdAt)}</td>
                  <td>{guildLink(l.guild)}</td>
                  <td><b>{l.label}</b> <span className="mono xsmall">{l.url}</span>{l.removedAt && <span className="tag">removed by {l.removedBy === 'admin' ? 'admin' : 'the guild'}</span>}</td>
                  <td className="r">{!l.removedAt && <button type="button" className="btn danger sm" onClick={() => setRemoving(l)}>Remove</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel pad-24 stack gap-14" aria-labelledby="block-h">
        <h2 className="h2" id="block-h">Blocklist</h2>
        <span className="t2 small">Domains refused in guild links (each covers its subdomains). URL shorteners are always refused by a built-in list.</span>
        <form className="row gap-8 align-end wrap-row" onSubmit={block}>
          <Field label="Domain" value={host} onChange={(e) => setHost(e.target.value)} placeholder="example.com" maxLength={253} />
          <Field label="Note (optional)" value={hostNote} onChange={(e) => setHostNote(e.target.value)} maxLength={200} />
          <button type="submit" className="btn" disabled={!host.trim()}>Block</button>
        </form>
        {problem && <div className="note err small" role="alert"><Icon name="error" /><span>{problem}</span></div>}
        {state.blocklist.length === 0 ? <span className="muted small">Nothing blocked.</span> : (
          <ul className="plain stack gap-6">
            {state.blocklist.map((b) => (
              <li key={b.host} className="row gap-10"><span className="mono">{b.host}</span>{b.note && <span className="muted xsmall">{b.note}</span>}<span className="spacer" /><button type="button" className="btn ghost sm" onClick={() => unblock(b.host)}>Unblock</button></li>
            ))}
          </ul>
        )}
      </section>
      {removing && <RemoveModal link={removing} onClose={() => setRemoving(null)} onDone={() => { setRemoving(null); load(); }} />}
    </div>
  );
}

function RemoveModal({ link, onClose, onDone }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const go = async () => {
    setBusy(true);
    try {
      await api(`/api/admin/guild-links/${link.id}/remove`, { method: 'POST', body: { reason } });
      onDone();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };
  return (
    <Modal title={`Remove “${link.label}”?`} onClose={onClose} busy={busy} actions={(
      <>
        <button type="button" className="btn ghost" onClick={onClose} disabled={busy}>Cancel</button>
        <Button className="btn danger" loading={busy} disabled={!reason.trim()} onClick={go}>Remove link</Button>
      </>
    )}>
      <p className="t2">It leaves the guild page at once and is logged on the guild with your reason. <span className="mono xsmall">{link.url}</span></p>
      <Field label="Reason (required)" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} error={error} />
    </Modal>
  );
}
