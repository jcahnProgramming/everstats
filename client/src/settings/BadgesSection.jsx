import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { BadgeIcon, BadgePill, InlineBadge } from '../badges/Badges.jsx';
import { Icon } from '../chrome/Icon.jsx';
import { Toggle } from '../components/Controls.jsx';
import { useToasts } from '../components/Toasts.jsx';
import { formatDate } from '../format.js';
import { useSession } from '../session.jsx';

/**
 * Settings → Badges (design/v2-badges/pages/settings-badges + components/badge-picker.md), 0.7.0.
 *
 *   Featured     6 slots in the order the profile row shows them. Drag to reorder, or with the keyboard: focus a slot,
 *                Space to pick it up, arrow keys to move, Space to drop, Esc to cancel (announced). Staff and partner
 *                badges always come first (the design's rule); the slot with the pin is the badge shown next to the
 *                player's name.
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
    } catch (err) {
      if (err.code === 'too_many') setNote(err.message);
      else toast.err('Couldn’t save your badges', err.message);
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
  const reorder = (ids) => save({ shown, featured: ordered(ids, byId), pinned });

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
        <Slots featured={featured} byId={byId} pinned={pinned} max={data.max} onReorder={reorder} disabled={busy} />
        {empty ? (
          <span className="t2 small">No badges yet. <a href="#earnable">See the badges you can earn</a>: they arrive by themselves when your characters refresh.</span>
        ) : (
          <span className="muted xsmall">Drag to reorder. Keyboard: focus a badge, Space to pick it up, arrow keys to move it, Space to drop it, Esc to cancel.</span>
        )}
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
          {note && <div className="note warn small" role="alert"><Icon name="warning" /><span className="grow">{note}</span></div>}
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

/**
 * The six featured slots. Pointer drag: the slot under the pointer is marked as the drop target; nothing moves until
 * the drop (a drag must not move the node that holds the pointer), and the end-of-drag listeners live on window.
 */
function Slots({ featured, byId, pinned, max, onReorder, disabled }) {
  const [order, setOrder] = useState(featured);
  const [picked, setPicked] = useState(null); // keyboard: the id being moved
  const [drag, setDrag] = useState(null); // pointer: { id, over }
  const [said, setSaid] = useState('');
  const before = useRef(null);
  const refs = useRef([]);
  useEffect(() => {
    if (!picked && !drag) setOrder(featured);
  }, [featured, picked, drag]);

  const movable = (id) => id && !FIRST.includes(byId.get(id)?.family);
  const firstCount = order.filter((id) => !movable(id)).length;

  const onKey = (e, i) => {
    const id = order[i];
    if (!id || disabled) return;
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      if (!picked) {
        if (!movable(id)) {
          setSaid(`${byId.get(id).name} always comes first and can’t be moved.`);
          return;
        }
        before.current = order;
        setPicked(id);
        setSaid(`Picked up ${byId.get(id).name}, position ${i + 1} of ${order.length}. Use the arrow keys, then Space to drop.`);
      } else {
        setPicked(null);
        setSaid(`Dropped ${byId.get(id).name} at position ${i + 1}.`);
        onReorder(order);
      }
      return;
    }
    if (e.key === 'Escape' && picked) {
      e.preventDefault();
      setOrder(before.current);
      setPicked(null);
      setSaid('Cancelled. The order is as it was.');
      return;
    }
    const step = { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 }[e.key];
    if (!step || !picked) return;
    e.preventDefault();
    const at = order.indexOf(picked);
    const to = Math.max(firstCount, Math.min(order.length - 1, at + step));
    if (to === at) return;
    const next = [...order];
    next.splice(at, 1);
    next.splice(to, 0, picked);
    setOrder(next);
    setSaid(`${byId.get(picked).name}, position ${to + 1} of ${next.length}.`);
    requestAnimationFrame(() => refs.current[to]?.focus());
  };

  const dragRef = useRef(null);
  dragRef.current = drag;
  const dragging = Boolean(drag);
  useEffect(() => {
    if (!dragging) return undefined;
    const move = (e) => {
      const el = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-slot-index]');
      const over = el ? Number(el.dataset.slotIndex) : null;
      setDrag((d) => (d && d.over !== over ? { ...d, over } : d));
    };
    const up = () => {
      const d = dragRef.current;
      setDrag(null);
      if (!d || d.over === null || d.over >= order.length) return;
      const at = order.indexOf(d.id);
      const to = Math.max(firstCount, d.over);
      if (to === at) return;
      const next = [...order];
      next.splice(at, 1);
      next.splice(to, 0, d.id);
      setOrder(next);
      onReorder(next);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
  }, [dragging, order, firstCount, onReorder]);

  return (
    <>
      <div className="slots" role="group" aria-label="Featured badges, in order">
        {Array.from({ length: max }, (_, i) => {
          const id = order[i];
          const b = id ? byId.get(id) : null;
          if (!b) return <span key={`e${i}`} className="slot-b empty" data-slot-index={i} aria-label={`${i + 1}. Empty`} role="img"><span className="n">{i + 1}</span></span>;
          const cls = ['slot-b', !movable(id) ? 'pinned' : '', picked === id ? 'is-picked' : '', drag?.id === id ? 'dragging' : '', drag && drag.over === i && drag.id !== id ? 'drop' : ''].filter(Boolean).join(' ');
          return (
            <button key={id} type="button" ref={(el) => { refs.current[i] = el; }} className={cls} data-slot-index={i}
              aria-label={`${i + 1}. ${b.name}${pinned === id ? ', pinned next to your name' : ''}${!movable(id) ? ', always first' : ''}${picked === id ? ', picked up' : ''}`}
              aria-pressed={picked === id}
              onKeyDown={(e) => onKey(e, i)}
              onPointerDown={(e) => {
                if (e.pointerType === 'mouse' && e.button !== 0) return;
                if (!movable(id) || disabled) return;
                setDrag({ id, over: i });
              }}>
              <span className="n">{i + 1}</span>
              {pinned === id && <span className="pin" title="Shown next to your name"><Icon name="pin" /></span>}
              <BadgeIcon badge={b} labelled={false} />
            </button>
          );
        })}
      </div>
      <span className="sr-only" aria-live="assertive">{said}</span>
    </>
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
