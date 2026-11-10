import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from '../scope.jsx';
import { parseGuildAddress } from '../../../server/stats/slug.js';
import { api } from '../api.js';
import { Icon } from '../chrome/Icon.jsx';
import { Toggle } from '../components/Controls.jsx';
import { Sortable } from '../components/Sortable.jsx';
import { EmptyState } from '../components/EmptyState.jsx';
import { ServiceUnavailable } from '../components/States.jsx';
import { useToasts } from '../components/Toasts.jsx';
import { formatDate, formatNumber } from '../format.js';
import { useSession } from '../session.jsx';
import { GuildBadgeIcon, GuildBadgeToasts, GuildPill, guildBadgeName } from './GuildBadges.jsx';

/**
 * Manage guild → Badges (design/v2-guild-badges/pages/manage-badges, components/manage-picker.md), for the Guild Master
 * and the officers they add. NOBODY can award a badge here: they choose which unlocked badges show on the guild page,
 * their order, and the one pinned badge. Each change saves at once.
 *
 *   Shown on the guild page   drag a row to reorder (components/Sortable.jsx, 0.8.1: live, Saved + Undo; keyboard on
 *                             its grip), Show toggle, Pin radio (exactly one).
 *   Unlocked, hidden          unlocked but not shown; LOST standing badges sit here, "Lost [date]", and can't be shown
 *                             or pinned until regained.
 *   Not yet                   standing badges not held now, with the reason; heritage this guild can't get any more.
 *
 * The side nav's "Guild profile & links" and "Officers" are the 0.7.0 Manage guild panel on the guild page.
 */
function statusOf(b) {
  if (b.state === 'lost') return `Lost ${formatDate(b.lostAt)} · can’t be shown until it’s regained`;
  if (b.expired) return `Shown until ${b.event?.until} has passed · still held`;
  if (b.levelled) {
    if (b.progress) return `Next: ${b.name} ${b.progress.numeral} · ${formatNumber(b.progress.value)} / ${formatNumber(b.progress.threshold)} ${b.measure}`;
    if (b.level === 5) return 'Top level reached';
    return 'Progress appears once the guild’s totals are added up';
  }
  if (b.keptWhileHeld) return `Held since ${formatDate(b.heldSince)}${b.boards?.length ? ` · ${b.boards.length} board${b.boards.length === 1 ? '' : 's'}` : ''}`;
  if (b.id === 'founding-guild') return 'Permanent · open beta';
  if (b.id === 'early-guild') return 'Permanent · early window';
  if (b.id === 'every-calling-g') return 'All classes covered';
  if (b.award === 'manual') return ['Granted by staff', b.event?.label, b.event?.until ? `until ${b.event.until}` : null].filter(Boolean).join(' · ');
  return `Unlocked ${formatDate(b.firstAt)}`;
}

export function ManageBadgesPage() {
  const { slug: raw } = useParams();
  const slug = parseGuildAddress(raw);
  const session = useSession();
  const toast = useToasts();
  const [data, setData] = useState(null);
  const [problem, setProblem] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await api(`/api/guilds/${encodeURIComponent(slug)}/badges/manage`));
    } catch (err) {
      setProblem(err.message);
    }
  }, [slug]);
  useEffect(() => {
    if (session.signedIn && slug) load();
  }, [session.signedIn, slug, load]);

  const save = async (next) => {
    setBusy(true);
    try {
      setData(await api(`/api/guilds/${encodeURIComponent(slug)}/badges/manage`, { method: 'PUT', body: next }));
      return true;
    } catch (err) {
      toast.err('Couldn’t save that', err.message);
      return false;
    } finally {
      setBusy(false);
    }
  };

  if (session.loading) return <div className="wrap page-pad"><h1 className="h1">Manage badges</h1></div>;
  if (!session.signedIn) {
    return (
      <div className="wrap page-pad stack gap-24 narrow-wrap">
        <h1 className="h1">Manage badges</h1>
        <EmptyState kind="nodata" title="Sign in as this guild’s Guild Master or an officer"><span>Only they can choose which badges the guild page shows. <Link to="/sign-in">Sign in</Link></span></EmptyState>
      </div>
    );
  }
  if (problem) return <div className="wrap page-pad"><ServiceUnavailable title="Couldn’t load the guild’s badges" onRetry={load}>{problem}</ServiceUnavailable></div>;
  if (!data) return <div className="wrap page-pad"><h1 className="h1">Manage badges</h1><span className="t2 small" role="status">Loading…</span></div>;
  if (!data.role) {
    return (
      <div className="wrap page-pad stack gap-24 narrow-wrap">
        <h1 className="h1">Manage badges</h1>
        <EmptyState kind="nodata" title="Only the Guild Master and their officers can do this">
          <span>The Guild Master is whoever owns the guild’s rank-0 character on Everstats; they can add officers. <Link to={`/g/${encodeURIComponent(slug)}`}>Back to the guild</Link></span>
        </EmptyState>
      </div>
    );
  }

  const shownIds = data.shown.map((b) => b.id);
  const pinned = data.shown.find((b) => b.pinned)?.id ?? null;
  const body = (over = {}) => ({ order: over.order ?? shownIds, shown: over.shown ?? shownIds, pinned: over.pinned === undefined ? pinned : over.pinned });
  const setShown = (b, on) => {
    if (on) return save(body({ order: [...shownIds, b.id], shown: [...shownIds, b.id] }));
    const rest = shownIds.filter((id) => id !== b.id);
    return save(body({ order: rest, shown: rest, pinned: pinned === b.id ? rest[0] ?? null : pinned }));
  };

  return (
    <div className="wrap page-pad split manage-badges">
      <GuildBadgeToasts slug={slug} enabled />
      <aside className="side stack gap-14">
        <div className="stack gap-4">
          <span className="eyebrow">Manage guild</span>
          <h1 className="h2"><Link to={`/g/${encodeURIComponent(slug)}`}>{data.guild.name}</Link></h1>
        </div>
        <nav className="stack gap-4" aria-label="Manage guild">
          <Link className="btn ghost block left" to={`/g/${encodeURIComponent(slug)}#manage`}>Guild profile &amp; links</Link>
          <Link className="btn ghost block left" to={`/g/${encodeURIComponent(slug)}#manage`}>Officers</Link>
          <span className="btn block left is-current" aria-current="page">Badges</span>
        </nav>
        <span className="muted xsmall">{data.role === 'gm' ? 'You’re the Guild Master.' : 'The Guild Master added you as an officer.'} Officers can manage badges too. Nobody can award badges here: they’re automatic or granted by Everstats staff.</span>
      </aside>
      <div className="main stack gap-24" aria-busy={busy || undefined}>
        <section className="panel clip" aria-labelledby="shown-h">
          <div className="pad-20 stack gap-6">
            <h2 className="h2 h2-panel" id="shown-h">Shown on the guild page</h2>
            <span className="t2 small">Up to {data.max} in the row, in this order; the rest under “+N more”. Pin one: it leads the row and appears next to your guild’s name on boards and the guild list.</span>
          </div>
          {data.shown.length === 0 ? <div className="pad-20"><span className="muted small">Nothing shown. Turn a badge on below.</span></div> : (
            <SortableRows items={data.shown} pinned={pinned} disabled={busy}
              onOrder={async (order) => { if (!(await save(body({ order })))) throw new Error('not saved'); }} onShown={setShown} onPin={(id) => save(body({ pinned: id }))} />
          )}
        </section>

        <section className="panel clip" aria-labelledby="hidden-h">
          <div className="pad-20"><h2 className="h2 h2-panel" id="hidden-h">Unlocked, hidden</h2></div>
          {data.hidden.length === 0 ? <div className="pad-20"><span className="muted small">Every unlocked badge is shown.</span></div> : (
            <div className="mrows">
              {data.hidden.map((b) => (
                <div key={b.id} className="mrow">
                  <span className="drag" aria-hidden="true" />
                  <span><GuildPill badge={b} small ribbon={false} /></span>
                  <span className="st">{statusOf(b)}{b.progress && <span className="gprog sm"><span style={{ width: `${(b.progress.pct * 100).toFixed(1)}%` }} /></span>}</span>
                  <Toggle checked={false} disabled={busy || b.state === 'lost' || b.expired} onChange={() => setShown(b, true)}><span className="sr-only">Show {guildBadgeName(b)}</span></Toggle>
                  <span className="pinradio is-disabled" aria-hidden="true"><input type="radio" disabled tabIndex={-1} />Pin</span>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="panel clip" aria-labelledby="notyet-h">
          <div className="pad-20 row gap-10 wrap-row"><h2 className="h2 h2-panel" id="notyet-h">Not yet</h2><span className="t2 small">Standing badges you don’t hold right now, and closed windows.</span></div>
          {data.notYet.length === 0 ? <div className="pad-20"><span className="muted small">Nothing here.</span></div> : (
            <div className="mrows">
              {data.notYet.map((b) => (
                <div key={b.id} className="mrow notyet">
                  <span className="drag" aria-hidden="true" />
                  <span><span className="gpill sm is-locked" role="img" aria-label={`${b.name}: guild badge, not held`}><GuildBadgeIcon badge={b} size="pill-ico" state="locked" labelled={false} />{b.name}</span></span>
                  <span className="st">{b.reason}</span>
                </div>
              ))}
            </div>
          )}
          <div className="pad-20"><Link className="small" to="/guild-badges">Every guild badge and how it’s unlocked →</Link></div>
        </section>
      </div>
    </div>
  );
}

/** The shown rows: the shared drag-and-drop list (components/Sortable.jsx, 0.8.1). The whole row is the handle;
 *  its Show toggle and Pin radio keep working. Saved on drop, with Undo. */
function SortableRows({ items, pinned, disabled, onOrder, onShown, onPin }) {
  return (
    <Sortable items={items} labelOf={guildBadgeName} className="mrows" itemClassName="mrow-item" ariaLabel="Shown badges, in order"
      disabled={disabled} onReorder={onOrder}
      renderItem={(b, { grip }) => (
        <div className="mrow">
          {grip}
          <span><GuildPill badge={b} small pinned={b.id === pinned} ribbon={false} /></span>
          <span className="st">{statusOf(b)}{b.progress && <span className="gprog sm"><span style={{ width: (b.progress.pct * 100).toFixed(1) + '%' }} /></span>}</span>
          <Toggle checked disabled={disabled} onChange={() => onShown(b, false)}><span className="sr-only">Show {guildBadgeName(b)}</span></Toggle>
          <label className="pinradio">
            <input type="radio" name="guild-pin" checked={b.id === pinned} disabled={disabled} onChange={() => onPin(b.id)} />Pin
          </label>
        </div>
      )} />
  );
}
