import { useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { api } from '../../api.js';
import { Icon } from '../../chrome/Icon.jsx';
import { Segmented } from '../../components/Controls.jsx';
import { formatDateTime, formatNumber, timeAgo } from '../../format.js';
import { Panel, usePanel } from '../shell/refresh.jsx';
import { ActionButton, ActionStatus, Change, Chip, ConfirmDialog, Empty, PageHead, ScopeChip, useAction, useHit } from '../shell/parts.jsx';
import './site.css';

/**
 * Admin › Settings (0.10.3, design/v5-admin pages/settings and settings-search). Numbers and keys; switches live on
 * Features, tier settings on Tiers. Moved here from the old admin page: KeysSection (API keys), ProxiesSection, the
 * crawler / discovery / share-card numbers (SettingRow and its variants), Version budget shares, Grading's guild
 * thresholds and the retention window (RetentionSection's form).
 *
 * Every row has id "set-<key>", so settings search lands on it (useHit). Edits collect in the sticky save bar; Save asks
 * for a reason when a change affects players (PLAYER_FACING below) and sends { value, reason } to
 * PUT /api/admin/settings/:key, which logs before → after and the reason.
 *
 * Different from the mockup, on purpose (CLAUDE.md rules win, or the setting doesn't exist):
 *   - TRUSTED_PROXIES is read only: it lives in .env and the app never writes .env.
 *   - Version budget shares are CEILINGS (0–100 each), not a split that must add up to 100; a version that is off can
 *     still have its ceiling set ahead of time.
 *   - Retention shows Blizzard's maximum (30 days by default) and says the database deletes one day sooner; above 30
 *     days needs the written-permission note, as before.
 *   - No "Character refresh cooldown" or "boards.minIndexEntries": neither exists in server/admin/settings.js.
 *   - No Preview button in the save bar: these settings have nothing to preview (the tier preview lives on Tiers).
 */

/** Settings whose change players notice: Save asks for a reason (it goes to the audit log). */
export const PLAYER_FACING = new Set([
  'guilds.fetchConcurrent', // "Queued: starts after N other guilds"
  'guilds.fetchCooldownHours', // when "Fetch all members" opens again
  'dashboard.maxPinnedGuilds', // how many guilds a player can pin
  'cards.maxConcurrent', // how often a share card says "try again in a few seconds"
  'guilds.minMembers', // which guilds are ranked on guild boards
  'guilds.minBoardGuilds', // which boards a guild page lists
  'retention.window', // how long data lives; "Last N days" boards follow it
]);

const UNITS = {
  'crawler.requestsPerSecond': 'req / s',
  'discovery.requestsPerSecond': 'req / s',
  'discovery.maxCharacters': 'characters',
  'collections.backfillPerDay': 'characters a day',
  'dashboard.maxPinnedGuilds': 'guilds',
  'guilds.fetchConcurrent': 'at once',
  'guilds.fetchCooldownHours': 'hours',
  'cards.maxConcurrent': 'at once',
  'guilds.minMembers': 'members',
  'guilds.minBoardGuilds': 'guilds',
};

const FEATURE_OF = { 'crawler.paused': 'crawl', 'crawler.rosterExpansion': 'roster-seed', 'collections.backfill': 'collections-backfill' };

const SECTIONS = [
  { id: 'keys', label: 'API keys' },
  { id: 'proxies', label: 'Proxy addresses' },
  { id: 'crawler', label: 'Crawler limits' },
  { id: 'shares', label: 'Version budget shares' },
  { id: 'grading', label: 'Grading' },
  { id: 'retention', label: 'Retention' },
];

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** A draft (what the inputs hold) → the value the server takes. */
function valueOf(s, draft) {
  if (s.type === 'integer') return draft.trim() === '' ? NaN : Number(draft.replaceAll(',', ''));
  if (s.type === 'versionShares') return Object.fromEntries(Object.entries(draft).map(([k, v]) => [k, Number(String(v).trim() === '' ? NaN : v)]));
  if (s.type === 'retention') return { days: Number(draft.days), note: draft.note ?? '' };
  return draft;
}
const draftOf = (s) => (s.type === 'integer' ? String(s.value) : s.type === 'versionShares' ? Object.fromEntries(Object.entries(s.value ?? {}).map(([k, v]) => [k, String(v)]))
  : s.type === 'retention' ? { days: String(s.value?.days ?? ''), note: s.value?.note ?? '' } : s.value);
const isDirty = (s, draft) => draft !== undefined && !same(valueOf(s, draft), s.type === 'retention' ? { days: s.value.days, note: s.value.note ?? '' } : s.value);

function show(s, v) {
  if (v === null || v === undefined) return '—';
  if (s.type === 'choice') return s.options?.find((o) => o.value === v)?.label ?? String(v);
  if (s.type === 'retention') return `${v.days} days`;
  if (s.type === 'boolean') return v ? 'On' : 'Off';
  if (s.type === 'versionShares') return Object.entries(v).map(([k, n]) => `${k} ${n}%`).join(', ');
  if (typeof v === 'number') return `${formatNumber(v)}${UNITS[s.key] ? ` ${UNITS[s.key]}` : ''}`;
  return String(v);
}

export function SettingsPage() {
  const keys = usePanel('settings-keys', () => api('/api/admin/data/keys'), []);
  const proxies = usePanel('settings-proxies', () => api('/api/admin/data/proxies'), []);
  const sp = usePanel('settings-values', () => api('/api/admin/data/settings'), []);
  const [drafts, setDrafts] = useState({});
  const [rowErrors, setRowErrors] = useState({});
  const [confirm, setConfirm] = useState(null);
  const save = useAction();
  const { hash } = useLocation();
  useHit(sp.data && keys.data);

  const byKey = useMemo(() => new Map((sp.data?.settings ?? []).map((s) => [s.key, s])), [sp.data]);
  const dirty = Object.entries(drafts).filter(([k, d]) => byKey.has(k) && isDirty(byKey.get(k), d)).map(([k]) => byKey.get(k));
  const setDraft = (key, d) => {
    setDrafts((x) => ({ ...x, [key]: d }));
    setRowErrors((x) => ({ ...x, [key]: null }));
    if (save.phase !== 'working') save.reset();
  };

  const runSave = async (reason) => {
    const list = dirty;
    const errors = {};
    let saved = 0;
    let latest = null;
    for (const s of list) {
      try {
        const r = await api(`/api/admin/settings/${encodeURIComponent(s.key)}`, { method: 'PUT', body: { value: valueOf(s, drafts[s.key]), reason: reason || null } });
        latest = r.settings;
        saved += 1;
      } catch (err) {
        errors[s.key] = err.message;
      }
    }
    if (latest) sp.setData({ ...sp.data, settings: latest });
    setRowErrors(errors);
    setDrafts((x) => Object.fromEntries(Object.entries(x).filter(([k]) => errors[k])));
    const failed = Object.keys(errors).length;
    if (failed) throw new Error(`${saved ? `Saved ${saved}. ` : ''}${failed} couldn’t be saved: see the highlighted row${failed === 1 ? '' : 's'}.`);
    return saved;
  };

  const onSave = () => {
    if (dirty.some((s) => PLAYER_FACING.has(s.key))) setConfirm(dirty);
    else save.run(() => runSave(null), { working: 'Saving…', done: (n) => `Saved ${n} setting${n === 1 ? '' : 's'}` });
  };

  const rowProps = (s) => ({ s, draft: drafts[s.key], setDraft: (d) => setDraft(s.key, d), error: rowErrors[s.key] ?? null });
  const current = SECTIONS.find((x) => `#${x.id}` === hash)?.id ?? null;

  return (
    <>
      <PageHead title="Settings" chips={<ScopeChip global />}
        desc="Numbers and keys. Each setting shows its default; switches live in Features and tier settings on Tiers. Saving asks for a reason when it affects players." />
      {(dirty.length > 0 || save.phase !== 'idle') && (
        <div className="savebar" role="region" aria-label="Unsaved changes">
          <b>{dirty.length ? `${dirty.length} unsaved change${dirty.length === 1 ? '' : 's'}` : 'No unsaved changes'}</b>
          <ActionStatus action={save} />
          <span className="spacer" />
          <button type="button" className="btn sm ghost" disabled={!dirty.length || save.busy} onClick={() => { setDrafts({}); setRowErrors({}); save.reset(); }}>Discard</button>
          <button type="button" className={`btn sm gold${save.busy ? ' is-loading' : ''}`} disabled={!dirty.length || save.busy} onClick={onSave}>
            {dirty.some((s) => PLAYER_FACING.has(s.key)) ? 'Save…' : 'Save'}
          </button>
        </div>
      )}
      <div className="inpage">
        <nav aria-label="Settings sections">
          {SECTIONS.map((x) => <a key={x.id} href={`#${x.id}`} aria-current={current === x.id ? 'true' : undefined}>{x.label}</a>)}
          <Link to="/admin/tiers">Tier settings ›</Link>
          <Link to="/admin/features">Switches ›</Link>
        </nav>
        <div className="stack gap-16">
          <Panel panel={keys} title="API keys" id="keys" flush sub={<span className="muted xsmall">Values are never shown</span>}
            footer="Stored encrypted with the root key from .env and never sent to a browser: you see whether a key is set, where from, and when. Keys in .env are used when none is stored here. Everstats never writes .env.">
            {(d) => <div className="setgroup">{d.credentials.map((c) => <KeyRow key={c.id} c={c} onChanged={keys.reload} />)}</div>}
          </Panel>

          <Panel panel={proxies} title="Proxy addresses" id="proxies" flush>
            {(d) => <Proxies d={d} />}
          </Panel>

          <Panel panel={sp} title="Crawler limits" id="crawler" flush
            footer={<span>Pause, roster seeding and the backfill are switches on <Link to="/admin/features#feat-crawl">Features</Link>.</span>}>
            {(d) => (
              <div className="setgroup">
                {d.settings.filter((s) => ['crawler', 'cards', 'discovery'].includes(s.section) && s.type !== 'versionShares').map((s) => (
                  s.type === 'boolean' ? <SwitchRow key={s.key} s={s} /> : <SettingRow key={s.key} {...rowProps(s)} />
                ))}
              </div>
            )}
          </Panel>

          <Panel panel={sp} title="Version budget shares" id="shares" flush sub={<span className="muted xsmall">A ceiling each, not a split</span>}>
            {(d) => {
              const s = d.settings.find((x) => x.key === 'crawler.versionShares');
              return s ? <SharesRows {...rowProps(s)} versions={d.versions} /> : <Empty title="Not declared" />;
            }}
          </Panel>

          <Panel panel={sp} title="Grading" id="grading" flush
            footer={<span>Letter shares, the ruleset minimum and the half rules are per game version, on <Link to="/admin/tiers">Tiers</Link>, with a preview before anything is saved.</span>}>
            {(d) => <div className="setgroup">{d.settings.filter((s) => s.section === 'grading').map((s) => <SettingRow key={s.key} {...rowProps(s)} />)}</div>}
          </Panel>

          <Panel panel={sp} title="Retention" id="retention" flush
            footer={<span>What is stored and when it expires: <Link to="/admin/retention">Data retention</Link>.</span>}>
            {(d) => <div className="setgroup">{d.settings.filter((s) => s.section === 'retention').map((s) => <RetentionRow key={s.key} {...rowProps(s)} />)}</div>}
          </Panel>
        </div>
      </div>
      {confirm && (
        <ConfirmDialog
          title={`Save ${confirm.length} setting${confirm.length === 1 ? '' : 's'}?`}
          what={<>{confirm.map((s) => <span key={s.key} className="site-change"><b>{s.label}</b>: <Change before={show(s, s.value)} after={show(s, valueOf(s, drafts[s.key]))} /></span>)}</>}
          playersSee
          confirmLabel="Save settings"
          danger={false}
          onConfirm={async (reason) => {
            setConfirm(null);
            await save.run(() => runSave(reason), { working: 'Saving…', done: (n) => `Saved ${n} setting${n === 1 ? '' : 's'}` });
          }}
          onClose={() => setConfirm(null)}
        />
      )}
    </>
  );
}

function DefaultText({ s, value }) {
  const changed = !same(s.type === 'retention' ? s.value?.days : s.value, s.type === 'retention' ? s.default?.days : s.default);
  const def = s.type === 'retention' ? `${s.default.days} days` : show(s, s.default);
  return (
    <span className={`d${changed ? ' changed' : ''}`}>
      {changed ? `Changed · default ${def}` : `Default ${def}`}
      {s.updatedAt && <span className="site-when">Saved {formatDateTime(s.updatedAt)}</span>}
      {value}
    </span>
  );
}

function Label({ s, extra = null }) {
  return (
    <div className="k">
      <b>{s.label}{PLAYER_FACING.has(s.key) ? <span className="site-pf" title="Saving asks for a reason">Players notice</span> : null}</b>
      <span>{s.help}</span>
      <code>{s.key}</code>
      {extra}
    </div>
  );
}

function SettingRow({ s, draft, setDraft, error }) {
  const d = draft ?? draftOf(s);
  const dirty = isDirty(s, draft);
  return (
    <div className={`srow${error ? ' site-row-err' : ''}${dirty ? ' site-dirty' : ''}`} id={`set-${s.key}`}>
      <Label s={s} extra={error ? <span className="site-err" role="alert">{error}</span> : null} />
      <div className="v">
        {s.type === 'choice' ? (
          <Segmented label={s.label} value={d} options={s.options.map((o) => ({ id: o.value, label: o.label }))} onChange={(v) => setDraft(v)} />
        ) : (
          <>
            <input className="inp num" inputMode="numeric" aria-label={s.label} value={d} onChange={(e) => setDraft(e.target.value)} />
            {UNITS[s.key] && <span className="unit">{UNITS[s.key]}</span>}
            {s.min !== undefined && s.max !== undefined && <span className="unit">{formatNumber(s.min)}–{formatNumber(s.max)}</span>}
          </>
        )}
      </div>
      <DefaultText s={s} />
    </div>
  );
}

/** A boolean in a settings section is a Features switch: shown here read only, so settings search still lands on it. */
function SwitchRow({ s }) {
  return (
    <div className="srow ro" id={`set-${s.key}`}>
      <Label s={s} />
      <div className="v"><Chip kind={s.value ? 'ok' : 'off'}>{s.value ? 'On' : 'Off'}</Chip><span className="unit">a switch</span></div>
      <span className="d"><Link to={`/admin/features#feat-${FEATURE_OF[s.key] ?? ''}`}>Change in Features</Link></span>
    </div>
  );
}

function SharesRows({ s, draft, setDraft, error, versions }) {
  const d = draft ?? draftOf(s);
  return (
    <div className="setgroup site-group" id={`set-${s.key}`}>
      <div className="srow ro">
        <Label s={s} extra={error ? <span className="site-err" role="alert">{error}</span> : null} />
        <div className="v" />
        <DefaultText s={s} />
      </div>
      {versions.map((v) => {
        const val = d[v.id] ?? String(s.default?.[v.id] ?? '');
        const changed = Number(val) !== s.value?.[v.id];
        return (
          <div className={`srow${changed && draft ? ' site-dirty' : ''}`} key={v.id}>
            <div className="k"><b>{v.name}</b><span>{v.enabled ? 'On' : 'Off in Features: the ceiling applies once it is turned on.'}</span></div>
            <div className="v">
              <input className="inp num" inputMode="numeric" aria-label={`${v.name} ceiling`} value={val} onChange={(e) => setDraft({ ...d, [v.id]: e.target.value })} />
              <span className="unit">% of the budget at most</span>
            </div>
            <span className="d">Default {s.default?.[v.id]}%</span>
          </div>
        );
      })}
    </div>
  );
}

function RetentionRow({ s, draft, setDraft, error }) {
  const d = draft ?? draftOf(s);
  const days = Number(d.days);
  return (
    <div className={`srow${error ? ' site-row-err' : ''}${isDirty(s, draft) ? ' site-dirty' : ''}`} id={`set-${s.key}`}>
      <Label s={s} extra={(
        <>
          {s.value?.note && <span>Permission on record: {s.value.note}</span>}
          {error && <span className="site-err" role="alert">{error}</span>}
        </>
      )} />
      <div className="v">
        <input className="inp num" inputMode="numeric" aria-label={s.label} value={d.days} onChange={(e) => setDraft({ ...d, days: e.target.value })} />
        <span className="unit">days{Number.isInteger(days) && days > 1 ? ` · deletes at ${days - 1}` : ''}</span>
        {days > 30 && (
          <label className="field site-wide">
            <span className="lab">Blizzard’s written permission (who, when, what was granted) · required above 30 days, and logged</span>
            <textarea className="inp" maxLength={1000} value={d.note} onChange={(e) => setDraft({ ...d, note: e.target.value })} />
          </label>
        )}
      </div>
      <DefaultText s={s} />
    </div>
  );
}

// ---- API keys ----
const KEY_STATE = {
  configured: (c) => ({ kind: 'ok', text: c.source === 'env' ? 'Set in .env' : 'Set' }),
  not_configured: () => ({ kind: 'off', text: 'Not set' }),
  incomplete: () => ({ kind: 'warn', text: 'Incomplete' }),
  cant_decrypt: () => ({ kind: 'err', text: 'Can’t decrypt' }),
};

function KeyRow({ c, onChanged }) {
  const [open, setOpen] = useState(false);
  const [removing, setRemoving] = useState(false);
  const test = useAction();
  const removed = useAction();
  const tag = (KEY_STATE[c.state] ?? KEY_STATE.not_configured)(c);
  const where = c.source === 'database' ? `Saved here · ${formatDateTime(c.setAt)}` : c.source === 'env' ? 'From .env' : `${c.unlocks}: off until this is set`;
  return (
    <>
      <div className={`srow${c.state === 'cant_decrypt' ? ' site-row-err' : ''}`} id={`set-key-${c.id}`}>
        <div className="k">
          <b>{c.label}</b>
          <span>Unlocks: {c.unlocks}</span>
          <code>{c.fields.map((f) => f.env).join(' · ')}</code>
          {c.problem && <span className="site-err">{c.problem}</span>}
        </div>
        <div className="v">
          <Chip kind={tag.kind}>{tag.text}</Chip>
          <span className="unit">{where}</span>
          <ActionStatus action={test} />
          <ActionStatus action={removed} />
        </div>
        <span className="d">
          <span className="act row gap-4">
            {c.test && c.state === 'configured' && (
              <ActionButton action={test} className="btn sm ghost" title={c.test.does} working="Testing…"
                onRun={async () => {
                  const { result } = await api(`/api/admin/credentials/${c.id}/test`, { method: 'POST', body: {} });
                  if (!result.ok) throw new Error(`Failed: ${result.message ?? 'no detail'}`);
                  return result;
                }}
                done={(r) => `Works${r.message ? `: ${r.message}` : ''}`}>Test</ActionButton>
            )}
            <button type="button" className={`btn sm ${c.state === 'configured' ? 'ghost' : 'gold'}`} aria-expanded={open} onClick={() => setOpen((x) => !x)}>
              {c.source === 'database' ? 'Replace…' : 'Set…'}
            </button>
            {c.source === 'database' && <button type="button" className="btn sm danger" onClick={() => setRemoving(true)}>Remove…</button>}
          </span>
        </span>
      </div>
      {open && <KeyForm c={c} onDone={() => { setOpen(false); onChanged(); }} onCancel={() => setOpen(false)} />}
      {removing && (
        <ConfirmDialog
          title={`Remove the stored ${c.label}?`}
          what={`The keys saved here are deleted. ${c.fields.some((f) => f.env) ? 'If .env has them, those apply again; otherwise ' : ''}${c.unlocks} stops working until keys are entered again.`}
          playersSee
          confirmLabel={`Remove ${c.label}`}
          onConfirm={async (reason) => {
            await removed.run(() => api(`/api/admin/data/keys/${c.id}/remove`, { method: 'POST', body: { reason } }), { working: 'Removing…', done: 'Removed' });
            onChanged();
          }}
          onClose={() => setRemoving(false)}
        />
      )}
    </>
  );
}

function KeyForm({ c, onDone, onCancel }) {
  const [values, setValues] = useState({});
  const [reason, setReason] = useState('');
  const a = useAction();
  const submit = async (e) => {
    e.preventDefault();
    const r = await a.run(() => api(`/api/admin/data/keys/${c.id}`, { method: 'PUT', body: { ...values, reason: reason.trim() || null } }), { working: 'Saving…', done: 'Saved' });
    if (r) {
      setValues({});
      onDone();
    }
  };
  return (
    <form className="site-keyform stack gap-12" onSubmit={submit}>
      <div className="grid-auto col-md gap-12">
        {c.fields.map((f) => (
          <label key={f.name} className="field">
            <span className="lab">{f.label} <span className="muted">(.env fallback: {f.env})</span></span>
            <input className="inp mono" type="password" autoComplete="off" value={values[f.name] ?? ''} onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))} />
          </label>
        ))}
      </div>
      <label className="field">
        <span className="lab">Reason (optional, saved to the audit log)</span>
        <input className="inp" maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
      </label>
      <div className="row gap-8 wrap-row">
        <button type="submit" className={`btn sm gold${a.busy ? ' is-loading' : ''}`} disabled={a.busy}>Save keys</button>
        <button type="button" className="btn sm ghost" onClick={onCancel} disabled={a.busy}>Cancel</button>
        <ActionStatus action={a} />
      </div>
      <details className="small">
        <summary className="muted">Where to get these</summary>
        <ol className="t2 tips">{c.obtain.steps.map((s) => <li key={s}>{s}</li>)}</ol>
        <a href={c.obtain.url} target="_blank" rel="noopener noreferrer">{c.obtain.url} <Icon name="external" size="sm" /></a>
      </details>
    </form>
  );
}

// ---- Proxy addresses ----
function Proxies({ d }) {
  const { trustedProxies, check, sources } = d;
  return (
    <>
      <div className="setgroup">
        <div className="srow ro" id="set-TRUSTED_PROXIES">
          <div className="k">
            <b>Trusted proxies</b>
            <span>Connections allowed to say who the visitor is (Cloudflare’s CF-Connecting-IP). Put cloudflared’s address here, so nobody on the LAN can fake the header to dodge a rate limit.</span>
            <code>TRUSTED_PROXIES</code>
          </div>
          <div className="v">
            {trustedProxies ? <span className="mono2">{trustedProxies.join(', ')}</span> : <Chip kind="warn">Not set</Chip>}
            {check?.state === 'ok' && <Chip kind="ok">Inside this container’s network</Chip>}
          </div>
          <span className="d">Default: none · set in .env by hand</span>
        </div>
      </div>
      {check?.state === 'outside' && (
        <div className="note err small site-note" role="alert"><Icon name="error" /><span>None of TRUSTED_PROXIES is inside this container’s own network ({check.networks.join(', ') || 'none found'}). CF-Connecting-IP is being ignored, so every tunnel visitor shares one rate-limit bucket. Set it to the network’s gateway (EVERSTATS_SUBNET_PREFIX in docker-compose.yml, .1).</span></div>
      )}
      {!trustedProxies && (
        <div className="note warn small site-note"><Icon name="warning" /><span>Set this before announcing anything: character lookups spend the Blizzard budget, and their per-network limit only holds when the visitor’s network is read from a trusted proxy.</span></div>
      )}
      {sources === null ? (
        <Empty icon="info" title="Connections seen: not available here">This list comes from the web process; it wasn’t handed to this page.</Empty>
      ) : sources.length === 0 ? (
        <Empty icon="hourglass" title="None seen since this container started">Open the site once through the tunnel, then refresh.</Empty>
      ) : (
        <div className="dt-wrap">
          <table className="dt">
            <thead><tr><th>Connection from</th><th>Header</th><th className="r num">Requests since start</th><th>Last seen</th></tr></thead>
            <tbody>
              {sources.map((s) => (
                <tr key={`${s.address}|${s.honoured}`}>
                  <td className="dtl" data-label=""><span className="mono2">{s.address ?? 'unknown'}</span></td>
                  <td data-label="Header"><Chip kind={s.honoured ? 'ok' : 'warn'}>{s.honoured ? 'Trusted' : 'Not trusted · header ignored'}</Chip></td>
                  <td className="r num" data-label="Requests since start">{formatNumber(s.requests)}</td>
                  <td className="nw" data-label="Last seen">{timeAgo(s.lastSeenAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <span className="muted xsmall site-pad">Also in the log: <span className="mono2">{'docker logs everstats 2>&1 | grep CF-Connecting-IP'}</span>. Connection addresses only, never a visitor’s.</span>
    </>
  );
}
