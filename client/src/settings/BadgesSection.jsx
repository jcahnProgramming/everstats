import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { BadgeIcon, BadgePill, InlineBadge } from '../badges/Badges.jsx';
import { Icon } from '../chrome/Icon.jsx';
import { Toggle } from '../components/Controls.jsx';
import { Sortable } from '../components/Sortable.jsx';
import { useToasts } from '../components/Toasts.jsx';
import { formatDate } from '../format.js';
import { useSession } from '../session.jsx';

/**
 * Settings → Badges (design/v2-badges/pages/settings-badges + components/badge-picker.md), 0.7.0.
 *
 *   Featured     up to 6, in the order the profile row shows them: the shared drag-and-drop list (components/Sortable.jsx,
 *                0.8.1): grab a badge, drop it, "Saved" with Undo; keyboard on its grip. Staff and partner badges always
 *                lead (a lock, never a grip); the pin marks the badge shown next to the player's name.
 *   Earned       every badge held, each as a pill with: "Show on my profile" (public, or private everywhere),
 *                "Feature" (in the row; at most 6: "You can feature up to 6. Turn one off first."), and "Pin" (the ONE
 *                inline badge: header, "Claimed by", guild rosters). Nothing pinned → the first featured is used.
 *   You can earn automatic badges this account can still get, each saying plainly how. Staff and partner badges are
 *                granted, so they're never listed as earnable.
 *   No longer available  time-limited badges this account can't get any more, with why.
 */
const FIRST = ['staff', 'partner'];
const first = (b) => FIRST.includes(b.family);
const ordered = (ids, byId) => [...ids.filter((id) => first(byId.get(id))), ...ids.filter((id) => !first(byId.get(id)))];

export function BadgesSection() {
  const session = useSession();
  const toast = useToasts();
  const [data, setData] = useState(null);
  const [problem, setProblem] = useState(null);
  const [note, setNote] = useState(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try {
      setData(await api('/api/account/badges'));
    } catch (err) {
      setProblem(err.message);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const byId = new Map((data?.earned ?? []).map((b) => [b.id, b]));
  const featured = (data?.earned ?? []).filter((b) => b.featured).sort((a, b) => a.position - b.position).map((b) => b.id);
  const shown = (data?.earned ?? []).filter((b) => b.shown).map((b) => b.id);
  const pinned = (data?.earned ?? []).find((b) => b.pinned)?.id ?? null;

  const save = useCallback(async (next) => {
    setBusy(true);
    try {
      const d = await api('/api/account/badges', { method: 'PUT', body: next });
      setData(d);
      setNote(null);
      session.refresh();
      return true;
    } catch (err) {
      if (err.code === 'too_many') setNote(err.message);
      else toast.err('Couldn’t save your badges', err.message);
      return false;
    } finally {
      setBusy(false);
    }
  }, [session, toast]);

  const markSeen = useCallback((id) => {
    api('/api/account/badges/seen', { method: 'POST', body: { ids: [id] } }).catch(() => {});
  }, []);

  if (problem) return <section id="badges" className="panel pad-24"><div className="note err small" role="alert"><Icon name="error" /><span>{problem}</span></div></section>;
  if (!data) return <section id="badges" className="panel pad-24 stack gap-12" aria-busy="true"><h2 className="h2">Badges</h2><span className="t2 small" role="status">Loading…</span></section>;

  const setShown = (id, on) => {
    const s = new Set(shown);
    if (on) s.add(id);
    else s.delete(id);
    save({ shown: [...s], featured: featured.filter((x) => s.has(x)), pinned: pinned && s.has(pinned) ? pinned : null });
  };
  const setFeatured = (id, on) => {
    if (on && featured.length >= data.max) {
      setNote(`You can feature up to ${data.max}. Turn one off first.`);
      return;
    }
    save({ shown, featured: on ? ordered([...featured, id], byId) : featured.filter((x) => x !== id), pinned });
  };
  const setPinned = (id) => save({ shown, featured, pinned: pinned === id ? null : id });
  const reorder = async (ids) => {
    const ok = await save({ shown, featured: ordered(ids, byId), pinned });
    if (!ok) throw new Error('not saved');
  };

  const top = pinned ? byId.get(pinned) : featured.length ? byId.get(featured[0]) : null;
  const empty = data.earned.length === 0;

  return (
    <section id="badges" className="panel pad-24 stack gap-24" aria-labelledby="badges-h">
      <div className="stack gap-6">
        <h2 className="h2" id="badges-h">Badges</h2>
        <span className="t2 small">Badges are emblems your account earns (or is granted). Choose which show on your profile, which lead its badge row, and the one that sits next to your name.</span>
      </div>

      <div className="stack gap-12">
        <div className="row gap-10 wrap-row">
          <h3 className="h3">Featured on your profile</h3>
          <span className="muted small">Up to {data.max}, in this order. Staff and partner badges always come first.</span>
        </div>
        {featured.length > 0 && (
          <Sortable items={featured.map((id) => byId.get(id))} labelOf={(b) => b.name} lockedOf={first} lockedNote="Staff badges always lead"
            className="feat-list" itemClassName="feat-item" ariaLabel="Featured badges, in order" disabled={busy} onReorder={reorder}
            renderItem={(b, { grip, index, locked }) => (
              <span className={locked ? 'feat-pill is-locked-first' : 'feat-pill'}>
                {grip}
                <span className="n" aria-hidden="true">{index + 1}</span>
                <BadgeIcon badge={b} labelled={false} />
                <span className="feat-name">{b.name}</span>
                {pinned === b.id && <span className="feat-pin" title="Shown next to your name"><Icon name="pin" size="sm" /><span className="sr-only">, pinned next to your name</span></span>}
              </span>
            )} />
        )}
        {featured.length < data.max && !empty && <span className="muted xsmall">{data.max - featured.length} of {data.max} places free: turn on “Feature” for a badge below.</span>}
        {empty && <span className="t2 small">No badges yet. <a href="#earnable">See the badges you can earn</a>: they arrive by themselves when your characters refresh.</span>}
        {data.username && (
          <div className="where-shows">
            <span className="eyebrow">Next to your name</span>
            <span className="small">Header <span className="name-badge"><span className="handle mono">@{data.username}</span><InlineBadge badge={top} /></span></span>
            <span className="small">Character pages and guild rosters: Claimed by <span className="name-badge"><span className="handle mono">@{data.username}</span><InlineBadge badge={top} /></span></span>
            {!top && <span className="muted xsmall">Nothing yet: pin a badge, or feature one.</span>}
          </div>
        )}
        {!data.username && <span className="muted xsmall">Badges show next to your name once you <a href="#profile">choose a username</a>.</span>}
      </div>

      {!empty && (
        <div className="stack gap-12">
          <div className="row gap-10 wrap-row">
            <h3 className="h3">Earned</h3>
            <span className="muted small">{data.earned.length} badge{data.earned.length === 1 ? '' : 's'} · {shown.length} on your profile · {featured.length} of {data.max} featured</span>
          </div>
          {note && <div className="note warn small" role="alert"><Icon name="warning" /><span className="flex-fill">{note}</span></div>}
          <div className="bcards">
            {data.earned.map((b) => (
              <div key={b.id} className={`bcard${b.featured ? ' is-featured' : ''}`}>
                <div className="bcard-main">
                  <BadgePill badge={b} isNew={b.isNew} earnedAt={b.earnedAt} heldBy={b.heldBy} onSeen={markSeen} />
                  <span className="row gap-6 wrap-row">
                    <span className="fam">{b.familyLabel}{b.verified ? ' · Verified' : ''}</span>
                    {b.isNew && <span className="newtag">New</span>}
                    {first(b) && <span className="fam">· Always first</span>}
                  </span>
                  <span className="sub">Earned {formatDate(b.earnedAt)}{b.character ? ` · from ${b.character.name} ${b.character.surname}` : ''}{b.source === 'admin' ? ' · granted by Everstats staff' : ''}</span>
                </div>
                <div className="bcard-ctl">
                  <Toggle checked={b.shown} disabled={busy} onChange={(v) => setShown(b.id, v)}>Public</Toggle>
                  <Toggle checked={b.featured} disabled={busy || !b.shown} onChange={(v) => setFeatured(b.id, v)}>Feature</Toggle>
                  <button type="button" className="btn ghost sm pin-toggle" aria-pressed={b.pinned} disabled={busy || !b.shown}
                    aria-label={b.pinned ? `Unpin ${b.name}: stop showing it next to your name` : `Pin ${b.name}: show it next to your name`} onClick={() => setPinned(b.id)}>
                    <Icon name="pin" size="sm" />{b.pinned ? 'Pinned' : 'Pin'}
                  </button>
                </div>
              </div>
            ))}
          </div>
          <span className="muted xsmall">Public: on your profile and in “All badges”. Off: only you see it. Pin: the one badge next to your name (nothing pinned uses your first featured badge).</span>
        </div>
      )}

      <div className="stack gap-12" id="earnable">
        <div className="row gap-10 wrap-row">
          <h3 className="h3">Badges you can earn</h3>
          <span className="muted small">Automatic: checked whenever your characters refresh. Staff and partner badges are granted, not earned.</span>
        </div>
        {data.earnable.length === 0 ? <span className="muted small">You have every badge you can earn right now.</span> : (
          <div className="bcards">
            {data.earnable.map((b) => (
              <div key={b.id} className="bcard locked">
                <div className="bcard-main">
                  <BadgePill badge={b} locked heldBy={b.heldBy} />
                  <span className="fam">{b.familyLabel}</span>
                  <span className="sub">{b.how}{b.note ? ` ${b.note}` : ''}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {data.ineligible?.length > 0 && (
        <div className="stack gap-12">
          <div className="row gap-10 wrap-row">
            <h3 className="h3">Not for this account</h3>
            <span className="muted small">Others can still get these; this account can’t.</span>
          </div>
          <div className="bcards">
            {data.ineligible.map((b) => (
              <div key={b.id} className="bcard locked">
                <div className="bcard-main">
                  <BadgePill badge={b} locked heldBy={b.heldBy} />
                  <span className="fam">{b.familyLabel}</span>
                  <span className="sub">{b.note}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {data.unavailable.length > 0 && (
        <div className="stack gap-12">
          <div className="row gap-10 wrap-row">
            <h3 className="h3">No longer available</h3>
            <span className="muted small">Time-limited badges this account can’t get any more.</span>
          </div>
          <div className="bcards">
            {data.unavailable.map((b) => (
              <div key={b.id} className="bcard locked">
                <div className="bcard-main">
                  <BadgePill badge={b} retired heldBy={b.heldBy} />
                  <span className="fam">{b.familyLabel}</span>
                  <span className="sub">No longer available · {b.note}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

/** Settings → Your guilds (0.7.0): the guilds this account manages on Everstats, with a link to each page's panel. */
export function YourGuildsSection({ guilds }) {
  return (
    <section id="guilds" className="panel pad-24 stack gap-14" aria-labelledby="yourguilds-h">
      <h2 className="h2" id="yourguilds-h">Your guilds</h2>
      <span className="t2 small">Guilds whose Everstats page you can edit: as Guild Master (your character is rank 0 on Blizzard’s roster), or as an officer your Guild Master added.</span>
      <ul className="plain stack gap-8">
        {guilds.map((g) => (
          <li key={g.slug} className="row gap-10">
            <Link to={`/g/${encodeURIComponent(g.slug)}#manage`}>{g.name}</Link>
            <span className="tag">{g.role === 'gm' ? 'Guild Master' : 'Officer'}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
