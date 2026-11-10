import { useEffect, useMemo, useState } from 'react';
import { TIER_LETTERS } from '../../../../server/stats/tiers.js';
import { categoryWeights, weightsProblem } from '../../../../server/tiers/engine.js';
import { api } from '../../api.js';
import { Icon } from '../../chrome/Icon.jsx';
import { Segmented } from '../../components/Controls.jsx';
import { TierBadge } from '../../components/Tier.jsx';
import { formatDateTime, formatNumber, timeAgo } from '../../format.js';
import { Panel, usePanel } from '../shell/refresh.jsx';
import { ActionButton, ActionStatus, Chip, ConfirmDialog, Empty, PageHead, ScopeChip, ScopedLink, useAction, useHit } from '../shell/parts.jsx';
import { useScope } from '../shell/scope.jsx';
import './gamedata.css';

/**
 * /admin/tiers?v=&r= (0.10.3, design/v5-admin pages/tiers): grading for the game version the top bar's switcher shows.
 * Moved here from 0.6.0–0.10.0's TiersAdminPage (settings, weights, preview, what counts, gradings) and the group
 * decisions that sat on the Discovery page (GroupsSection). 0.10.0's own version pickers are gone: the switcher is the
 * one place a version is chosen. A version that is off ("Off · admin only") shows its data the same way.
 *
 *   Save bar      every tier change waits in a sticky "unsaved changes" bar (count, Discard, Preview, Save and regrade).
 *                 A change to the shares, minimums or weights must be PREVIEWED before Save; group decisions change what
 *                 counts, which the preview can't show (it grades with the live decisions), so the bar says so. "Save
 *                 and regrade…" asks for a reason (ConfirmDialog): it goes into each setting's audit-log entry and each
 *                 group decision's reasoning. Suggestions are never applied automatically.
 *   Letter shares / Minimums / Category weights / Group decisions   the editable parts, rows with ids set-<key> so the
 *                 settings search lands on them (useHit).
 *   Preview       per realm category: overall letters now (the last full grading) and after saving, nothing stored.
 *   What counts   read-only, from the Discovery decisions as they are now, each statistic linking to its decision on
 *                 /admin/discovery/approvals?stat=ID.
 *   Gradings      "Grade everyone now" shows requesting → queued → grading → done with the result IN PLACE: the panel
 *                 polls the gradings on its own 3 s clock ONLY while a grading is pending or running (and says so).
 *
 * Design differences (rules or data win): the design's "Category minimum (characters)" is our "share of a category's
 * counted statistics above zero" plus the overall-categories rule (that is what the engine grades by); the design's
 * group "Suggested" comes from the last grading run, ours is Forever's own choice (shown on other versions only:
 * that's the only suggestion the server makes); "regrade at the next 06:00 UTC run" is a full grading within about a
 * minute of saving (tiers/store.js debounce), so the page says that.
 */
const LETTER_CLASS = { S: 's1', A: 's2', B: 's3', C: 's4', D: 's5' };
const MINIMUMS = [
  { key: 'minPopulation', setting: 'grading.minPopulation', unit: 'tier-eligible characters', min: 1 },
  { key: 'categoryHalf', setting: 'tiers.categoryHalf', unit: '% of its counted statistics above zero', min: 1, max: 100 },
  { key: 'overallHalf', setting: 'tiers.overallHalf', unit: '% of overall categories with a letter', min: 1, max: 100 },
];
const approvalsLink = (id) => `/admin/discovery/approvals?stat=${id}`;
const pct = (x) => `${(x * 100).toFixed(1)}%`;

export function TiersPage() {
  const scope = useScope();
  const { version, versionName, apiQuery, enabled } = scope;
  const state = usePanel(`tiers:${version}`, () => api(`/api/admin/tiers?${apiQuery}`), [apiQuery]);
  const groups = usePanel(`tier-groups:${version}`, () => api(`/api/admin/discovery/groups?${apiQuery}`), [apiQuery]);
  // The gradings poll on their own 3 s clock ONLY while one is pending or running, so "Grade everyone now" (and a save)
  // shows queued → grading → done with its result without a reload. Otherwise it is an ordinary panel.
  const [inFlight, setInFlight] = useState(false);
  const runs = usePanel(`tier-runs:${version}`, () => api(`/api/admin/tiers/runs?${apiQuery}`), [apiQuery], { everyMs: inFlight ? 3000 : 0 });
  const [tracking, setTracking] = useState(null);
  useEffect(() => {
    setInFlight(Boolean(runs.data?.runs?.some((r) => r.status === 'pending' || r.status === 'running')));
  }, [runs.data]);
  useEffect(() => {
    setTracking(null);
  }, [version]);
  // After a save: follow the grading it asked for.
  const onSaved = async () => {
    const r = await api(`/api/admin/tiers/runs?${apiQuery}`);
    runs.setData(r);
    setTracking(r.runs.find((x) => x.status === 'pending' || x.status === 'running')?.id ?? null);
  };
  useHit(state.data);
  return (
    <>
      <PageHead
        title="Tiers"
        chips={<ScopeChip />}
        desc={`Letter grading for ${versionName}: shares, minimums, what counts and how the overall tier weighs its categories. Changes are previewed before they’re saved; a full grading follows within about a minute of saving.`}
      />
      {!enabled && (
        <div className="note small" role="status"><Icon name="info" /><span>{versionName} is off · admin only. Its settings are ready for when it opens; nothing on it is graded until its groups are decided below.</span></div>
      )}
      {/* The editor is keyed by version: switching versions starts from that version's saved values, never another's. */}
      <TierEditor key={version} state={state} groups={groups} onSaved={onSaved} />
      <GradingsPanel state={state} runs={runs} inFlight={inFlight} tracking={tracking} setTracking={setTracking} />
      <WhatCounts state={state} />
    </>
  );
}

/** Every editable part of the page and the save bar over them. Edits are kept apart from the loaded values, so the
 * shell's refresh never wipes what the admin is typing. */
function TierEditor({ state, groups, onSaved }) {
  const { version, versionName } = useScope();
  const [edits, setEdits] = useState({}); // field → string as typed
  const [groupEdits, setGroupEdits] = useState({}); // group label → choice ('counts' | 'category' | 'none' | 'cleared')
  const [preview, setPreview] = useState(null);
  const [confirming, setConfirming] = useState(false);
  const previewAction = useAction();
  const saveAction = useAction();
  const d = state.data;

  const initial = useMemo(() => (d ? {
    ...Object.fromEntries(TIER_LETTERS.map((l) => [l, String(d.settings.shares[l])])),
    ...Object.fromEntries(MINIMUMS.map((m) => [m.key, String(d.settings[m.key])])),
    ...Object.fromEntries(d.weights.map((w) => [`w:${w.key}`, w.pinned !== null ? String(w.pinned) : ''])),
  } : {}), [d]);
  const value = (k) => edits[k] ?? initial[k] ?? '';
  const edit = (k) => (e) => {
    const v = e.target.value;
    setEdits((x) => ({ ...x, [k]: v }));
    setPreview(null);
    previewAction.reset();
  };

  // Pins kept for categories not in the overall tier right now stay as they are (ignored until they are).
  const pins = () => {
    const out = Object.fromEntries(Object.entries(d?.settings.weights ?? {}).filter(([k]) => !d.weights.some((w) => w.key === k)));
    for (const w of d?.weights ?? []) {
      const v = value(`w:${w.key}`);
      if (String(v).trim() !== '') out[w.key] = Number(v);
    }
    return out;
  };
  const body = () => ({
    version,
    shares: Object.fromEntries(TIER_LETTERS.map((l) => [l, Number(value(l))])),
    ...Object.fromEntries(MINIMUMS.map((m) => [m.key, Number(value(m.key))])),
    weights: pins(),
  });

  // What changed, one entry per setting (the shares are one setting, the pins another) and per group decision.
  const changed = (k) => edits[k] !== undefined && String(edits[k]).trim() !== String(initial[k] ?? '').trim();
  const settingChanges = d ? [
    ...(TIER_LETTERS.some(changed) ? [{ name: 'Letter shares', before: TIER_LETTERS.map((l) => `${l} ${initial[l]}`).join(' · '), after: TIER_LETTERS.map((l) => `${l} ${value(l)}`).join(' · ') }] : []),
    ...MINIMUMS.filter((m) => changed(m.key)).map((m) => ({ name: metaOf(d, m.setting)?.label ?? m.setting, before: initial[m.key], after: value(m.key) })),
    ...(d.weights.some((w) => changed(`w:${w.key}`)) ? [{
      name: 'Pinned category weights',
      before: d.weights.filter((w) => initial[`w:${w.key}`] !== '').map((w) => `${w.label} ${initial[`w:${w.key}`]}%`).join(' · ') || 'none',
      after: d.weights.filter((w) => String(value(`w:${w.key}`)).trim() !== '').map((w) => `${w.label} ${value(`w:${w.key}`)}%`).join(' · ') || 'none',
    }] : []),
  ] : [];
  const groupList = groups.data?.groups ?? [];
  const choiceLabel = (c) => (c === 'cleared' ? 'Undecided' : groups.data?.choices?.[c] ?? c);
  const groupChanges = Object.entries(groupEdits)
    .map(([label, choice]) => ({ label, choice, was: groupList.find((g) => g.label === label)?.choice?.choice ?? 'cleared' }))
    .filter((g) => g.choice !== g.was);
  const count = settingChanges.length + groupChanges.length;

  const sum = TIER_LETTERS.reduce((n, l) => n + (Number(value(l)) || 0), 0);
  const plan = d ? { categories: d.weights.map((w) => ({ key: w.key, label: w.label, inOverall: true, overallIds: new Array(w.statistics) })) } : { categories: [] };
  const pinBad = d ? Object.values(pins()).some((v) => !Number.isFinite(v) || v < 0.1 || v > 99.9) : false;
  const weightProblem = !d ? null : pinBad ? 'A pinned weight is a number between 0.1 and 99.9.' : weightsProblem(plan, pins());
  const liveWeights = !d || weightProblem ? null : categoryWeights(plan, { weighting: 'sqrt', weights: pins() });
  const formProblem = sum !== 100 ? `The five shares add up to ${sum}: they must add up to 100.` : weightProblem;
  const needsPreview = settingChanges.length > 0;

  const discard = () => {
    setEdits({});
    setGroupEdits({});
    setPreview(null);
    previewAction.reset();
  };
  const runPreview = () => previewAction.run(async () => {
    const r = await api('/api/admin/tiers/preview', { method: 'POST', body: body() });
    setPreview(r.preview);
    return r.preview;
  }, { working: 'Grading a preview…', done: (p) => `Preview ready · ${formatNumber(p.counted)} counted statistics · ${formatNumber(p.ms)} ms · nothing saved` });

  const save = async (reason) => {
    // The settings first (one transaction on the server, each change logged with the reason), then each group decision
    // (its reasoning is the same reason). Every one of them asks for a full grading; the server folds them into one.
    if (needsPreview) await api('/api/admin/tiers/settings', { method: 'PUT', body: { ...body(), reason } });
    for (const g of groupChanges) await api('/api/admin/discovery/groups', { method: 'POST', body: { version, group: g.label, choice: g.choice, reasoning: reason } });
    setEdits({});
    setGroupEdits({});
    setPreview(null);
    previewAction.reset();
    saveAction.set('done', `Saved ${count} change${count === 1 ? '' : 's'} · a full grading is queued (Gradings, below)`);
    state.reload();
    groups.reload();
    onSaved().catch(() => {});
  };

  const affected = [
    ...settingChanges.map((c) => ({ name: c.name, fallback: `${c.before} → ${c.after}` })),
    ...groupChanges.map((g) => ({ name: `Group “${g.label}”`, fallback: `${choiceLabel(g.was)} → ${choiceLabel(g.choice)}` })),
  ];

  return (
    <>
      {count > 0 && (
        <div className="savebar" role="region" aria-label="Unsaved tier changes">
          <Chip kind="warn">{count} unsaved change{count === 1 ? '' : 's'}</Chip>
          <span className="gd-changes">{[...settingChanges.map((c) => c.name), ...groupChanges.map((g) => `Group decision · ${g.label}`)].join(' · ')}</span>
          <span className="spacer" />
          <ActionStatus action={previewAction} idle={needsPreview && !preview ? 'Preview first: Save stays off until you’ve seen what it changes.' : !needsPreview ? 'Group decisions change what counts; the preview grades with the saved decisions, so it can’t show them.' : null} />
          <button type="button" className="btn sm ghost" onClick={discard}>Discard</button>
          <ActionButton action={previewAction} className="btn sm" icon="chart" disabled={!needsPreview || Boolean(formProblem)} onRun={runPreview} working="Grading a preview…">Preview</ActionButton>
          <button type="button" className="btn sm gold" disabled={Boolean(formProblem) || (needsPreview && !preview)} onClick={() => setConfirming(true)}>Save and regrade…</button>
        </div>
      )}
      {count === 0 && saveAction.phase !== 'idle' && <div className="gd-row"><ActionStatus action={saveAction} /></div>}
      {formProblem && count > 0 && <div className="note err small" role="alert"><Icon name="error" /><span>{formProblem}</span></div>}

      <Panel panel={state} title="Letter shares" id="set-tiers.shares" sub={<StampOf d={d} k="tiers.shares" />}>
        {() => (
          <>
            <div className="splitbar" role="img" aria-label={TIER_LETTERS.map((l) => `${l} ${value(l)}%`).join(', ')}>
              {TIER_LETTERS.map((l) => {
                const n = Math.max(0, Number(value(l)) || 0);
                return n > 0 ? <span key={l} className={LETTER_CLASS[l]} style={{ width: `${(n / Math.max(sum, 100)) * 100}%` }}>{l} {n}%</span> : null;
              })}
            </div>
            <div className="gd-shares">
              {TIER_LETTERS.map((l) => (
                <label key={l} className="field">
                  <span className="lab gd-share-lab"><TierBadge letter={l} size="sm" />{l} %</span>
                  <input className="inp num" inputMode="numeric" value={value(l)} onChange={edit(l)} aria-label={`${l} share in percent`} />
                </label>
              ))}
              <span className={`xsmall ${sum === 100 ? 'muted' : 'err-text'}`}>Adds up to {sum}. Must add up to 100. Best first; the same shares apply to every category tier and the overall tier.</span>
            </div>
          </>
        )}
      </Panel>

      <Panel panel={state} title="Minimums" id="tier-minimums" flush>
        {() => (
          <div className="setgroup">
            {MINIMUMS.map((m) => {
              const meta = metaOf(d, m.setting);
              const def = meta?.default;
              const isDefault = def !== undefined && String(def) === String(initial[m.key]);
              return (
                <div key={m.key} className="srow" id={`set-${m.setting}`}>
                  <div className="k"><b>{meta?.label ?? m.setting}</b><span>{meta?.help}</span><code>{m.setting}</code></div>
                  <div className="v">
                    <input className="inp num" inputMode="numeric" value={value(m.key)} onChange={edit(m.key)} aria-label={meta?.label ?? m.setting} />
                    <span className="unit">{m.key === 'minPopulation' ? `${d.categoryWord === 'ruleset' ? 'per ruleset' : `per ${d.categoryWord}`} · ${m.unit}` : m.unit}</span>
                    {changed(m.key) && <Chip kind="warn" icon="edit">Unsaved</Chip>}
                  </div>
                  <span className={`d${isDefault ? '' : ' changed'}`}>{def === undefined ? '' : isDefault ? `Default ${formatNumber(def)}` : `Changed · default ${formatNumber(def)}`}</span>
                </div>
              );
            })}
          </div>
        )}
      </Panel>

      <GroupsPanel groups={groups} edits={groupEdits} onEdit={(label, choice) => setGroupEdits((x) => ({ ...x, [label]: choice }))} />

      <div className="cols2">
        <Panel panel={state} title="Category weights" id="set-tiers.weights" flush
          footer="Each category weighs √(its statistics counting toward overall), as a share of the total. Pin a percent to fix one; leave it blank to follow the formula. The unpinned ones share what’s left by the same formula, so everything adds up to 100%.">
          {() => (d.weights.length === 0 ? <Empty icon="info" title="No category counts toward the overall tier yet">Decide the groups (above) or statistics on Discovery › Approvals.</Empty> : (
            <>
              <div className="dt-wrap">
                <table className="dt">
                  <thead><tr><th scope="col">Category</th><th scope="col" className="r num">Stats</th><th scope="col">Formula</th><th scope="col">Pinned %</th><th scope="col" className="r">Effective</th></tr></thead>
                  <tbody>
                    {d.weights.map((w, i) => (
                      <tr key={w.key}>
                        <td className="dtl" data-label=""><b>{w.label}</b></td>
                        <td className="r num" data-label="Stats">{formatNumber(w.statistics)}</td>
                        <td data-label="Formula"><span className="mono2">√{w.statistics} → {pct(w.formula)}</span></td>
                        <td data-label="Pinned %"><input className="inp num gd-num" inputMode="decimal" placeholder="formula" value={value(`w:${w.key}`)} onChange={edit(`w:${w.key}`)} aria-label={`${w.label} pinned weight in percent`} /></td>
                        <td className="r" data-label="Effective"><span className="num">{liveWeights ? `${pct(liveWeights[i].weight)}${liveWeights[i].pinned !== null ? ' · pinned' : ''}` : '–'}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {weightProblem && <div className="perr" role="alert"><Icon name="error" /><span>{weightProblem}</span></div>}
            </>
          ))}
        </Panel>
        <PreviewPanel preview={preview} action={previewAction} state={state} />
      </div>

      {confirming && (
        <ConfirmDialog
          title={`Save ${count} tier change${count === 1 ? '' : 's'} on ${versionName} and regrade?`}
          what={`Saves these changes for ${versionName}. A full grading of every version follows within about a minute: letters on character pages, boards, guild pages, badges and share cards change then.${groupChanges.length ? ' Group decisions change which statistics count.' : ''}`}
          playersSee
          affected={affected}
          confirmLabel="Save and regrade"
          danger={false}
          ack="I’ve checked the preview (or there are only group decisions, which the preview can’t show)."
          onConfirm={save}
          onClose={() => setConfirming(false)}
        />
      )}
    </>
  );
}

const metaOf = (d, key) => d?.meta?.find((m) => m.key === key) ?? null;

function StampOf({ d, k }) {
  const m = metaOf(d, k);
  if (!m) return null;
  return <span className="muted xsmall">{m.updatedAt ? `Saved ${formatDateTime(m.updatedAt)}` : 'Default, never changed'}</span>;
}

/** The preview: what each realm category's overall letters would be with the values in the form. Nothing is saved. */
function PreviewPanel({ preview, action, state }) {
  const d = state.data;
  const last = d?.runs?.find((r) => r.status === 'done');
  const now = new Map((last?.summary?.rulesets ?? []).map((r) => [r.rulesetId, r.overall]));
  const word = d?.categoryWord ?? 'ruleset';
  return (
    <section className={`ap${action.busy ? ' is-loading' : ''}`} aria-labelledby="tier-preview-h" id="tier-preview">
      <div className="pbar" aria-hidden="true"><i /></div>
      <div className="hd">
        <h2 id="tier-preview-h">Preview</h2>
        <span className="spacer" />
        <span className="stamp" aria-live="polite">{action.busy ? 'Grading…' : preview ? `Computed ${timeAgo(new Date(action.at).toISOString()) ?? 'just now'}` : ''}</span>
      </div>
      <div className="bd flush">
        {!preview ? (
          <Empty icon="chart" title="No preview yet">Change a share, minimum or weight, then press Preview in the bar above. It grades everyone with your unsaved values and the live decisions, and saves nothing.</Empty>
        ) : preview.rulesets.length === 0 ? (
          <Empty icon="info" title={`No ${word} has tracked characters yet`} />
        ) : preview.rulesets.map((r) => (
          <div key={r.id} className="stack">
            <div className="gd-row tbar"><b>{r.name ?? `${word} ${r.id}`}</b><span className="cnt">{formatNumber(r.population)} tier-eligible</span></div>
            {!r.graded ? <div className="gd-row tbar"><Chip kind="off">Below the minimum: nobody graded</Chip></div> : (
              <div className="dt-wrap">
                <table className="dt">
                  <thead><tr><th scope="col">Letter</th><th scope="col" className="r num">Now</th><th scope="col" className="r num">After save</th><th scope="col" className="r">Change</th></tr></thead>
                  <tbody>
                    {[...TIER_LETTERS, 'unranked'].map((l) => {
                      const before = now.get(r.id)?.[l];
                      const after = r.overall[l];
                      const delta = before === undefined ? null : after - before;
                      return (
                        <tr key={l}>
                          <td className="dtl" data-label="">{l === 'unranked' ? <span className="gd-row"><TierBadge size="sm" />Unranked</span> : <TierBadge letter={l} size="sm" />}</td>
                          <td className="r num" data-label="Now">{before === undefined ? <span className="muted">not graded</span> : formatNumber(before)}</td>
                          <td className="r num" data-label="After save">{formatNumber(after)}</td>
                          <td className="r" data-label="Change">{delta === null ? <span className="delta flat">—</span> : delta === 0 ? <span className="delta flat">—</span> : <span className={`delta ${delta > 0 ? 'up' : 'down'}`}>{delta > 0 ? '▲' : '▼'} {formatNumber(Math.abs(delta))}</span>}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            {r.graded && r.categories.length > 0 && (
              <details className="gd-details">
                <summary>Category letters on {r.name ?? `${word} ${r.id}`}</summary>
                <div className="dt-wrap">
                  <table className="dt">
                    <thead><tr><th scope="col">Category</th>{TIER_LETTERS.map((l) => <th key={l} scope="col" className="r num">{l}</th>)}<th scope="col" className="r num">Unranked</th></tr></thead>
                    <tbody>{r.categories.map((c) => <tr key={c.key}><td className="dtl" data-label="">{c.label}</td>{[...TIER_LETTERS, 'unranked'].map((l) => <td key={l} className="r num" data-label={l === 'unranked' ? 'Unranked' : l}>{formatNumber(c.letters[l])}</td>)}</tr>)}</tbody>
                  </table>
                </div>
              </details>
            )}
          </div>
        ))}
      </div>
      <div className="ft">“Now” is the last full grading{last ? ` (#${last.id}, ${formatDateTime(last.finished_at)})` : ': none yet'}. The preview grades the current characters with your unsaved values.</div>
    </section>
  );
}

/**
 * Tier decisions by GROUP (0.10.0, moved here from the Discovery page). A choice covers every statistic in the group,
 * later ones included; a statistic decided on its own is an exception. Picking a choice only stages it in the save bar.
 */
function GroupsPanel({ groups, edits, onEdit }) {
  const { versionName } = useScope();
  const [open, setOpen] = useState(() => new Set());
  const toggle = (label) => setOpen((s) => {
    const n = new Set(s);
    if (n.has(label)) n.delete(label);
    else n.add(label);
    return n;
  });
  return (
    <Panel panel={groups} title="Group decisions" id="tier-groups" flush
      footer="A choice covers every statistic in the group, including ones Blizzard adds later. Exceptions are statistics decided on their own: they keep their own decision. Boards Everstats makes (collection counts, every number a feed returns) count only when approved one by one on Discovery › Approvals, never through a group. Suggestions are never applied automatically.">
      {(data) => (data.groups.length === 0 ? (
        <Empty icon="info" title={`No statistics on ${versionName} yet`}>Groups appear once this version’s statistics are in Everstats. They start undecided: no tiers until you choose.</Empty>
      ) : (
        <div className="dt-wrap">
          <table className="dt">
            <thead><tr><th scope="col">Group</th><th scope="col">Decision</th><th scope="col" className="lo2">Results now</th><th scope="col" className="lo">Suggestion</th><th scope="col">Per-stat exceptions</th></tr></thead>
            <tbody>
              {data.groups.map((g) => {
                const saved = g.choice?.choice ?? 'cleared';
                const current = edits[g.label] ?? saved;
                const options = [...Object.entries(data.choices).map(([id, label]) => ({ id, label })), { id: 'cleared', label: 'Undecided' }];
                return (
                  <tr key={g.label}>
                    <td className="dtl" data-label="">
                      <b>{g.label}</b>
                      <span className="sub">{formatNumber(g.statistics)} statistic{g.statistics === 1 ? '' : 's'}{g.farmable ? ' · farmable (category letter only, never overall)' : ''}</span>
                      <span className="sub"><span className="dm lo2"><span className="l">Now</span> {formatNumber(g.results.counted)} count · {formatNumber(g.results.undecided)} undecided</span>{g.suggestion && <span className="dm lo"><span className="l">Suggested</span> {g.suggestion.forever.label}</span>}</span>
                      {current !== saved && <Chip kind="warn" icon="edit">Unsaved</Chip>}
                    </td>
                    <td data-label="Decision">
                      <Segmented label={`Decision for ${g.label}`} options={options} value={current} onChange={(c) => onEdit(g.label, c)} scroll={false} />
                      <span className="sub">{g.choice ? `${g.choice.origin === 'migration' ? 'From your 0.9 decisions · ' : ''}since ${formatDateTime(g.choice.decidedAt)}` : 'Undecided: counts as nothing'}</span>
                    </td>
                    <td data-label="Results now" className="t2 lo2">{formatNumber(g.results.counted)} count{g.results.overall ? ` (${formatNumber(g.results.overall)} overall)` : ''} · {formatNumber(g.results.undecided)} undecided</td>
                    <td data-label="Suggestion" className="lo">
                      {g.suggestion ? (
                        <span className="gd-stack">
                          <Chip kind="info">{g.suggestion.forever.label}</Chip>
                          <span className="sub">{formatNumber(g.suggestion.idsMatchingForever)} of {formatNumber(g.statistics)} ids match Forever’s</span>
                        </span>
                      ) : <span className="muted">—</span>}
                    </td>
                    <td data-label="Per-stat exceptions">
                      {g.exceptions.length === 0 ? <span className="muted">None</span> : (
                        <>
                          <button type="button" className="btn sm ghost" aria-expanded={open.has(g.label)} onClick={() => toggle(g.label)}>
                            <Icon name={open.has(g.label) ? 'chevron-up' : 'chevron-down'} size="sm" />{formatNumber(g.exceptions.length)} exception{g.exceptions.length === 1 ? '' : 's'}
                          </button>
                          {open.has(g.label) && (
                            <ul className="gd-list">
                              {g.exceptions.map((e) => <li key={e.id}><ScopedLink to={approvalsLink(e.id)}>{e.name}</ScopedLink> <span className="muted xsmall">· {e.reason}</span></li>)}
                            </ul>
                          )}
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ))}
    </Panel>
  );
}

const RUN_KIND = { pending: 'info', running: 'run', done: 'ok', failed: 'err' };
const RUN_WORD = { pending: 'Queued: waiting for a quiet minute', running: 'Grading', done: 'Done', failed: 'Failed' };
const lettersText = (l) => (l ? TIER_LETTERS.map((x) => `${x} ${formatNumber(l[x])}`).join(' · ') + ` · Unranked ${formatNumber(l.unranked)}` : null);

/** The gradings and "Grade everyone now": requesting → queued → grading → done with the result, in place. */
function GradingsPanel({ state, runs, inFlight, tracking, setTracking }) {
  const { version, versionName } = useScope();
  const regrade = useAction();
  const word = state.data?.categoryWord ?? 'ruleset';
  const tracked = tracking ? runs.data?.runs?.find((r) => r.id === tracking) : null;
  // The tracked grading, in words: queued → grading → done with what it did on this version, or why it failed.
  const trackedText = !tracked ? null
    : tracked.status === 'pending' ? `Grading #${tracked.id} queued: the worker starts it after about 30 s without new changes`
      : tracked.status === 'running' ? `Grading #${tracked.id} running since ${formatDateTime(tracked.started_at)}`
        : tracked.status === 'failed' ? `Grading #${tracked.id} failed: ${tracked.problem ?? 'no reason recorded'}`
          : `Grading #${tracked.id} done in ${formatNumber(tracked.ms)} ms · ${tracked.here?.graded ? `${formatNumber(tracked.here.characters)} characters graded on ${versionName} · ${lettersText(tracked.here.letters)}` : `nothing graded on ${versionName} (every ${word} below its minimum)`}`;
  const go = () => regrade.run(async () => {
    const r = await api('/api/admin/tiers/regrade', { method: 'POST', body: { version } });
    runs.setData({ version: r.version, rulesets: r.rulesets, runs: r.runs });
    setTracking(r.runId ?? r.runs.find((x) => x.status === 'pending' || x.status === 'running')?.id ?? null);
    return r;
  }, { working: 'Requesting a grading…', done: (r) => (r.runId ? `Requested · grading #${r.runId}` : 'Requested · joined the grading already waiting') });
  return (
    <Panel panel={runs} title="Gradings" id="tier-gradings" flush live={inFlight ? 'Live while a grading runs · own 3 s clock' : null}
      actions={<ActionButton action={regrade} className="btn sm" icon="refresh" onRun={go} working="Requesting…">Grade everyone now</ActionButton>}
      footer="One full grading covers every game version; the counts here are this version’s. A grading also runs after a decision or tier setting changes (30 s after the last one), after the daily refresh, when a category crosses its minimum, and every 6 hours.">
      {(data) => (
        <>
          {(regrade.phase !== 'idle' || trackedText) && (
            <div className="tbar" role="status" aria-live="polite">
              <ActionStatus action={regrade} />
              {trackedText && <Chip kind={RUN_KIND[tracked.status]}>{trackedText}</Chip>}
            </div>
          )}
          {data.rulesets.length === 0 ? <Empty icon="info" title={`No ${word} on ${versionName} yet`}>They appear once Everstats has tracked characters on this version.</Empty> : (
            <div className="dt-wrap">
              <table className="dt">
                <thead><tr><th scope="col">{word[0].toUpperCase() + word.slice(1)}</th><th scope="col" className="r num">Tier-eligible now</th><th scope="col">Last grading</th></tr></thead>
                <tbody>
                  {data.rulesets.map((r) => (
                    <tr key={r.id}>
                      <td className="dtl" data-label=""><b>{r.name}</b></td>
                      <td className="r num" data-label="Tier-eligible now">{formatNumber(r.eligible)}</td>
                      <td data-label="Last grading">{r.graded ? <Chip kind="ok">Graded {timeAgo(r.gradedAt)} · {formatNumber(r.gradedPopulation)}</Chip> : r.gradedAt ? <Chip kind="warn">Below the minimum at {timeAgo(r.gradedAt)}</Chip> : <Chip kind="off">Not graded yet</Chip>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {data.runs.length === 0 ? <Empty icon="clock" title="No grading has run yet">The worker runs the first within a minute of starting.</Empty> : (
            <div className="dt-wrap">
              <table className="dt">
                <thead><tr><th scope="col">Grading</th><th scope="col">Status</th><th scope="col">Why</th><th scope="col">Asked</th><th scope="col">On {versionName}</th><th scope="col" className="r">Took</th></tr></thead>
                <tbody>
                  {data.runs.map((r) => (
                    <tr key={r.id} className={r.status === 'failed' ? 'is-fail' : r.id === tracking ? 'is-sel' : undefined}>
                      <td className="dtl mono" data-label="">#{r.id}</td>
                      <td data-label="Status"><Chip kind={RUN_KIND[r.status] ?? 'info'}>{RUN_WORD[r.status] ?? r.status}</Chip>{r.problem && <span className="sub">{r.problem}</span>}</td>
                      <td className="t2" data-label="Why">{(r.reasons ?? []).join(', ')}</td>
                      <td className="t2 nw" data-label="Asked">{formatDateTime(r.requested_at)}</td>
                      <td className="t2" data-label={`On ${versionName}`}>{r.here ? (r.here.graded ? `${formatNumber(r.here.characters)} graded · ${lettersText(r.here.letters)}` : `none graded (${formatNumber(r.here.rulesets)} ${word}${r.here.rulesets === 1 ? '' : 's'} below the minimum)`) : '—'}</td>
                      <td className="r num" data-label="Took">{r.ms !== null && r.ms !== undefined ? `${formatNumber(r.ms)} ms` : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </Panel>
  );
}

function StatList({ title, list, extra }) {
  if (!list.length) return null;
  return (
    <div className="gd-stack">
      <span className="eyebrow">{title} · {list.length}</span>
      <ul className="gd-list">
        {list.map((s) => (
          <li key={s.id}><ScopedLink to={approvalsLink(s.id)}>{s.name}</ScopedLink> <span className="mono muted xsmall">id {s.id}</span>{extra ? <span className="muted xsmall"> · {extra(s)}</span> : null}</li>
        ))}
      </ul>
    </div>
  );
}

/** Read-only: what counts on this version right now, from the Discovery decisions. */
function WhatCounts({ state }) {
  return (
    <Panel panel={state} title="What counts" id="tier-what-counts" flush
      footer="From your Discovery decisions as they are right now. A statistic counts only with an approved category AND an approved “counts toward” (or its group’s choice); anything undecided counts as nothing. Open a statistic to see its decision.">
      {(d) => (
        <>
          {d.issues.length > 0 && (
            <div className="bd">
              <div className="note warn small" role="status">
                <Icon name="warning" />
                <div className="gd-stack">
                  <b>{d.issues.length} decision{d.issues.length === 1 ? '' : 's'} that look inconsistent</b>
                  <ul className="gd-list">
                    {d.issues.map((i) => <li key={`${i.statisticId}-${i.problem}`}><ScopedLink to={approvalsLink(i.statisticId)}>{i.name}</ScopedLink> ({i.category}): {i.problem}</li>)}
                  </ul>
                </div>
              </div>
            </div>
          )}
          <div className="dt-wrap">
            <table className="dt">
              <thead><tr><th scope="col">Category</th><th scope="col">Overall?</th><th scope="col" className="r num">Counted</th><th scope="col" className="r num">Bad</th><th scope="col" className="r num">Name + number</th><th scope="col" className="r num">Duplicate</th><th scope="col" className="r num">Undecided</th></tr></thead>
              <tbody>
                {d.summary.map((c) => (
                  <tr key={c.key}>
                    <td className="dtl" data-label=""><b>{c.label}</b>{c.farmable && <span className="sub">farmable</span>}</td>
                    <td className="t2" data-label="Overall?">{c.inOverall ? 'Yes' : c.farmable ? 'No: farmable' : c.counted ? 'No: nothing counts toward overall' : 'No: nothing counts'}</td>
                    <td className="r num" data-label="Counted">{c.counted}{c.counted !== c.overall && c.inOverall ? <span className="sub">{c.overall} overall</span> : null}</td>
                    <td className="r num" data-label="Bad">{c.bad}</td>
                    <td className="r num" data-label="Name + number">{c.named}</td>
                    <td className="r num" data-label="Duplicate">{c.duplicate}</td>
                    <td className="r num" data-label="Undecided">{c.undecided}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {d.categories.map((c) => (
            <details key={c.key} className="gd-details">
              <summary><b>{c.label}</b> <span className="muted xsmall">{c.counted.length} counted · {c.bad.length + c.named.length} leaderboard only · {c.duplicate.length} duplicate · {c.undecided.length} undecided</span></summary>
              <div className="gd-stack">
                <StatList title="Counts" list={c.counted} extra={(s) => (s.overall ? 'category + overall' : 'category only')} />
                <StatList title="Bad: leaderboard only" list={c.bad} />
                <StatList title="Name + number: leaderboard only" list={c.named} />
                <StatList title="Duplicate: graded through the other" list={c.duplicate} extra={(s) => `of ${s.ofName ?? `id ${s.of}`}`} />
                <StatList title="Undecided: doesn’t count" list={c.undecided} extra={(s) => s.reason} />
              </div>
            </details>
          ))}
          {d.categories.length === 0 && <Empty icon="info" title="Nothing decided on this version yet" />}
        </>
      )}
    </Panel>
  );
}

