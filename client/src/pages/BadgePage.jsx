import { usePageTitle } from '../pageTitle.js';
import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api.js';
import { BadgeIcon, BadgePill } from '../badges/Badges.jsx';
import { Icon } from '../chrome/Icon.jsx';
import { Toggle } from '../components/Controls.jsx';
import { EmptyState } from '../components/EmptyState.jsx';
import { ServiceUnavailable } from '../components/States.jsx';
import { useToasts } from '../components/Toasts.jsx';
import { formatDate, formatNumber } from '../format.js';
import { useSession } from '../session.jsx';

/**
 * A badge: /badges/{id} (design/v2-badges/pages/badge-detail). The XL badge and its frame, its tags, name, what it
 * means, the viewer's status (earned on a date, from which character; not earned yet and how; or no longer available
 * and why), "Show on my profile" / "Feature" when earned, how it's earned, the window (time-limited), how many players
 * hold it (a real count), the three sizes, and "Other {family} badges".
 *
 * Who holds it: an automatic badge lists the players who chose to show it on their profile; a granted (staff,
 * partner) badge shows only the count. Opening the page clears the badge's "new" mark.
 */
export function BadgePage() {
  const { id } = useParams();
  const session = useSession();
  const toast = useToasts();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  usePageTitle(data?.badge?.name ? `${data.badge.name} badge` : null); // 0.9.2
  const load = useCallback(async () => {
    try {
      const d = await api(`/api/badges/${encodeURIComponent(id)}`);
      setData(d);
      if (d.mine?.isNew) api('/api/account/badges/seen', { method: 'POST', body: { ids: [d.badge.id] } }).catch(() => {});
    } catch (err) {
      setError(err);
    }
  }, [id]);
  useEffect(() => {
    setData(null);
    setError(null);
    load();
  }, [load]);

  if (error?.status === 404) {
    return (
      <div className="wrap page-pad stack gap-24 narrow-wrap">
        <h1 className="h1">No such badge</h1>
        <EmptyState kind="nocoverage" title="Everstats has no badge at this address"><span>It may have been mistyped.</span></EmptyState>
      </div>
    );
  }
  if (error) return <div className="wrap page-pad"><ServiceUnavailable title="Couldn’t load this badge" onRetry={load}>{error.message}</ServiceUnavailable></div>;
  if (!data) return <div className="wrap page-pad"><h1 className="h1">Badge</h1><span className="t2 small" role="status">Loading…</span></div>;

  const b = data.badge;
  const mine = data.mine;
  const st = data.status;
  // Display choices go through Settings' own endpoint, so the same rules apply (max 6 featured, public first).
  const change = async (patch) => {
    try {
      const s = await api('/api/account/badges');
      const shown = new Set(s.earned.filter((x) => x.shown).map((x) => x.id));
      const featured = s.earned.filter((x) => x.featured).sort((x, y) => x.position - y.position).map((x) => x.id);
      let pinned = s.earned.find((x) => x.pinned)?.id ?? null;
      if (patch.shown === false) {
        shown.delete(b.id);
        if (pinned === b.id) pinned = null;
      }
      if (patch.shown === true) shown.add(b.id);
      let feat = featured.filter((x) => x !== b.id && shown.has(x));
      if (patch.featured === true || (patch.featured === undefined && featured.includes(b.id) && shown.has(b.id))) feat = [...feat, b.id];
      if (patch.featured === true) shown.add(b.id);
      await api('/api/account/badges', { method: 'PUT', body: { shown: [...shown], featured: feat, pinned } });
      await load();
      session.refresh();
    } catch (err) {
      toast.err('Couldn’t change that', err.message);
    }
  };

  return (
    <div className="wrap page-pad stack gap-28">
      <nav className="crumbs small" aria-label="Breadcrumb">
        {session.signedIn && session.user?.claimed && <><Link to={`/u/${session.user.username}`}>Profile</Link><span aria-hidden="true"> / </span></>}
        {session.signedIn ? <Link to="/settings#badges">Badges</Link> : <span>Badges</span>}
        <span aria-hidden="true"> / </span><span>{b.name}</span>
      </nav>
      <section className="sheet sheet-pad" aria-labelledby="badge-h">
        <div className="badge-hero">
          <div className="badge-hero-art">
            <BadgeIcon badge={b} size="xl" locked={st?.state === 'locked'} retired={st?.state === 'unavailable'} />
            <span className="eyebrow">{b.frame}</span>
          </div>
          <div className="stack gap-14">
            <div className="row gap-6 wrap-row">
              <span className="tag">{b.familyLabel}</span>
              {b.verified && <span className="verified"><Icon name="check" size="sm" />Verified</span>}
              {b.timeLimited && <span className="tag gold">Time-limited</span>}
              <span className="tag">{b.award === 'automatic' ? 'Automatic' : 'Granted'}</span>
              {b.keptWhileHeld && <span className="tag">Kept only while held</span>}
            </div>
            <h1 className="h-display" id="badge-h">{b.name}</h1>
            <p className="t2">{b.description}</p>
            <Status data={data} />
            {mine && (
              <div className="stack gap-10">
                <Toggle checked={mine.shown} onChange={(v) => change({ shown: v })}>Show on my profile</Toggle>
                <Toggle checked={mine.featured} disabled={!mine.shown} onChange={(v) => change({ featured: v })}>Feature in my profile’s badge row</Toggle>
              </div>
            )}
            <div className="panel pad-16">
              <div className="kv"><span className="t2">How it’s earned</span><span className="right-text">{b.how}</span></div>
              {b.window && <div className="kv"><span className="t2">Window</span><span>{b.window.start} – {b.window.end} (UTC){b.window.closed ? ' · closed' : ''}</span></div>}
              <div className="kv"><span className="t2">Held by</span><span>{formatNumber(data.heldBy)} player{data.heldBy === 1 ? '' : 's'}</span></div>
              <div className="kv">
                <span className="t2">Sizes</span>
                <span className="badge-sizes">
                  <BadgeIcon badge={b} size="lg" labelled={false} />
                  <BadgeIcon badge={b} size="std" labelled={false} />
                  <BadgeIcon badge={b} size="inline" labelled={false} />
                </span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {data.holders && (
        <section className="stack gap-12" aria-labelledby="holders-h">
          <h2 className="h2" id="holders-h">Players showing it</h2>
          {data.holders.list.length === 0 ? (
            <span className="muted small">{data.heldBy > 0 ? 'Nobody who holds it shows it on a public profile yet.' : 'Nobody holds it yet.'}</span>
          ) : (
            <>
              <ul className="plain row gap-10 wrap-row">
                {data.holders.list.map((h) => <li key={h.username}><Link className="mono" to={`/u/${h.username}`}>@{h.username}</Link></li>)}
              </ul>
              {data.holders.more && <span className="muted xsmall">And more: only the first {data.holders.list.length} are listed.</span>}
            </>
          )}
          <span className="muted xsmall">Only players who chose to show this badge on their profile are listed. The count above includes everyone.</span>
        </section>
      )}
      {!data.holders && b.award === 'manual' && (
        <span className="muted small">Granted badges show only how many players hold them.</span>
      )}

      {data.siblings.length > 0 && (
        <section className="stack gap-12" aria-labelledby="sibs-h">
          <h2 className="h2" id="sibs-h">Other {b.familyLabel.toLowerCase()} badges</h2>
          <div className="badge-sibs">
            {data.siblings.map((s) => (
              <BadgePill key={s.id} badge={s} locked={s.state === 'locked'} retired={s.state === 'unavailable'} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function Status({ data }) {
  const mine = data.mine;
  const st = data.status;
  if (mine) {
    const why = data.badge.keptWhileHeld ? 'Kept only while you hold it.' : data.badge.award === 'automatic' ? 'Automatic badges stay once earned.' : 'Granted by Everstats staff.';
    return (
      <div className="note ok small" role="status">
        <Icon name="check" />
        <span><b>You earned this on {formatDate(mine.earnedAt)}</b>{mine.character ? <> · from <Link to={`/c/${encodeURIComponent(mine.character.slug)}`}>{mine.character.name} {mine.character.surname}</Link></> : null}. {why}</span>
      </div>
    );
  }
  if (!data.signedIn) return <div className="note small"><Icon name="info" /><span><Link to="/sign-in">Sign in</Link> to see whether you have it. {data.badge.award === 'automatic' ? data.badge.how : 'It’s granted by Everstats staff.'}</span></div>;
  if (st?.state === 'unavailable') return <div className="note warn small"><Icon name="clock" /><span><b>No longer available.</b> {st.note}</span></div>;
  // 0.7.1: never available to this account, while others can still earn it (Beta Tester for an account made earlier).
  if (st?.state === 'ineligible') return <div className="note small"><Icon name="lock" /><span><b>Not for this account.</b> {st.note}</span></div>;
  if (data.badge.award === 'manual') return <div className="note small"><Icon name="info" /><span>Not earned: it’s granted by Everstats staff, never earned.</span></div>;
  return <div className="note small"><Icon name="lock" /><span><b>Not earned yet.</b> {data.badge.how}{st?.note ? ` ${st.note}` : ''} Checked whenever your characters refresh.</span></div>;
}
