import { useCallback, useEffect, useState } from 'react';
import { Link } from '../scope.jsx';
import { api } from '../api.js';
import { Icon } from '../chrome/Icon.jsx';
import { Sortable } from '../components/Sortable.jsx';
import { fillStyle } from '../components/fillGrid.js';
import { TierDistribution } from '../components/Tier.jsx';
import { useToasts } from '../components/Toasts.jsx';
import { GuildPill } from '../guildBadges/GuildBadges.jsx';
import { formatNumber } from '../format.js';
import { useSession } from '../session.jsx';

/**
 * "Your guilds" on the signed-in home page (0.9.1, server/guilds/follow.js). Every guild one of the player's characters
 * is in appears by itself; guilds they follow with "Pin to dashboard" join it. One order for all of them, set with the
 * shared drag-and-drop list (components/Sortable.jsx). A followed guild is unpinned from its card; one of their own
 * characters' guilds can only be hidden (and shown again from the line under the section).
 */
export function YourGuilds() {
  const toast = useToasts();
  const [data, setData] = useState(null);
  const load = useCallback(() => api('/api/account/followed-guilds').then(setData, () => setData(false)), []);
  useEffect(() => {
    load();
  }, [load]);
  if (!data || (!data.guilds.length && !data.hidden.length)) return null;
  const act = async (fn, ok) => {
    try {
      await fn();
      toast.ok(ok);
      load();
    } catch (err) {
      toast.err('Couldn’t change that', err.message);
    }
  };
  const unpin = (g) => act(() => api(`/api/account/followed-guilds/${g.id}/pin`, { method: 'PUT', body: { pinned: false } }), `${g.name} unpinned`);
  const hide = (g, hidden) => act(() => api(`/api/account/followed-guilds/${g.id}/hidden`, { method: 'PUT', body: { hidden } }), hidden ? `${g.name} hidden from your dashboard` : `${g.name} shown again`);
  const reorder = (ids) => api('/api/account/followed-guilds-order', { method: 'PUT', body: { guildIds: ids } });
  return (
    <section className="stack gap-14" aria-labelledby="yg-h">
      <div className="row gap-12 wrap-row">
        <h2 className="h2" id="yg-h">Your guilds</h2>
        <span className="muted small">Your characters’ guilds, and any you pin from a guild page ({formatNumber(data.pinnedCount)} of {formatNumber(data.maxPinned)} pinned)</span>
      </div>
      {data.guilds.length > 0 && (
        // 0.9.2: the dashboard's full width. One guild: a full-width card laid out across. Several: rows of 3 (2 on
        // tablets, 1 on phones) that always fill, the last row's cards sharing its width (components/fillGrid.js).
        <Sortable items={data.guilds} labelOf={(g) => g.name} className="yg-list fillgrid" itemClassName="yg-item" ariaLabel="Your guilds, in order" onReorder={reorder}
          slotStyle={(i, n) => fillStyle(n, { lg: 3, md: 2, sm: 1 })}
          renderItem={(g, { grip }) => (
            <>
              <span className="pin-grip">{grip}</span>
              <GuildCard g={g} onUnpin={() => unpin(g)} onHide={() => hide(g, true)} />
            </>
          )} />
      )}
      {data.hidden.length > 0 && (
        <p className="muted small">
          Hidden: {data.hidden.map((g, i) => (
            <span key={g.id}>{i ? ', ' : ''}{g.name} <button type="button" className="linklike" onClick={() => hide(g, false)}>Show</button></span>
          ))}
        </p>
      )}
    </section>
  );
}

/**
 * One guild card. 0.9.2: grouped into columns (identity and badge | placement and next unlocks | members by tier |
 * actions): stacked in a narrow grid cell, laid out across when the card itself is wide (one guild, or the last row's
 * lone card): a container query in app.css, so it follows the card's width, not the window's.
 */
function GuildCard({ g, onUnpin, onHide }) {
  const tag = [g.faction, g.ruleset?.name].filter(Boolean).join(' · ');
  return (
    <article className="panel yg-card stack gap-12" aria-label={`${g.name}`}>
      <div className="yg-col-id">
        <div className="yg-head">
          <Link className="h3 yg-name" scope={g.version} to={`/g/${encodeURIComponent(g.slug)}`} draggable={false}>&lt;{g.name}&gt;</Link>
          {g.badge && <span className="yg-badge" data-no-drag><GuildPill badge={g.badge} small ribbon={false} /></span>}
        </div>
        <span className="t2 small">{tag}{tag ? ' · ' : ''}{formatNumber(g.tracked)} tracked member{g.tracked === 1 ? '' : 's'}{g.roster ? ` of ${formatNumber(g.roster)}` : ''}</span>
      </div>
      <div className="yg-col-goal">
        <span className="small">
          {g.best ? <>Best placement: <b className="strong-text">#{formatNumber(g.best.rank)}</b> of {formatNumber(g.best.of)} · {g.best.name}{g.best.mode === 'average' ? ' (average)' : ''}</> : <span className="muted">Not placed on a guild board yet</span>}
        </span>
        {g.nextUnlocks.length > 0 && (
          <div className="stack gap-6">
            {g.nextUnlocks.map((n) => (
              <div key={n.id} className="cbar">
                <div className="hd"><span className="lbl">{n.name} {n.progress?.numeral ?? ''}</span><span className="num"><b>{formatNumber(n.progress?.value)}</b> / {formatNumber(n.progress?.threshold)}</span></div>
                <div className="bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round((n.progress?.pct ?? 0) * 100)} aria-label={`${n.name}: ${Math.round((n.progress?.pct ?? 0) * 100)}% to the next level`}><span style={{ width: `${Math.round((n.progress?.pct ?? 0) * 100)}%` }} /></div>
              </div>
            ))}
          </div>
        )}
      </div>
      {g.tiers && g.tiers.ranked > 0 && <div className="yg-col-tiers yg-tiers"><TierDistribution letters={g.tiers.letters} label="Members by tier" /></div>}
      <div className="row gap-12 wrap-row small yg-actions">
        {g.own ? <span className="tag">Your character’s guild</span> : <span className="tag gold">Pinned</span>}
        <span className="spacer" />
        {g.manage && <Link scope={g.version} to={`/g/${encodeURIComponent(g.slug)}/manage/badges`} draggable={false}>Manage</Link>}
        {g.own ? <button type="button" className="linklike" onClick={onHide}>Hide</button> : <button type="button" className="linklike" onClick={onUnpin}><Icon name="close" size="sm" />Unpin</button>}
      </div>
    </article>
  );
}

/** The guild page's "Pin to dashboard" (signed in only). Own characters' guilds are on the dashboard already. */
export function PinGuildButton({ guildId }) {
  const session = useSession();
  const toast = useToasts();
  const [state, setState] = useState(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => api(`/api/account/followed-guilds/${guildId}`).then(setState, () => setState(null)), [guildId]);
  useEffect(() => {
    if (session.signedIn && guildId) load();
  }, [session.signedIn, guildId, load]);
  if (!session.signedIn || !state) return null;
  if (state.own) return <span className="tag" title="Your character is in this guild, so it’s on your dashboard already">On your dashboard</span>;
  const flip = async () => {
    setBusy(true);
    try {
      await api(`/api/account/followed-guilds/${guildId}/pin`, { method: 'PUT', body: { pinned: !state.pinned } });
      toast.ok(state.pinned ? 'Unpinned from your dashboard' : 'Pinned to your dashboard');
      load();
    } catch (err) {
      toast.err('Couldn’t change that', err.message);
    } finally {
      setBusy(false);
    }
  };
  const full = !state.pinned && state.pinnedCount >= state.maxPinned;
  return (
    <button type="button" className={`btn sm${state.pinned ? ' ghost' : ''}`} onClick={flip} disabled={busy || full} aria-pressed={state.pinned}
      title={full ? `You’ve pinned ${state.maxPinned} guilds: unpin one from your dashboard first` : undefined}>
      <Icon name="pin" size="sm" />{state.pinned ? 'Pinned to dashboard' : 'Pin to dashboard'}
    </button>
  );
}
