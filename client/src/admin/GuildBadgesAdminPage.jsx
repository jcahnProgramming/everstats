import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { Icon } from '../chrome/Icon.jsx';
import { Button, Field, Modal } from '../components/Controls.jsx';
import { useToasts } from '../components/Toasts.jsx';
import { formatDate, formatDateTime, formatNumber } from '../format.js';
import { GuildBadgeIcon, GuildPill, guildBadgeName } from '../guildBadges/GuildBadges.jsx';

/**
 * /admin/guild-badges (0.7.1, design/v2-guild-badges/pages/admin-guild-badges), linked only from /admin; its API sits
 * behind the admin 404 gate. Grant or revoke the STAFF badges (Featured Guild with an event label and "show until";
 * Partner Guild once its emblem is saved), each with a reason; the Early Guild window; level thresholds with a preview;
 * partner emblems (PNG or WebP with written permission, re-encoded, previewed in all three themes); a new Deeds badge
 * from the template; the back-fill result; the log.
 *
 * Different from the mockup, on purpose: no native <select> (radio buttons instead), no "Admin" link in the top bar,
 * and emblems are PNG or WebP only (the mockup says "SVG preferred"; SVG can carry scripts, so it's refused).
 */
const THEMES = [['forever', 'Forever'], ['alliance', 'Alliance'], ['horde', 'Horde']];
const TYPE_WORD = {
  unlocked: 'Unlocked', level: 'Level up', lost: 'Lost', regained: 'Regained', granted: 'Granted', revoked: 'Revoked', display: 'Display',
  thresholds: 'Thresholds', mark_uploaded: 'Emblem uploaded', mark_saved: 'Emblem saved', created: 'Created', backfill: 'Back-fill',
};

export function GuildBadgesAdminPage() {
  const navigate = useNavigate();
  const [state, setState] = useState(undefined);
  const [problem, setProblem] = useState(null);
  const load = useCallback(async () => {
    try {
      setState(await api('/api/admin/guild-badges'));
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
    <div className="wrap page-pad stack gap-24">
      <div className="row gap-12 wrap-row">
        <h1 className="h1 admin-title">Guild badges</h1>
        <span className="tag gold">Owner only</span>
        <span className="spacer" />
        <span className="muted small">Every change needs a reason and is logged</span>
        <Link className="btn ghost sm" to="/admin">Back to admin</Link>
      </div>
      <Backfill state={state} />
      <div className="grid-auto col-xl gap-24 align-start-grid">
        <GrantSection state={state} onChanged={load} />
        <EarlyWindow state={state} onChanged={load} />
      </div>
      <Thresholds state={state} onChanged={load} />
      <PartnerMark state={state} onChanged={load} />
      <DeedsTemplate state={state} onChanged={load} />
      <Log state={state} />
    </div>
  );
}

function Backfill({ state }) {
  const b = state.backfill;
  if (!b) return <div className="note small"><Icon name="clock" /><span>The one-time back-fill hasn’t run yet: the worker runs it within a minute of starting.</span></div>;
  const defs = new Map(state.definitions.map((d) => [d.id, d]));
  return (
    <section className="panel pad-20 stack gap-10" aria-labelledby="bf-h">
      <h2 className="h2 h2-panel" id="bf-h">Back-fill on deploy</h2>
      <span className="t2 small">{formatDateTime(b.at)} · {formatNumber(b.guilds)} guild{b.guilds === 1 ? '' : 's'} checked, no toasts and no “Unlocked” ribbons. Held right after it:</span>
      {b.held.length === 0 ? <span className="muted small">Nothing.</span> : (
        <ul className="plain row gap-8 wrap-row">
          {b.held.map((h) => (
            <li key={`${h.badge}-${h.level}`} className="tag">{defs.get(h.badge)?.name ?? h.badge}{h.level ? ` ${['I', 'II', 'III', 'IV', 'V'][h.level - 1]}` : ''}: {formatNumber(h.guilds)}</li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** A guild picked by name (the admin's own search; no Blizzard request). */
function GuildPicker({ value, onPick, label = 'Guild' }) {
  const [q, setQ] = useState('');
  const [found, setFound] = useState([]);
  useEffect(() => {
    if (q.trim().length < 2) {
      setFound([]);
      return undefined;
    }
    let live = true;
    const t = setTimeout(() => api(`/api/admin/guild-badges/guilds?q=${encodeURIComponent(q.trim())}`).then((r) => { if (live) setFound(r.guilds); }, () => {}), 200);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [q]);
  if (value) {
    return (
      <div className="row gap-8 wrap-row">
        <span className="lbl">{label}</span><b>{value.name}</b><span className="muted xsmall">{value.faction ?? ''} · #{value.id}</span>
        <button type="button" className="btn ghost sm" onClick={() => onPick(null)}>Change</button>
      </div>
    );
  }
  return (
    <div className="stack gap-6">
      <Field label={label} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Guild name" autoComplete="off" />
      {found.length > 0 && (
        <ul className="plain row gap-6 wrap-row">{found.map((g) => <li key={g.id}><button type="button" className="btn sm ghost" onClick={() => onPick(g)}>{g.name}</button></li>)}</ul>
      )}
    </div>
  );
}

function GrantSection({ state, onChanged }) {
  const toast = useToasts();
  const staff = state.definitions.filter((d) => d.grantable);
  const [guild, setGuild] = useState(null);
  const [detail, setDetail] = useState(null);
  const [badgeId, setBadgeId] = useState(staff[0]?.id ?? null);
  const [labelText, setLabelText] = useState('');
  const [until, setUntil] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState(null);
  const [revoking, setRevoking] = useState(null);
  useEffect(() => {
    setDetail(null);
    if (guild) api(`/api/admin/guild-badges/guilds/${guild.id}`).then((r) => setDetail(r.guild), () => {});
  }, [guild]);
  const grant = async () => {
    setBusy(true);
    setProblem(null);
    try {
      setDetail((await api(`/api/admin/guild-badges/guilds/${guild.id}/grant`, { method: 'POST', body: { badgeId, reason, label: labelText, until } })).guild);
      setReason('');
      toast.ok('Granted', 'The Guild Master and officers get a toast on their next visit.');
      onChanged();
    } catch (err) {
      setProblem(err.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="panel pad-24 stack gap-14" aria-labelledby="grant-h">
      <h2 className="h2 h2-panel" id="grant-h">Grant or revoke</h2>
      <GuildPicker value={guild} onPick={setGuild} />
      {detail && (
        <div className="stack gap-6">
          <span className="lbl">Badges now</span>
          {detail.awards.length === 0 ? <span className="muted small">None.</span> : (
            <ul className="plain stack gap-6">
              {detail.awards.map((a) => (
                <li key={a.id} className="row gap-8 wrap-row">
                  <GuildBadgeIcon badge={a} size="inline" />
                  <span className="small">{guildBadgeName(a)}</span>
                  <span className="tag">{a.state}</span>
                  <span className="muted xsmall">{a.source === 'admin' ? `granted: ${a.reason ?? ''}` : 'automatic'}</span>
                  {a.award === 'manual' && a.state === 'held' && <button type="button" className="btn danger sm" onClick={() => setRevoking(a)}>Revoke…</button>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      <span className="lbl" id="staff-badge-h">Badge (staff badges only)</span>
      <div className="radio-list" role="radiogroup" aria-labelledby="staff-badge-h">
        {staff.map((d) => (
          <button key={d.id} type="button" role="radio" aria-checked={badgeId === d.id} className="gpill sm" onClick={() => setBadgeId(d.id)}>
            <GuildBadgeIcon badge={d} size="pill-ico" labelled={false} /><span>{d.name}</span>
          </button>
        ))}
      </div>
      {badgeId === 'featured-guild' && (
        <div className="split-even gap-10">
          <Field label="Event label (optional)" value={labelText} onChange={(e) => setLabelText(e.target.value)} maxLength={40} />
          <Field label="Show until (optional, YYYY-MM-DD)" value={until} onChange={(e) => setUntil(e.target.value)} placeholder="2026-12-31" maxLength={10} />
        </div>
      )}
      {badgeId === 'partner-guild' && <span className="muted xsmall">Partner Guild needs this guild’s emblem saved first (Partner guild emblem, below).</span>}
      <div className="field">
        <label htmlFor="gb-reason">Reason <span className="muted">(required)</span></label>
        <textarea id="gb-reason" className="inp" rows={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why is this guild getting this badge?" />
      </div>
      {problem && <div className="note err small" role="alert"><Icon name="error" /><span>{problem}</span></div>}
      <div className="row gap-10"><Button className="btn gold" loading={busy} disabled={!guild || !badgeId || !reason.trim()} onClick={grant}>Grant</Button><span className="muted xsmall">Revoke asks for its own reason.</span></div>
      {revoking && <RevokeGuild guild={guild} award={revoking} onClose={() => setRevoking(null)} onDone={(g) => { setDetail(g); setRevoking(null); onChanged(); }} />}
    </section>
  );
}

function RevokeGuild({ guild, award, onClose, onDone }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState(null);
  const go = async () => {
    setBusy(true);
    try {
      onDone((await api(`/api/admin/guild-badges/guilds/${guild.id}/revoke`, { method: 'POST', body: { badgeId: award.id, reason } })).guild);
    } catch (err) {
      setProblem(err.message);
      setBusy(false);
    }
  };
  return (
    <Modal title={`Revoke ${award.name} from ${guild.name}?`} busy={busy} onClose={onClose} actions={<><button type="button" className="btn ghost" onClick={onClose} disabled={busy}>Cancel</button><Button className="btn danger" loading={busy} disabled={!reason.trim()} onClick={go}>Revoke</Button></>}>
      <p className="t2">It leaves the guild page at once. The award is kept as revoked, with your reason, in the log.</p>
      <div className="field"><label htmlFor="rv-reason">Reason (required)</label><textarea id="rv-reason" className="inp" rows={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />{problem && <span className="help err" role="alert">{problem}</span>}</div>
    </Modal>
  );
}

function EarlyWindow({ state, onChanged }) {
  const toast = useToasts();
  const [start, setStart] = useState(state.early?.start ?? '');
  const [end, setEnd] = useState(state.early?.end ?? '');
  const [problem, setProblem] = useState(null);
  const save = async (value) => {
    setProblem(null);
    try {
      await api('/api/admin/settings/guildBadges.earlyWindow', { method: 'PUT', body: { value } });
      toast.ok(value ? 'Early Guild window saved' : 'Early Guild window cleared');
      onChanged();
    } catch (err) {
      setProblem(err.message);
    }
  };
  const tag = !state.early ? ['', 'Not set'] : state.early.closed ? ['', 'Closed'] : state.early.upcoming ? ['warn', 'Upcoming'] : ['ok', 'Open'];
  return (
    <section className="panel pad-24 stack gap-14" aria-labelledby="early-h">
      <h2 className="h2 h2-panel" id="early-h">Early Guild window</h2>
      <div className="split-even gap-10">
        <Field label="Opens (YYYY-MM-DD, UTC)" value={start} onChange={(e) => setStart(e.target.value)} maxLength={10} placeholder="2026-12-01" />
        <Field label="Closes (YYYY-MM-DD, included)" value={end} onChange={(e) => setEnd(e.target.value)} maxLength={10} placeholder="2026-12-31" />
      </div>
      <div className="note small"><Icon name="info" /><span>Guilds first tracked between these dates unlock <b>Early Guild</b>. After it closes, the badge shows “No longer available”. Unset, it shows nowhere. Founding Guild uses the open-beta window and can’t be edited.</span></div>
      {problem && <div className="note err small" role="alert"><Icon name="error" /><span>{problem}</span></div>}
      <div className="row gap-10 wrap-row">
        <span className={`tag ${tag[0]}`}>{tag[1]}</span>
        <button type="button" className="btn gold" disabled={!start || !end} onClick={() => save({ start, end })}>Save window</button>
        {state.early && <button type="button" className="btn ghost" onClick={() => save(null)}>Clear</button>}
      </div>
    </section>
  );
}

function Thresholds({ state, onChanged }) {
  const toast = useToasts();
  const levelled = state.definitions.filter((d) => d.levelled);
  const [id, setId] = useState(levelled[0]?.id ?? null);
  const def = levelled.find((d) => d.id === id);
  const [values, setValues] = useState(def ? def.thresholds.map(String) : []);
  const [preview, setPreview] = useState(null);
  const [reason, setReason] = useState('');
  const [problem, setProblem] = useState(null);
  useEffect(() => {
    if (def) setValues(def.thresholds.map(String));
    setPreview(null);
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  const nums = values.map((v) => Number(v.replace(/[,_\s]/g, '')));
  const run = async () => {
    setProblem(null);
    try {
      setPreview(await api(`/api/admin/guild-badges/${id}/thresholds/preview`, { method: 'POST', body: { thresholds: nums } }));
    } catch (err) {
      setProblem(err.message);
    }
  };
  const save = async () => {
    setProblem(null);
    try {
      await api(`/api/admin/guild-badges/${id}/thresholds`, { method: 'PUT', body: { thresholds: nums, reason } });
      toast.ok('Thresholds saved', 'Lowered levels unlock within a minute. Raising one never removes a level a guild holds.');
      setReason('');
      onChanged();
    } catch (err) {
      setProblem(err.message);
    }
  };
  if (!def) return null;
  const max = preview ? Math.max(1, ...preview.wouldReach, ...preview.holdNow) : 1;
  return (
    <section className="panel pad-24 stack gap-14" aria-labelledby="thr-h">
      <div className="row gap-10 wrap-row"><h2 className="h2 h2-panel" id="thr-h">Level thresholds</h2><span className="muted small">Lowering a threshold unlocks levels within a minute; raising one never removes a level a guild already holds.</span></div>
      <div className="radio-list" role="radiogroup" aria-label="Badge">
        {levelled.map((d) => <button key={d.id} type="button" role="radio" aria-checked={id === d.id} className="btn sm" onClick={() => setId(d.id)}>{d.name} · {d.measure}</button>)}
      </div>
      <div className="thr-grid">
        {['I · Iron', 'II · Bronze', 'III · Silver', 'IV · Gold', 'V · Forever'].map((l, i) => (
          <Field key={l} label={`Level ${l}`} value={values[i] ?? ''} inputMode="numeric" onChange={(e) => { const v = [...values]; v[i] = e.target.value; setValues(v); setPreview(null); }} />
        ))}
      </div>
      <button type="button" className="btn self-start" onClick={run}>Preview</button>
      {preview && (
        <div className="stack gap-8">
          <span className="eyebrow">Preview · guilds whose current value reaches each level ({formatNumber(preview.measuredGuilds)} measured)</span>
          <div className="hist">
            {nums.map((n, i) => (
              <span key={i} className="hist-row">
                <span className="mono small">{['I', 'II', 'III', 'IV', 'V'][i]}</span>
                <span className="b" style={{ width: `${(preview.wouldReach[i] / max) * 100}%` }} />
                <span className="small r">{formatNumber(preview.wouldReach[i])} <span className="muted xsmall">({formatNumber(preview.holdNow[i])} hold it now)</span></span>
              </span>
            ))}
          </div>
          <span className="muted xsmall">A guild that holds a level now keeps it even if the new numbers put it lower.</span>
        </div>
      )}
      <div className="field"><label htmlFor="thr-reason">Reason (required)</label><input id="thr-reason" className="inp" maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} /></div>
      {problem && <div className="note err small" role="alert"><Icon name="error" /><span>{problem}</span></div>}
      <div className="row gap-10"><button type="button" className="btn gold" disabled={!preview || !reason.trim()} onClick={save}>Save thresholds</button><button type="button" className="btn ghost" onClick={() => { setValues(def.thresholds.map(String)); setPreview(null); }}>Reset</button><span className="muted xsmall">Preview first.</span></div>
    </section>
  );
}

function PartnerMark({ state, onChanged }) {
  const toast = useToasts();
  const partner = state.definitions.find((d) => d.template === 'partner-guild');
  const [guild, setGuild] = useState(null);
  const [permission, setPermission] = useState(false);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [checked, setChecked] = useState(false);
  const [reason, setReason] = useState('');
  const [problem, setProblem] = useState(null);
  const [busy, setBusy] = useState(false);
  const saved = guild ? state.marks.find((m) => m.guildId === guild.id) : null;
  const upload = async (file) => {
    if (!file || !guild) return;
    setProblem(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/guild-badges/guilds/${guild.id}/mark?permission=confirmed`, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': file.type || 'application/octet-stream' }, body: file });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? `Upload failed (${res.status})`);
      setPreviewUrl(body.preview);
      setChecked(false);
    } catch (err) {
      setProblem(err.message);
    } finally {
      setBusy(false);
    }
  };
  const save = async () => {
    setProblem(null);
    try {
      await api(`/api/admin/guild-badges/guilds/${guild.id}/mark/save`, { method: 'POST', body: { reason, previewChecked: checked } });
      toast.ok('Emblem saved', 'Partner Guild can now be granted to this guild.');
      setPreviewUrl(null);
      setReason('');
      onChanged();
    } catch (err) {
      setProblem(err.message);
    }
  };
  const cancel = async () => {
    if (guild) await api(`/api/admin/guild-badges/guilds/${guild.id}/mark/pending`, { method: 'DELETE' }).catch(() => {});
    setPreviewUrl(null);
  };
  if (!partner) return null;
  const shown = { ...partner, mark: previewUrl ?? saved?.url ?? null };
  return (
    <section className="panel pad-24 stack gap-14" aria-labelledby="mark-h">
      <div className="row gap-10 wrap-row"><h2 className="h2 h2-panel" id="mark-h">Partner guild emblem</h2><span className="muted small">A partner guild’s own emblem in the Partner Guild template, only with their written permission.</span></div>
      <div className="split-even gap-18">
        <div className="stack gap-12">
          <GuildPicker value={guild} onPick={(g) => { setGuild(g); setPreviewUrl(null); }} />
          <label className="check"><input type="checkbox" checked={permission} onChange={(e) => setPermission(e.target.checked)} /> The guild has given written permission to use this emblem</label>
          <div className="dropzone stack gap-6">
            <Icon name="download" />
            <b>Choose the emblem</b>
            <span className="muted xsmall">PNG or WebP only, at least 256 × 256, at most 2 MB. No SVG. It’s re-encoded on the server; nothing but its pixels is kept. It sits in a circle on the cloth.</span>
            <input type="file" accept="image/png,image/webp" disabled={!guild || !permission || busy} aria-label="Emblem file" onChange={(e) => upload(e.target.files?.[0])} />
          </div>
          <label className="check"><input type="checkbox" checked={checked} disabled={!previewUrl} onChange={(e) => setChecked(e.target.checked)} /> Checked in all three themes and at inline size</label>
          <div className="field"><label htmlFor="mark-reason">Reason (required)</label><input id="mark-reason" className="inp" maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} /></div>
          {problem && <div className="note err small" role="alert"><Icon name="error" /><span>{problem}</span></div>}
          <div className="row gap-10"><button type="button" className="btn gold" disabled={!previewUrl || !checked || !reason.trim()} onClick={save}>Save emblem</button>{previewUrl && <button type="button" className="btn ghost" onClick={cancel}>Cancel</button>}</div>
          {saved && !previewUrl && <span className="muted xsmall">Saved emblem since {formatDate(saved.setAt)}.</span>}
        </div>
        <div className="stack gap-8">
          <span className="eyebrow">Preview · Forever / Alliance / Horde</span>
          <div className="preview3">
            {THEMES.map(([theme, label]) => (
              <div key={theme} data-theme={theme}>
                <span className="eyebrow">{label}</span>
                <GuildBadgeIcon badge={shown} size="lg" labelled={false} />
                <span className="row gap-10"><GuildBadgeIcon badge={shown} labelled={false} /><GuildBadgeIcon badge={shown} size="inline" labelled={false} /></span>
                <GuildPill badge={{ ...shown, heldBy: 0 }} small ribbon={false} />
              </div>
            ))}
          </div>
          {!shown.mark && <span className="muted xsmall">The template’s neutral “PG” placeholder until an emblem is uploaded.</span>}
        </div>
      </div>
    </section>
  );
}

function DeedsTemplate({ state, onChanged }) {
  const toast = useToasts();
  const [form, setForm] = useState({ id: '', name: '', statistic: '', measure: '', thresholds: ['', '', '', '', ''] });
  const [problem, setProblem] = useState(null);
  const [filter, setFilter] = useState('');
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const matches = filter.trim().length >= 2 ? state.statisticNames.filter((n) => n.toLowerCase().includes(filter.trim().toLowerCase())).slice(0, 12) : [];
  const create = async () => {
    setProblem(null);
    try {
      await api('/api/admin/guild-badges/definitions', { method: 'POST', body: { ...form, thresholds: form.thresholds.map((v) => Number(v.replace(/[,_\s]/g, ''))) } });
      toast.ok('Guild badge created', 'Guilds are checked for it within a minute.');
      setForm({ id: '', name: '', statistic: '', measure: '', thresholds: ['', '', '', '', ''] });
      onChanged();
    } catch (err) {
      setProblem(err.message);
    }
  };
  return (
    <section className="panel pad-24 stack gap-14" aria-labelledby="deeds-h">
      <div className="row gap-10 wrap-row"><h2 className="h2 h2-panel" id="deeds-h">New Deeds badge</h2><span className="muted small">From the Deeds template: the combined total of one statistic, levels I–V. Drawn with the template’s neutral motif.</span></div>
      <div className="split-even gap-10">
        <Field label="Id (lower case, hyphens)" value={form.id} onChange={(e) => set('id', e.target.value)} maxLength={48} placeholder="fishers" />
        <Field label="Name" value={form.name} onChange={(e) => set('name', e.target.value)} maxLength={40} placeholder="Fishers" />
      </div>
      <Field label="Find the statistic (by name, from the catalog)" value={filter} onChange={(e) => setFilter(e.target.value)} />
      {matches.length > 0 && <div className="radio-list" role="radiogroup" aria-label="Statistic">{matches.map((n) => <button key={n} type="button" role="radio" aria-checked={form.statistic === n} className="btn sm" onClick={() => set('statistic', n)}>{n}</button>)}</div>}
      {form.statistic && <span className="small">Statistic: <b>{form.statistic}</b></span>}
      <Field label="Measure (how progress reads, e.g. “fish caught”)" value={form.measure} onChange={(e) => set('measure', e.target.value)} maxLength={40} />
      <div className="thr-grid">
        {['I', 'II', 'III', 'IV', 'V'].map((l, i) => <Field key={l} label={`Level ${l}`} value={form.thresholds[i]} inputMode="numeric" onChange={(e) => set('thresholds', form.thresholds.map((v, j) => (j === i ? e.target.value : v)))} />)}
      </div>
      {problem && <div className="note err small" role="alert"><Icon name="error" /><span>{problem}</span></div>}
      <button type="button" className="btn gold self-start" disabled={!form.id || !form.name || !form.statistic} onClick={create}>Create guild badge</button>
    </section>
  );
}

function Log({ state }) {
  const defs = new Map(state.definitions.map((d) => [d.id, d]));
  return (
    <section className="panel clip" aria-labelledby="log-h">
      <div className="pad-20"><h2 className="h2 h2-panel" id="log-h">Log</h2></div>
      <div className="tblbox">
        <table className="tbl">
          <thead><tr><th scope="col">When</th><th scope="col">Action</th><th scope="col">Badge</th><th scope="col">Guild</th><th scope="col">Reason</th></tr></thead>
          <tbody>
            {state.log.length === 0 && <tr><td colSpan={5} className="muted">Nothing yet.</td></tr>}
            {state.log.map((e) => (
              <tr key={e.id}>
                <td className="t2 nowrap">{formatDateTime(e.at)}</td>
                <td><span className={`tag${e.type === 'granted' ? ' ok' : e.type === 'revoked' ? ' err' : ''}`}>{TYPE_WORD[e.type] ?? e.type}</span></td>
                <td>{e.badgeId ? (defs.get(e.badgeId)?.name ?? e.badgeId) : '—'}{e.type === 'thresholds' && e.detail?.to ? <span className="muted xsmall"> → {e.detail.to.map(formatNumber).join(' / ')}</span> : null}</td>
                <td>{e.guild ? (e.guild.slug ? <Link to={`/g/${encodeURIComponent(e.guild.slug)}`}>{e.guild.name}</Link> : `#${e.guild.id}`) : e.type === 'backfill' ? `${formatNumber(e.detail?.guilds ?? 0)} guilds` : '— all guilds —'}</td>
                <td className="t2">{e.reason ?? ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
