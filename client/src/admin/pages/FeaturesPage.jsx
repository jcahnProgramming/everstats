import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api.js';
import { Icon } from '../../chrome/Icon.jsx';
import { Field, Toggle } from '../../components/Controls.jsx';
import { formatDateTime, formatNumber } from '../../format.js';
import { Panel, usePanel } from '../shell/refresh.jsx';
import { ActionStatus, Chip, ConfirmDialog, Empty, PageHead, useAction, useHit } from '../shell/parts.jsx';
import './features.css';

/**
 * Features (0.10.3, design/v5-admin pages/features + features-confirm; components feature-card, confirm-dialog).
 *
 * Every on/off switch, from the ONE registry (server/features/registry.js, GET /api/admin/features): this page names no
 * feature by hand. Each card: name, the switch, its state, who sees it, what it does, what visitors see when it is off,
 * what it needs and what needs it, its own settings, and its last change with the reason. A card's id is feat-<id>, so
 * the settings search lands on it.
 *
 * Turning one off opens the confirm dialog: what visitors will see, every dependent that goes with it (and its
 * fallback), a required reason (the audit log keeps it), and for a change players see, an acknowledgement. Turning one
 * on asks for a reason too. The card shows working → done → result in place.
 *
 * Different from the mockup, on purpose:
 *   - The groups sit inside one refresh panel ("Switches"), so the page's data follows the shared refresh system
 *     (stamp, Updating…, error with Retry) like every other admin page.
 *   - "Last changed by Admin": the admin is the only one who can change a switch; the card says when and why, from the
 *     audit log. A switch never changed since 0.10.3 says "Not changed since switches were added" (nothing invented).
 *   - Only the settings that live with a feature are edited on its card (the renders-off note, the beta perks). Settings
 *     that belong to Settings › Crawler limits / Share cards (budget, concurrency, per-day caps) are shown with their
 *     current value and a link there, so each setting has one home.
 *   - The game-version cards are read-only until 0.11.0 (the registry says why); the mockup draws Retail as switchable.
 */
export function FeaturesPage() {
  const p = usePanel('features', () => api('/api/admin/features'), []);
  const [filter, setFilter] = useState('');
  useHit(p.data);

  const features = p.data?.features ?? [];
  const names = useMemo(() => Object.fromEntries(features.map((f) => [f.id, f.name])), [features]);
  const words = filter.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const shown = features.filter((f) => words.every((w) => `${f.name} ${f.does} ${f.whenOff} ${f.id}`.toLowerCase().includes(w)));
  // The groups, in the registry's order (server FEATURE_GROUPS: each feature carries its group).
  const groups = useMemo(() => {
    const seen = new Map();
    for (const f of features) if (!seen.has(f.group)) seen.set(f.group, { id: f.group, label: f.groupLabel, order: f.groupOrder });
    return [...seen.values()].sort((a, b) => a.order - b.order);
  }, [features]);
  const update = (list) => p.setData((d) => ({ ...d, features: list }));

  return (
    <>
      <PageHead
        title="Features"
        desc="Every switch here is safe: turning a feature off shows its fallback instead of breaking the page. Changes ask for a reason and are logged."
        actions={(
          <label className="search">
            <Icon name="search" size="sm" />
            <input placeholder="Filter switches" aria-label="Filter switches" value={filter} onChange={(e) => setFilter(e.target.value)} />
          </label>
        )}
      />
      <Panel panel={p} title="Switches" id="features" sub={p.data ? <span className="muted xsmall">{formatNumber(features.length)} switches</span> : null} ghostRows={6}>
        {() => (
          <div className="stack gap-24 feat-groups">
            {shown.length === 0 && <Empty icon="search" title="No switch matches that">Try another word, or clear the filter.</Empty>}
            {groups.map((g) => {
              const inGroup = shown.filter((f) => f.group === g.id);
              if (!inGroup.length) return null;
              return (
                <section key={g.id} className="stack gap-10" aria-labelledby={`fg-${g.id}`}>
                  <div className="orn"><span className="gem" /><h2 className="h3" id={`fg-${g.id}`}>{g.label}</h2><span className="rule" /><span className="muted xsmall">{inGroup.length} switch{inGroup.length === 1 ? '' : 'es'}</span></div>
                  <div className="fgrid">
                    {inGroup.map((f) => <FeatureCard key={f.id} feature={f} all={features} names={names} settings={p.data.settings ?? []} onChanged={update} onSettings={() => p.reload()} />)}
                  </div>
                </section>
              );
            })}
          </div>
        )}
      </Panel>
    </>
  );
}

const list = (ids, names) => (ids.length ? ids.map((id) => names[id] ?? id).join(' · ') : '—');

function FeatureCard({ feature: f, all, names, settings, onChanged, onSettings }) {
  const action = useAction();
  const [asking, setAsking] = useState(null); // true = turning on, false = turning off
  const locked = Boolean(f.locked);
  // Dependents that are on now: they stop working with this one (the server asks for confirmDependents for these).
  const affected = all.filter((d) => f.usedBy.includes(d.id) && d.on).map((d) => ({ name: d.name, fallback: d.whenOff }));

  const change = async (on, reason) => {
    action.set('working', on ? 'Turning on…' : 'Turning off…');
    try {
      const r = await api(`/api/admin/features/${encodeURIComponent(f.id)}`, { method: 'PUT', body: { on, reason, confirmDependents: !on && affected.length > 0 } });
      onChanged(r.features);
      action.set('done', `${on ? 'Turned on' : 'Turned off'} · in the audit log`);
    } catch (err) {
      action.set('failed', err.message ?? 'Didn’t change');
      throw err; // the dialog shows it too, and stays open
    }
  };

  const state = !f.on
    ? <Chip kind="off">Off</Chip>
    : f.working ? <Chip kind="ok">On</Chip>
      : <Chip kind="warn" title="On, but something it needs is off">On · waiting for {list(f.blockedBy, names)}</Chip>;

  return (
    <article className={`fcard${f.on ? '' : ' is-off'}`} id={`feat-${f.id}`} aria-labelledby={`feat-${f.id}-h`}>
      <div className="top">
        <h3 id={`feat-${f.id}-h`}>{f.name}</h3>
        <Toggle checked={f.on} disabled={locked || action.busy} onChange={(on) => setAsking(on)}>
          <span className="state">{f.on ? 'On' : 'Off'}</span>
        </Toggle>
        <div className="chips">
          {state}
          {f.playerVisible ? <Chip kind="vis">Visible to players</Chip> : <Chip kind="scope" icon="data">Admin and background only</Chip>}
        </div>
      </div>
      <p>{f.does}</p>
      <dl>
        <dt>When off</dt><dd>{f.whenOff}</dd>
        <dt>Needs</dt><dd>{list(f.needs, names)}</dd>
        <dt>Used by</dt><dd>{list(f.usedBy, names)}</dd>
        {f.beta && (
          <>
            <dt>Opened</dt><dd>{f.beta.openedAt ? formatDateTime(f.beta.openedAt) : 'Never'}</dd>
            {!f.beta.open && <><dt>Closed</dt><dd>{f.beta.closedAt ? formatDateTime(f.beta.closedAt) : '—'}</dd></>}
          </>
        )}
      </dl>
      {locked && (
        <p className="muted xsmall">
          <Icon name="lock" size="sm" /> {f.locked === 'primary' ? 'The primary version can’t be switched off: every page needs it.' : 'Decided in code (and GAME_VERSIONS= in .env) until 0.11.0 builds its pages; it can’t be switched here yet.'}
        </p>
      )}
      <OwnSettings feature={f} settings={settings} onSaved={onSettings} />
      <div className="row gap-8 wrap-row feat-foot">
        <span className="by">
          {f.changedAt ? <>Last changed by Admin · {formatDateTime(f.changedAt)}{f.changedReason ? <> · “{f.changedReason}”</> : null}</> : locked ? 'Set in code' : 'Not changed since switches were added'}
        </span>
        <span className="spacer" />
        <ActionStatus action={action} />
      </div>
      {asking !== null && (
        asking ? (
          <ConfirmDialog
            title={`Turn on ${f.name}?`}
            what={f.does}
            playersSee={f.playerVisible}
            danger={false}
            confirmLabel="Turn on"
            onConfirm={(reason) => change(true, reason)}
            onClose={() => setAsking(null)}
          />
        ) : (
          <ConfirmDialog
            title={`Turn off ${f.name}?`}
            what={f.playerVisible ? `Visitors will see: ${f.whenOff}` : `What happens: ${f.whenOff}`}
            playersSee={f.playerVisible}
            affected={affected}
            ack={f.playerVisible ? 'I understand players see this change at once.' : null}
            confirmLabel="Turn off"
            onConfirm={(reason) => change(false, reason)}
            onClose={() => setAsking(null)}
          />
        )
      )}
    </article>
  );
}

// Settings edited on the card; every other own setting links to its one home on the Settings page.
const EDITORS = { text: TextEditor, perks: PerksEditor };

function OwnSettings({ feature: f, settings, onSaved }) {
  const own = f.settings.map((k) => settings.find((s) => s.key === k)).filter(Boolean);
  if (!own.length) return null;
  return (
    <div className="own">
      {own.map((s) => {
        const Editor = EDITORS[s.type] && !['crawler', 'cards'].includes(s.section) ? EDITORS[s.type] : null;
        return Editor
          ? <Editor key={s.key} setting={s} onSaved={onSaved} />
          : (
            <div key={s.key} className="row gap-8 wrap-row" id={`set-${s.key}`}>
              <span className="small">{s.label}: <b>{typeof s.value === 'number' ? formatNumber(s.value) : String(s.value)}</b></span>
              <span className="spacer" />
              <Link className="btn ghost sm" to={`/admin/settings#set-${s.key}`}>Edit in Settings</Link>
            </div>
          );
      })}
    </div>
  );
}

function saveSetting(key, value) {
  return api(`/api/admin/settings/${encodeURIComponent(key)}`, { method: 'PUT', body: { value } });
}

/** A one-line plain-text setting (the note shown while renders are off). */
function TextEditor({ setting: s, onSaved }) {
  const a = useAction();
  const [value, setValue] = useState(s.value ?? '');
  const id = `set-${s.key}`;
  return (
    <div className="stack gap-6" id={id}>
      <label className="lbl" htmlFor={`${id}-inp`}>{s.label}</label>
      <textarea id={`${id}-inp`} className="inp" value={value} maxLength={s.max} onChange={(e) => setValue(e.target.value)} />
      <div className="row gap-8 wrap-row">
        <span className="muted xsmall">{s.help} {value.length} / {s.max}</span>
        <span className="spacer" />
        <ActionStatus action={a} />
        <button type="button" className={`btn sm${a.busy ? ' is-loading' : ''}`} disabled={a.busy || value === s.value}
          onClick={() => a.run(async () => { await saveSetting(s.key, value); onSaved(); }, { done: 'Saved · in the audit log', working: 'Saving…' })}>
          Save
        </button>
      </div>
    </div>
  );
}

/** The beta perks the /beta page lists (moved from the old admin's PerksEditor). */
function PerksEditor({ setting, onSaved }) {
  const a = useAction();
  const [items, setItems] = useState(setting.value ?? []);
  const set = (i, k, v) => setItems((xs) => xs.map((x, j) => (j === i ? { ...x, [k]: v } : x)));
  return (
    <div className="stack gap-10" id={`set-${setting.key}`}>
      <span className="lbl">{setting.label}</span>
      <span className="muted xsmall">{setting.help}</span>
      {items.map((p, i) => (
        // eslint-disable-next-line react/no-array-index-key
        <div key={i} className="feat-perk stack gap-8">
          <Field label="Title" value={p.title} maxLength={60} onChange={(e) => set(i, 'title', e.target.value)} />
          <Field label="Description" value={p.description} maxLength={300} onChange={(e) => set(i, 'description', e.target.value)} />
          <button type="button" className="btn ghost sm self-start" onClick={() => setItems((xs) => xs.filter((_, j) => j !== i))}>Remove</button>
        </div>
      ))}
      <div className="row gap-8 wrap-row">
        <button type="button" className="btn sm" disabled={items.length >= 12} onClick={() => setItems((xs) => [...xs, { title: '', description: '' }])}><Icon name="plus" size="sm" />Add a perk</button>
        <span className="spacer" />
        <ActionStatus action={a} />
        <button type="button" className={`btn sm${a.busy ? ' is-loading' : ''}`} disabled={a.busy}
          onClick={() => a.run(async () => { await saveSetting(setting.key, items); onSaved(); }, { done: 'Perks saved · /beta shows them now', working: 'Saving…' })}>
          Save perks
        </button>
      </div>
    </div>
  );
}
