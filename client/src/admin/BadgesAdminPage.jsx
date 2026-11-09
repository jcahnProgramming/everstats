import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { BadgeIcon } from '../badges/Badges.jsx';
import { Icon } from '../chrome/Icon.jsx';
import { Button, Field, Modal } from '../components/Controls.jsx';
import { useToasts } from '../components/Toasts.jsx';
import { formatDate, formatDateTime, formatNumber } from '../format.js';

/**
 * /admin/badges (0.7.0, design/v2-badges/pages/admin-badges), linked only from /admin; its API sits behind the admin
 * 404 gate. The admin is not a player and holds no badge; Everstats Staff (and every badge) is cosmetic.
 *
 * Different from the design, on purpose:
 *   - No native <select> (CLAUDE.md): the manual badges are a radio group of pills.
 *   - Partner marks are PNG or WebP only, never SVG (the design said "SVG preferred"; SVG can carry scripts). The
 *     upload needs the "written permission" box; the server re-encodes it; Save needs a reason and "I've checked the
 *     preview" after the three-theme preview.
 *   - Added: create badges from templates, the Early Supporter window, counts per badge, the deploy back-fill's counts,
 *     and the Blizzard classes that have no class badge yet.
 */
export function BadgesAdminPage() {
  const navigate = useNavigate();
  const [state, setState] = useState(undefined);
  const [problem, setProblem] = useState(null);
  const [openId, setOpenId] = useState(null);
  const load = useCallback(async () => {
    try {
      setState(await api('/api/admin/badges'));
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
  return (
    <div className="wrap page-pad stack gap-28">
      <div className="row gap-12 wrap-row">
        <Link className="btn ghost sm" to="/admin"><Icon name="arrow-left" size="sm" />Admin</Link>
        <h1 className="h1 admin-title">Badges</h1>
        <span className="tag gold">Owner only</span>
        <span className="spacer" />
        <span className="muted xsmall">Every grant and revoke needs a reason and is logged</span>
      </div>
      <CreatorAlerts state={state} onOpen={setOpenId} />
      <AccountPanel state={state} onChanged={load} openId={openId} />
      <MarkPanel state={state} onChanged={load} />
      <TemplatePanel state={state} onChanged={load} />
      <WindowPanel state={state} onChanged={load} />
      <CountsPanel state={state} />
      <LogPanel state={state} />
    </div>
  );
}

function AccountPanel({ state, onChanged, openId }) {
  const toast = useToasts();
  const [q, setQ] = useState('');
  const [found, setFound] = useState([]);
  const [account, setAccount] = useState(null);
  const [badgeId, setBadgeId] = useState(null);
  const [reason, setReason] = useState('');
  const [notify, setNotify] = useState(true);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [revoking, setRevoking] = useState(null);
  const manual = state.definitions.filter((d) => d.award === 'manual' && d.id !== state.creator?.badgeId);

  const search = async (e) => {
    e.preventDefault();
    const r = await api(`/api/admin/players?q=${encodeURIComponent(q.trim())}`);
    setFound(r.players);
    if (r.players.length === 1) pick(r.players[0].id);
  };
  const pick = async (id) => setAccount((await api(`/api/admin/badges/accounts/${id}`)).account);
  useEffect(() => {
    if (openId) pick(openId);
  }, [openId]); // eslint-disable-line react-hooks/exhaustive-deps
  const grant = async () => {
    setError(null);
    if (!reason.trim()) {
      setError('A reason is required: it is saved to the log.');
      return;
    }
    setBusy(true);
    try {
      setAccount((await api(`/api/admin/badges/accounts/${account.id}/grant`, { method: 'POST', body: { badgeId, reason, notify } })).account);
      setReason('');
      toast.ok('Badge granted', notify ? 'The player gets a toast next time they load a page.' : 'No toast was sent.');
      onChanged();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="panel pad-24 stack gap-18" aria-labelledby="acct-h">
      <h2 className="h2" id="acct-h">Account</h2>
      <form className="row gap-8 align-end" onSubmit={search}>
        <Field label="Find an account by @username or account id" value={q} onChange={(e) => setQ(e.target.value)} placeholder="@username" className="flex-fill" />
        <button type="submit" className="btn" disabled={!q.trim()}><Icon name="search" size="sm" />Find</button>
      </form>
      {found.length > 1 && !account && (
        <ul className="plain row gap-8 wrap-row">
          {found.map((p) => <li key={p.id}><button type="button" className="btn sm ghost" onClick={() => pick(p.id)}>{p.claimed ? `@${p.username}` : `#${p.id} (no username)`}</button></li>)}
        </ul>
      )}
      {found.length === 0 && q && <span className="muted small">Search to find an account.</span>}
      {account && (
        <div className="stack gap-14">
          <div className="row gap-10 wrap-row">
            <b>{account.displayName ?? (account.claimed ? account.username : `Account #${account.id}`)}</b>
            <span className="muted small">{account.claimed ? `@${account.username}` : 'No username yet'} · #{account.id} · joined {formatDate(account.createdAt)} · {account.providers.join(' + ') || 'passkeys only'}</span>
            <span className="spacer" />
            <button type="button" className="btn ghost sm" onClick={() => setAccount(null)}>Clear</button>
          </div>
          <div className="tblbox">
            <table className="tbl">
              <thead><tr><th scope="col">Badge</th><th scope="col">Family</th><th scope="col">Source</th><th scope="col">Since</th><th scope="col" className="r"><span className="sr-only">Action</span></th></tr></thead>
              <tbody>
                {account.badges.length === 0 && <tr><td colSpan={5} className="muted">No badges.</td></tr>}
                {account.badges.map((b) => (
                  <tr key={b.id}>
                    <td><span className="row gap-8"><BadgeIcon badge={b} size="inline" /><b>{b.name}</b>{b.state === 'revoked' && <span className="tag">{b.revokedBy === 'rule' ? 'Removed by its rule' : 'Revoked'}</span>}</span></td>
                    <td className="t2">{b.familyLabel}</td>
                    <td className="t2">{b.source === 'admin' ? `Granted by admin${b.reason ? `: ${b.reason}` : ''}` : 'Automatic'}{b.state === 'revoked' && b.revokedReason ? ` · ${b.revokedReason}` : ''}</td>
                    <td className="t2">{formatDate(b.state === 'revoked' ? b.revokedAt : b.earnedAt)}</td>
                    <td className="r">{b.award === 'manual' && b.state === 'held' ? <button type="button" className="btn danger sm" onClick={() => setRevoking(b)}>Revoke</button> : <span className="muted xsmall">{b.award === 'automatic' ? 'automatic' : ''}</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <BetaGrant account={account} onDone={(a) => { setAccount(a); onChanged(); }} />

          {state.creator && <CreatorGrant key={account.id} account={account} creator={{ ...state.creator, definition: state.definitions.find((d) => d.id === state.creator.badgeId) ?? null }} onDone={(a) => { setAccount(a); onChanged(); }} />}

          <div className="stack gap-12">
            <h3 className="h3">Grant a badge</h3>
            <span className="small t2" id="grant-list-h">Badge (manual badges only)</span>
            <div className="radio-list" role="radiogroup" aria-labelledby="grant-list-h">
              {manual.map((d) => (
                <button key={d.id} type="button" role="radio" aria-checked={badgeId === d.id} className="bdg-pill" disabled={!d.grantable} onClick={() => setBadgeId(d.id)}
                  title={d.grantable ? undefined : 'Upload and save its mark first'}>
                  <BadgeIcon badge={d} labelled={false} />
                  <span className="bdg-pill-name">{d.name}{d.grantable ? '' : ' (needs a mark)'}</span>
                </button>
              ))}
            </div>
            <div className="field">
              <label htmlFor="grant-reason">Reason <span className="muted">(required, saved to the log)</span></label>
              <textarea id="grant-reason" className={`inp${error ? ' is-error' : ''}`} rows={3} maxLength={500} value={reason} placeholder="Why is this account getting this badge?" onChange={(e) => setReason(e.target.value)} />
              {error && <span className="help err" role="alert">{error}</span>}
            </div>
            <label className="check"><input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} /> Notify the player with a “Badge granted” toast</label>
            <div className="row gap-10">
              <Button className="btn gold" loading={busy} disabled={!badgeId || !reason.trim()} onClick={grant}>Grant badge</Button>
              <span className="muted xsmall">Revoking asks for a reason in a confirmation.</span>
            </div>
          </div>
        </div>
      )}
      {revoking && <RevokeModal account={account} badge={revoking} onClose={() => setRevoking(null)} onDone={(a) => { setAccount(a); setRevoking(null); onChanged(); }} />}
    </section>
  );
}

/**
 * 0.7.1 (owner's decision): grant beta membership to an account made BEFORE the beta window opened. Reason required,
 * logged; Beta Tester then follows from the rule. Only for accounts made before the window closed; it never changes the
 * window. Confirmed in a modal (membership is permanent once granted).
 */
function BetaGrant({ account, onDone }) {
  const toast = useToasts();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState(null);
  const b = account.beta;
  const go = async () => {
    setBusy(true);
    setProblem(null);
    try {
      onDone((await api(`/api/admin/badges/accounts/${account.id}/beta`, { method: 'POST', body: { reason } })).account);
      toast.ok('Beta membership granted', 'Beta Tester follows from the rule.');
      setOpen(false);
    } catch (err) {
      setProblem(err.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="row gap-10 wrap-row">
      <span className="small">{b.member ? <>Beta member since {formatDate(b.since)}</> : 'Not a beta member'}</span>
      {!b.member && (b.grantable
        ? <button type="button" className="btn sm" onClick={() => setOpen(true)}>Grant beta membership…</button>
        : <span className="muted xsmall">Made after the beta window closed: can’t be granted.</span>)}
      {open && (
        <Modal title="Grant beta membership" busy={busy} onClose={() => setOpen(false)} actions={<><button type="button" className="btn ghost" disabled={busy} onClick={() => setOpen(false)}>Cancel</button><Button className="btn gold" loading={busy} disabled={!reason.trim()} onClick={go}>Grant membership</Button></>}>
          <p className="t2">{account.claimed ? `@${account.username}` : `Account #${account.id}`} becomes a beta member for good (it can’t be undone), and gets the Beta Tester badge like any member. The beta window doesn’t change.</p>
          <div className="field">
            <label htmlFor="beta-reason">Reason <span className="muted">(required, saved to the log)</span></label>
            <textarea id="beta-reason" className="inp" rows={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
            {problem && <span className="help err" role="alert">{problem}</span>}
          </div>
        </Modal>
      )}
    </div>
  );
}

function RevokeModal({ account, badge, onClose, onDone }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const go = async () => {
    setBusy(true);
    try {
      onDone((await api(`/api/admin/badges/accounts/${account.id}/revoke`, { method: 'POST', body: { badgeId: badge.id, reason } })).account);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };
  return (
    <Modal title={`Revoke ${badge.name}?`} onClose={onClose} busy={busy} actions={(
      <>
        <button type="button" className="btn ghost" onClick={onClose} disabled={busy}>Cancel</button>
        <Button className="btn danger" loading={busy} disabled={!reason.trim()} onClick={go}>Revoke</Button>
      </>
    )}>
      <p className="t2">It leaves {account.claimed ? `@${account.username}` : `account #${account.id}`}’s profile at once{badge.id === 'verified-creator' ? ', and so does every Verified mark on its handles' : ''}. The award is kept as revoked, with your reason, in the log.</p>
      <Field label="Reason (required)" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} error={error} />
    </Modal>
  );
}

/**
 * Verified Content Creator (0.8.1, server/badges/creators.js). The method, shown to the admin each time: Everstats makes
 * a short code for this account; the creator puts it in their channel bio or a panel (they see it in Settings → Profile);
 * you look at the channel yourself (Everstats never fetches it) and, once you've seen the code, tick the handles you
 * checked. Reason required; every step is logged. A handle the creator later changes loses its mark by itself.
 */
function CreatorGrant({ account, creator: info, onDone }) {
  const toast = useToasts();
  const c = account.creator;
  const eligible = account.socials.filter((s) => s.creatorPlatform);
  const [ticked, setTicked] = useState(() => new Set(eligible.filter((s) => s.verified).map((s) => s.platform)));
  const [codeChecked, setCodeChecked] = useState(false);
  const [reason, setReason] = useState('');
  const [notify, setNotify] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const holds = account.badges.some((b) => b.id === info.badgeId && b.state === 'held');
  const call = async (path, body, done) => {
    setBusy(true);
    setError(null);
    try {
      const a = (await api(`/api/admin/badges/accounts/${account.id}/creator/${path}`, { method: 'POST', body })).account;
      onDone(a);
      if (done) toast.ok(...done);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  const def = state0(info);
  const names = info.platforms.map((p) => p.label);
  return (
    <div className="stack gap-12 creator-grant" id="creator-grant">
      <div className="row gap-10 wrap-row">
        <h3 className="h3 row gap-8">{def && <BadgeIcon badge={def} size="inline" labelled={false} />}Verified Content Creator</h3>
        <span className="tag">Temporary art: a Claude Design pass will replace it</span>
      </div>
      <ol className="small t2 creator-steps">
        <li>Start a verification: Everstats makes a short code for this account.</li>
        <li>The creator sees the code in Settings → Profile and puts it in the bio or a panel of their {names.slice(0, -1).join(', ')} or {names.at(-1)} channel.</li>
        <li>Open their channel yourself and look for the code. Everstats never fetches or scrapes it.</li>
        <li>Tick the handles you checked, give a reason, grant. Every step is logged.</li>
      </ol>
      {!c || c.state === 'revoked' ? (
        <div className="row gap-10 wrap-row">
          <Button className="btn" loading={busy} onClick={() => call('start', {}, ['Verification started', 'The creator now sees the code in Settings → Profile.'])}>Start a verification</Button>
          {c?.state === 'revoked' && <span className="muted xsmall">Revoked {formatDate(c.revokedAt)}. Starting again makes a new code.</span>}
          {error && <span className="help err" role="alert">{error}</span>}
        </div>
      ) : (
        <>
          <div className="row gap-10 wrap-row">
            <span className="small">Code for this account</span>
            <code className="code-chip mono">{c.code}</code>
            <span className="tag">{c.state === 'pending' ? `Pending since ${formatDate(c.startedAt)}` : `Verified ${formatDate(c.verifiedAt)}`}</span>
          </div>
          {c.alert && (
            <div className="note warn small" role="status">
              <Icon name="warning" />
              <span className="flex-fill">Changed since it was verified: {c.alert.changes.map((x) => `${x.platform} ${x.from} → ${x.to ?? 'removed'}`).join(' · ')}. That handle’s Verified mark is already off; the badge stays until you decide.</span>
              <Button className="btn sm" loading={busy} onClick={() => call('checked', {}, ['Marked as checked'])}>Mark as checked</Button>
            </div>
          )}
          <fieldset className="plain-fieldset stack gap-6">
            <legend className="small t2">Handles on this profile you checked</legend>
            {eligible.length === 0 && <span className="muted small">This profile has no {names.join(', ')} handle. The creator adds it in Settings → Profile first.</span>}
            {eligible.map((s) => (
              <label key={s.platform} className="check">
                <input type="checkbox" checked={ticked.has(s.platform)} onChange={(e) => setTicked((t) => {
                  const n = new Set(t);
                  if (e.target.checked) n.add(s.platform);
                  else n.delete(s.platform);
                  return n;
                })} />
                {s.label} · <span className="mono">{s.handle}</span>{s.verified && <span className="tag gold xs">Verified</span>}
              </label>
            ))}
            {account.socials.some((s) => !s.creatorPlatform) && <span className="muted xsmall">Other handles ({account.socials.filter((s) => !s.creatorPlatform).map((s) => s.label).join(', ')}) can’t be verified with this badge.</span>}
          </fieldset>
          <label className="check"><input type="checkbox" checked={codeChecked} onChange={(e) => setCodeChecked(e.target.checked)} /> I saw <span className="mono">{c.code}</span> on their channel myself</label>
          <div className="field">
            <label htmlFor="creator-reason">Reason <span className="muted">(required, saved to the log)</span></label>
            <textarea id="creator-reason" className={`inp${error ? ' is-error' : ''}`} rows={2} maxLength={500} value={reason} placeholder="Where you saw the code, and when" onChange={(e) => setReason(e.target.value)} />
            {error && <span className="help err" role="alert">{error}</span>}
          </div>
          {!holds && <label className="check"><input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} /> Notify the player with a “Badge granted” toast</label>}
          <div className="row gap-10 wrap-row">
            <Button className="btn gold" loading={busy} disabled={!ticked.size || !codeChecked || !reason.trim()}
              onClick={() => call('grant', { platforms: [...ticked], reason, codeChecked, notify }, [holds ? 'Verified handles updated' : 'Verified Content Creator granted'])}>
              {holds ? 'Update verified handles' : 'Grant Verified Content Creator'}
            </Button>
            {holds && <span className="muted xsmall">Revoke it from the table above: that removes every Verified mark too.</span>}
          </div>
        </>
      )}
    </div>
  );
}
const state0 = (info) => info.definition ?? null;

/** Creator handles that changed since they were verified: the mark is already off; the admin decides about the badge. */
function CreatorAlerts({ state, onOpen }) {
  const alerts = state.creator?.alerts ?? [];
  return (
    <section className="panel pad-24 stack gap-12" aria-labelledby="creators-h" id="creators">
      <div className="row gap-10 wrap-row">
        <h2 className="h2" id="creators-h">Creator handle changes</h2>
        <span className="muted small">{alerts.length ? `${alerts.length} to check` : 'Nothing to check'}</span>
      </div>
      {alerts.length === 0 ? <span className="muted small">When a verified creator changes or removes a verified handle, its Verified mark comes off at once and it’s listed here.</span> : (
        <ul className="plain stack gap-8">
          {alerts.map((a) => (
            <li key={a.accountId} className="row gap-10 wrap-row">
              <b>{a.username ? `@${a.username}` : `#${a.accountId}`}</b>
              <span className="small t2 flex-fill">{a.changes.map((x) => `${x.platform}: ${x.from} → ${x.to ?? 'removed'}`).join(' · ')} · {formatDateTime(a.at)}</span>
              <button type="button" className="btn sm" onClick={() => onOpen(a.accountId)}>Open</button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

const THEMES = [['forever', 'Forever'], ['alliance', 'Alliance'], ['horde', 'Horde']];

function MarkPanel({ state, onChanged }) {
  const toast = useToasts();
  const teams = state.definitions.filter((d) => d.template === 'partner-pro');
  const [id, setId] = useState(teams[0]?.id ?? null);
  const [permission, setPermission] = useState(false);
  const [preview, setPreview] = useState(null);
  const [checked, setChecked] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const team = teams.find((t) => t.id === id) ?? null;
  const upload = async (file) => {
    setError(null);
    setPreview(null);
    setChecked(false);
    if (!file) return;
    if (!['image/png', 'image/webp'].includes(file.type)) {
      setError('Only PNG or WebP files (no SVG): an SVG can carry scripts.');
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/badges/${id}/mark?permission=confirmed`, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': file.type }, body: file });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? `Upload failed (${res.status})`);
      setPreview(body.preview);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  const save = async () => {
    setBusy(true);
    try {
      await api(`/api/admin/badges/${id}/mark/save`, { method: 'POST', body: { reason, previewChecked: checked } });
      toast.ok('Mark saved', `${team.name} can be granted now.`);
      setPreview(null);
      setChecked(false);
      setReason('');
      setPermission(false);
      onChanged();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  const shownBadge = team ? { ...team, mark: preview ?? team.mark } : null;
  return (
    <section className="panel pad-24 stack gap-18" aria-labelledby="mark-h">
      <div className="stack gap-6">
        <h2 className="h2" id="mark-h">Partner mark</h2>
        <span className="t2 small">Upload a partner’s official mark into the Pro Team Partner template: only after a signed partnership and written permission. Make the team’s badge first (Create from a template, below).</span>
      </div>
      {teams.length === 0 ? <span className="muted small">No Pro Team Partner badges yet.</span> : (
        <div className="split">
          <div className="main stack gap-14">
            <div className="radio-list" role="radiogroup" aria-label="Partner badge">
              {teams.map((t) => (
                <button key={t.id} type="button" role="radio" aria-checked={id === t.id} className="bdg-pill" onClick={() => { setId(t.id); setPreview(null); setChecked(false); }}>
                  <BadgeIcon badge={t} labelled={false} /><span className="bdg-pill-name">{t.name}{t.mark ? '' : ' (no mark yet)'}</span>
                </button>
              ))}
            </div>
            <label className="check"><input type="checkbox" checked={permission} onChange={(e) => setPermission(e.target.checked)} /> The partner has given written permission to use this mark</label>
            <div className="dropzone">
              <Icon name="download" />
              <b>Choose the mark</b>
              <span className="small">PNG or WebP only (no SVG). At least 256 × 256, square works best, transparent background, no frame: the badge adds its own. Up to 2 MB. Re-encoded on the server; nothing but the pixels is kept.</span>
              <input type="file" accept="image/png,image/webp" disabled={!permission || busy} aria-label="Mark file (PNG or WebP)" onChange={(e) => upload(e.target.files?.[0])} />
            </div>
            {error && <div className="note err small" role="alert"><Icon name="error" /><span>{error}</span></div>}
            {preview && (
              <>
                <label className="check"><input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} /> I’ve checked the preview in all three themes and at inline size</label>
                <Field label="Reason (required, saved to the log)" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
                <div className="row gap-10">
                  <Button className="btn gold" loading={busy} disabled={!checked || !reason.trim()} onClick={save}>Save mark</Button>
                  <button type="button" className="btn ghost" onClick={() => { setPreview(null); setChecked(false); api(`/api/admin/badges/${id}/mark/pending`, { method: 'DELETE' }).catch(() => {}); }}>Cancel</button>
                </div>
              </>
            )}
          </div>
          {shownBadge && (
            <div className="stack gap-8">
              <span className="eyebrow">Preview · all three themes · large / standard / inline</span>
              <div className="preview3">
                {THEMES.map(([theme, label]) => (
                  <div key={theme} data-theme={theme}>
                    <span className="eyebrow">{label}</span>
                    <BadgeIcon badge={shownBadge} size="lg" labelled={false} />
                    <span className="row gap-10"><BadgeIcon badge={shownBadge} labelled={false} /><BadgeIcon badge={shownBadge} size="inline" labelled={false} /></span>
                  </div>
                ))}
              </div>
              <span className="muted xsmall">{preview ? 'Showing the uploaded mark (not saved yet).' : shownBadge.mark ? 'Showing the saved mark.' : 'Showing the neutral placeholder (“PT”) until a mark is uploaded.'}</span>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

const TEMPLATE_HELP = {
  'partner-pro': 'A professional team’s own partner badge. Granted by hand, and only once its mark is uploaded and saved.',
  'platform-employee': 'An employee badge for a sign-in platform: one capital letter on the verified rosette. Granted by hand with a reason; work-email verification comes after 1.0.',
  class: 'A class Blizzard adds. Automatic: it goes to everyone who owns a level 10+ character whose class Blizzard names exactly as typed here, on the next pass (within 6 hours).',
  achievement: 'A new achievement. Granted by hand: an automatic rule needs code (server/badges/rules.js).',
};

function TemplatePanel({ state, onChanged }) {
  const toast = useToasts();
  const [tpl, setTpl] = useState('partner-pro');
  const [form, setForm] = useState({ id: '', name: '', description: '', how: '', monogram: '', class: '' });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      await api('/api/admin/badges/definitions', { method: 'POST', body: { template: tpl, ...form } });
      toast.ok('Badge created', form.name);
      setForm({ id: '', name: '', description: '', how: '', monogram: '', class: '' });
      onChanged();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="panel pad-24 stack gap-16" aria-labelledby="tpl-h">
      <h2 className="h2" id="tpl-h">Create a badge from a template</h2>
      <div className="radio-list" role="radiogroup" aria-label="Template">
        {state.templates.map((t) => <button key={t.id} type="button" role="radio" aria-checked={tpl === t.id} className="btn sm" onClick={() => setTpl(t.id)}>{t.label}</button>)}
      </div>
      <span className="t2 small">{TEMPLATE_HELP[tpl]}</span>
      {tpl === 'class' && state.classesWithoutBadge.length > 0 && (
        <span className="note small"><Icon name="info" /><span>Classes Blizzard has returned that have no badge yet: {state.classesWithoutBadge.join(', ')}.</span></span>
      )}
      <div className="grid-auto col-sm gap-12">
        <Field label="Id (in the address /badges/…)" value={form.id} onChange={set('id')} placeholder="example-team-partner" maxLength={48} />
        <Field label="Name" value={form.name} onChange={set('name')} maxLength={40} />
        {tpl === 'platform-employee' && <Field label="Monogram (one capital letter)" value={form.monogram} onChange={set('monogram')} maxLength={1} />}
        {tpl === 'class' && <Field label="Blizzard class name, exactly" value={form.class} onChange={set('class')} maxLength={40} />}
      </div>
      <Field label="Description" value={form.description} onChange={set('description')} maxLength={300} />
      {tpl !== 'class' && <Field label="How it’s earned (optional: a default fits the template)" value={form.how} onChange={set('how')} maxLength={200} />}
      {error && <div className="note err small" role="alert"><Icon name="error" /><span>{error}</span></div>}
      <Button className="btn self-start" loading={busy} disabled={!form.id || !form.name || !form.description} onClick={create}>Create badge</Button>
    </section>
  );
}

function WindowPanel({ state, onChanged }) {
  const toast = useToasts();
  const [start, setStart] = useState(state.earlySupporter?.start ?? '');
  const [end, setEnd] = useState(state.earlySupporter?.end ?? '');
  const [error, setError] = useState(null);
  const put = async (value) => {
    setError(null);
    try {
      await api('/api/admin/settings/badges.earlySupporter', { method: 'PUT', body: { value } });
      toast.ok(value ? 'Early Supporter window saved' : 'Early Supporter window cleared', value ? 'Accounts made inside it get the badge within 6 hours (at once on their next sign-in).' : 'The badge shows nowhere now.');
      onChanged();
    } catch (err) {
      setError(err.message);
    }
  };
  return (
    <section className="panel pad-24 stack gap-14" aria-labelledby="win-h">
      <h2 className="h2" id="win-h">Early Supporter window</h2>
      <span className="t2 small">Accounts created between these dates (UTC, both days included) get Early Supporter. Unset, the badge isn’t awardable and shows nowhere. After the end date it shows as “No longer available”.</span>
      <span className="small">{state.earlySupporter ? <>Now: <b>{state.earlySupporter.start} – {state.earlySupporter.end}</b>{state.earlySupporter.closed ? ' (closed)' : ''}</> : <b>Not set</b>}</span>
      <div className="row gap-10 align-end wrap-row">
        <Field label="Start" type="date" value={start} onChange={(e) => setStart(e.target.value)} />
        <Field label="End" type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
        <button type="button" className="btn" disabled={!start || !end} onClick={() => put({ start, end })}>Save window</button>
        {state.earlySupporter && <button type="button" className="btn ghost" onClick={() => put(null)}>Clear</button>}
      </div>
      {error && <div className="note err small" role="alert"><Icon name="error" /><span>{error}</span></div>}
    </section>
  );
}

function CountsPanel({ state }) {
  const bf = state.backfill;
  return (
    <section className="panel clip" aria-labelledby="counts-h">
      <div className="row board-head"><h2 className="h3" id="counts-h">Badges and holders</h2></div>
      <div className="pad-x-20 stack gap-6">
        {bf ? (
          <span className="small t2">Deploy back-fill {formatDateTime(bf.at)}: {formatNumber(bf.accounts)} account(s) checked; awarded {Object.keys(bf.awarded).length ? Object.entries(bf.awarded).map(([k, n]) => `${state.definitions.find((d) => d.id === k)?.name ?? k} ${formatNumber(n)}`).join(' · ') : 'nothing'}. No toasts were sent for these.</span>
        ) : <span className="small muted">The deploy back-fill hasn’t run yet (the worker runs it within a minute of starting).</span>}
      </div>
      <div className="tblbox">
        <table className="tbl">
          <thead><tr><th scope="col">Badge</th><th scope="col">Family</th><th scope="col">How</th><th scope="col" className="r">Holders now</th></tr></thead>
          <tbody>
            {state.definitions.map((d) => (
              <tr key={d.id}>
                <td><span className="row gap-8"><BadgeIcon badge={d} size="inline" /><Link to={`/badges/${d.id}`}>{d.name}</Link>{d.artTemporary && <span className="tag xs">Temporary art</span>}</span></td>
                <td className="t2">{d.familyLabel}</td>
                <td className="t2">{d.award === 'automatic' ? 'Automatic' : d.grantable ? 'Granted' : 'Granted (needs a mark first)'}{d.createdBy === 'admin' ? ' · made here' : ''}</td>
                <td className="r num">{formatNumber(d.heldBy)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

const ACTIONS = {
  granted: 'Granted', revoked: 'Revoked', mark_uploaded: 'Mark uploaded', mark_saved: 'Mark updated', created: 'Badge created', backfill: 'Back-fill',
  renamed: 'Renamed', creator_started: 'Creator verification started', creator_verified: 'Creator handles verified',
  creator_handle_changed: 'Creator changed a verified handle', creator_revoked: 'Creator marks removed', creator_alert_checked: 'Handle change checked',
};

function LogPanel({ state }) {
  return (
    <section className="panel clip" aria-labelledby="log-h">
      <div className="row board-head"><h2 className="h3" id="log-h">Log</h2><span className="muted xsmall">append-only</span></div>
      <div className="tblbox">
        <table className="tbl">
          <thead><tr><th scope="col">When</th><th scope="col">Action</th><th scope="col">Badge</th><th scope="col">Account</th><th scope="col">Reason</th></tr></thead>
          <tbody>
            {state.log.length === 0 && <tr><td colSpan={5} className="muted">Nothing yet.</td></tr>}
            {state.log.map((e) => (
              <tr key={e.id}>
                <td className="t2 nowrap">{formatDateTime(e.at)}</td>
                <td><span className="tag">{ACTIONS[e.type] ?? e.type}</span></td>
                <td>{e.badgeId ? state.definitions.find((d) => d.id === e.badgeId)?.name ?? e.badgeId : '—'}</td>
                <td className="mono small">{e.username ? `@${e.username}` : e.accountId ? `#${e.accountId}` : '—'}</td>
                <td className="t2">{e.reason ?? (e.type === 'backfill' ? `${e.detail.accounts} accounts` : '')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
