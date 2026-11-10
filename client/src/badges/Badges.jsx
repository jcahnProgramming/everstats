import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { Icon } from '../chrome/Icon.jsx';
import { Modal } from '../components/Controls.jsx';
import { useToast } from '../components/Toasts.jsx';
import { formatDate, formatNumber } from '../format.js';
import { useSession } from '../session.jsx';
import { BadgeArt } from './art.jsx';

/**
 * Badges (0.7.0), built from design/v2-badges/components/*.md. Different from the design, on purpose (the owner's
 * brief wins, CLAUDE.md "The design draws things the rules forbid"):
 *   - Names are always visible: the profile row, "All badges" and Settings show each badge as a PILL (the standard
 *     44px badge + its name), not an icon alone. Where only an icon fits (the 18px inline badge next to a username),
 *     the name shows on hover, on keyboard focus and on tap, and is the accessible name.
 *   - The inline badge is interactive enough to say its name (a button with a tooltip), never a link and never a
 *     popover: the username beside it is the link. The design drew it as a plain span.
 *   - "Pinned" means one thing: the badge the player pins to show next to their name (the brief). The design's
 *     "pinned" staff and partner badges are "always first" here: they still lead the row, and the player can still
 *     turn them off their profile.
 *   - The popover is position: fixed (it escapes clipped panels), flips above when there's no room below and stays
 *     16px inside the viewport, as the design specifies but didn't prototype.
 */
const OPEN_DELAY_MS = 300;

// "On keyboard focus" means focus that a Tab press moved, not focus a dialog places on its first control when it opens
// (that opened a popover over the "All badges" dialog). Tracked once for the whole page.
let tabbing = false;
if (typeof document !== 'undefined') {
  document.addEventListener('keydown', (e) => { tabbing = e.key === 'Tab'; }, true);
  document.addEventListener('pointerdown', () => { tabbing = false; }, true);
}
const CLOSE_DELAY_MS = 150;
const TOAST_MS = 8000;

export const badgeLabel = (b, { locked = false, retired = false, isNew = false } = {}) => `${b.name} badge${locked ? ' (not earned)' : retired ? ' (no longer available)' : isNew ? ' (new)' : ''}`;

function StateIcon({ kind }) {
  return (
    <span className="state-ico" aria-hidden="true">
      <Icon name={kind === 'retired' ? 'clock' : 'lock'} />
    </span>
  );
}

/** A badge drawing as decoration with a name (role="img"): toasts, cards, the detail page. */
export function BadgeIcon({ badge, size = 'std', isNew = false, locked = false, retired = false, labelled = true }) {
  const cls = ['bdg', size, isNew ? 'is-new' : '', locked ? 'is-locked' : '', retired ? 'is-retired' : ''].filter(Boolean).join(' ');
  return (
    <span className={cls} role={labelled ? 'img' : undefined} aria-label={labelled ? badgeLabel(badge, { locked, retired, isNew }) : undefined} aria-hidden={labelled ? undefined : 'true'}>
      <BadgeArt badge={badge} inline={size === 'inline'} size={size} />
      {(locked || retired) && size !== 'inline' && <StateIcon kind={retired ? 'retired' : 'locked'} />}
    </span>
  );
}

export const BadgeSkeleton = ({ size = 'std' }) => <span className={`bdg ${size} is-loading`} aria-hidden="true"><svg viewBox="0 0 64 64" /></span>;

/**
 * Open-on-hover (300 ms), on keyboard focus and on tap; closes on Esc, a click outside, focus leaving, or the pointer
 * leaving. Positions a fixed popover under the anchor, flipped above when there's no room, clamped 16px inside.
 */
export function usePopover({ onOpen } = {}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  const wrap = useRef(null);
  const anchor = useRef(null);
  const pop = useRef(null);
  const timer = useRef(null);
  const openedOnce = useRef(onOpen);
  openedOnce.current = onOpen;
  const clear = () => {
    clearTimeout(timer.current);
    timer.current = null;
  };
  const show = useCallback(() => {
    clear();
    setOpen(true);
  }, []);
  const hide = useCallback(() => {
    clear();
    setOpen(false);
  }, []);
  useEffect(() => {
    if (open) openedOnce.current?.();
  }, [open]);
  const place = useCallback(() => {
    if (!anchor.current || !pop.current) return;
    const a = anchor.current.getBoundingClientRect();
    const p = pop.current.getBoundingClientRect();
    const gutter = 16;
    const vw = document.documentElement.clientWidth;
    const vh = window.innerHeight;
    let top = a.bottom + 10;
    let above = false;
    if (top + p.height > vh - 8 && a.top - 10 - p.height >= 8) {
      top = a.top - 10 - p.height;
      above = true;
    }
    const left = Math.max(gutter, Math.min(a.left, vw - gutter - p.width));
    const arrow = Math.max(12, Math.min(p.width - 22, a.left + Math.min(a.width / 2, 22) - left - 5));
    setPos({ top, left, above, arrow });
  }, []);
  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return undefined;
    }
    place();
    const onKey = (e) => {
      if (e.key === 'Escape') {
        hide();
        anchor.current?.focus();
      }
    };
    const onDown = (e) => {
      if (wrap.current && !wrap.current.contains(e.target)) hide();
    };
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onDown);
    return () => {
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onDown);
    };
  }, [open, place, hide]);
  useEffect(() => () => {
    clear();
  }, []);
  const wrapProps = {
    ref: wrap,
    onPointerEnter: (e) => {
      if (e.pointerType !== 'mouse') return;
      clear();
      if (!open) timer.current = setTimeout(() => setOpen(true), OPEN_DELAY_MS);
    },
    onPointerLeave: (e) => {
      if (e.pointerType !== 'mouse') return;
      clear();
      if (open && !wrap.current?.contains(document.activeElement)) timer.current = setTimeout(() => setOpen(false), CLOSE_DELAY_MS);
    },
    onBlur: (e) => {
      if (!wrap.current?.contains(e.relatedTarget)) hide();
    },
  };
  const anchorProps = {
    ref: anchor,
    'aria-expanded': open,
    onFocus: (e) => {
      if (tabbing && e.currentTarget.matches(':focus-visible')) show();
    },
    onClick: () => (open ? hide() : show()),
  };
  return { open, pos, pop, wrapProps, anchorProps, hide };
}

/** The popover body (badge-popover.md): badge, name, family + Verified / Time-limited, how, earned + held by, details. */
function PopoverCard({ badge, earnedAt = null, heldBy = null, whose = null, popRef, pos, id }) {
  const style = pos ? { top: `${pos.top}px`, left: `${pos.left}px`, '--pop-arrow': `${pos.arrow}px` } : { visibility: 'hidden', top: 0, left: 0 };
  return (
    <div ref={popRef} id={id} className={`bdg-pop is-fixed${pos?.above ? ' above' : ''}`} role="dialog" aria-label={`${badge.name} badge`} style={style}>
      <div className="hd">
        <BadgeIcon badge={badge} labelled={false} />
        <div className="stack gap-6">
          <span className="nm">{badge.name}</span>
          <span className="row gap-6 wrap-row">
            <span className="tag">{badge.familyLabel}</span>
            {badge.verified && <span className="verified"><Icon name="check" size="sm" />Verified</span>}
            {badge.timeLimited && <span className="tag gold">Time-limited</span>}
          </span>
        </div>
      </div>
      {/* 0.8.1: a Verified Content Creator's checked handles (platform as text, never a logo), one line each */}
      {badge.creator?.length > 0 && (
        <ul className="plain stack gap-2 creator-lines">
          {badge.creator.map((c) => <li key={c.platform} className="small">Verified creator on {c.platform} · <span className="mono">{c.handle}</span></li>)}
        </ul>
      )}
      <span className="how">{badge.how}</span>
      {(earnedAt || heldBy !== null) && (
        <span className="meta">
          <span>{earnedAt ? `${whose ? `${whose} earned` : 'Earned'} ${formatDate(earnedAt)}` : ''}</span>
          {heldBy !== null && <span>Held by {formatNumber(heldBy)} player{heldBy === 1 ? '' : 's'}</span>}
        </span>
      )}
      <Link className="small" to={`/badges/${badge.id}`}>Badge details →</Link>
    </div>
  );
}

/**
 * A badge PILL: the standard badge followed by its name, as a button that opens the popover. Used on the profile row,
 * in "All badges" and on detail pages. `onSeen` is called the first time its popover opens (clears "new").
 */
export function BadgePill({ badge, isNew = false, locked = false, retired = false, earnedAt = null, heldBy = null, whose = null, onSeen = null, featuredMark = false }) {
  const popId = useId();
  const seen = useRef(false);
  const { open, pos, pop, wrapProps, anchorProps } = usePopover({
    onOpen: () => {
      if (!seen.current && isNew && onSeen) {
        seen.current = true;
        onSeen(badge.id);
      }
    },
  });
  return (
    <span className="bdg-anchor" {...wrapProps}>
      <button type="button" className={`bdg-pill${locked ? ' is-locked' : ''}${retired ? ' is-retired' : ''}`} aria-haspopup="dialog" aria-controls={open ? popId : undefined}
        aria-label={`${badgeLabel(badge, { locked, retired, isNew })}${featuredMark ? ', featured' : ''}`} {...anchorProps}>
        <BadgeIcon badge={badge} isNew={isNew} locked={locked} retired={retired} labelled={false} />
        <span className="bdg-pill-name">{badge.name}</span>
        {featuredMark && <span className="tag xs">Featured</span>}
      </button>
      {open && <PopoverCard badge={badge} earnedAt={earnedAt} heldBy={heldBy} whose={whose} popRef={pop} pos={pos} id={popId} />}
    </span>
  );
}

/**
 * The 18px inline badge after a username (inline-badge.md): the player's pinned badge, or their first featured one.
 * Its name shows on hover, on keyboard focus and on tap, and is its accessible name. Not on leaderboards.
 */
export function InlineBadge({ badge }) {
  const [tapped, setTapped] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!tapped) return undefined;
    const off = (e) => {
      if (!ref.current?.contains(e.target)) setTapped(false);
    };
    const esc = (e) => {
      if (e.key === 'Escape') setTapped(false);
    };
    document.addEventListener('pointerdown', off);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('pointerdown', off);
      document.removeEventListener('keydown', esc);
    };
  }, [tapped]);
  if (!badge) return null;
  const tipId = `tip-${badge.id}`;
  return (
    <span className={`ibdg${tapped ? ' is-open' : ''}`} ref={ref}>
      <button type="button" className="bdg inline" aria-label={badgeLabel(badge)} onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setTapped((v) => !v);
      }} onBlur={() => setTapped(false)}>
        <BadgeArt badge={badge} inline />
      </button>
      <span className="ibdg-tip" role="tooltip" id={tipId} aria-hidden="true">{badge.name}</span>
    </span>
  );
}

/** @username followed by the inline badge (the name never wraps away from the badge). */
export function NameWithBadge({ username, badge, link = true }) {
  return (
    <span className="name-badge">
      {link ? <Link className="handle mono" to={`/u/${username}`}>@{username}</Link> : <span className="handle mono">@{username}</span>}
      <InlineBadge badge={badge} />
    </span>
  );
}

/**
 * The profile's badge row (badge-row.md): up to 6 featured, staff and partner first, as pills; "+N more" opens "All
 * badges". No badges → nothing at all (states/empty-profile).
 */
export function BadgeRow({ badges, whose = null }) {
  const [all, setAll] = useState(false);
  const markSeen = useCallback((id) => {
    if (badges?.own) api('/api/account/badges/seen', { method: 'POST', body: { ids: [id] } }).catch(() => {});
  }, [badges?.own]);
  if (!badges || (!badges.featured.length && !badges.more.length)) return null;
  const pill = (b, featuredMark = false) => (
    <BadgePill key={b.id} badge={b} isNew={badges.own && b.isNew} earnedAt={b.earnedAt} heldBy={b.heldBy} whose={badges.own ? null : whose} onSeen={markSeen} featuredMark={featuredMark} />
  );
  const shown = badges.featured.length ? badges.featured : badges.more.slice(0, 6);
  const rest = badges.featured.length ? badges.more : badges.more.slice(6);
  return (
    <div className="bdg-row" aria-label="Badges">
      {shown.map((b) => pill(b))}
      {rest.length > 0 && (
        <button type="button" className="bdg-more" onClick={() => setAll(true)} aria-haspopup="dialog">+{rest.length} more</button>
      )}
      {all && (
        <Modal title="All badges" onClose={() => setAll(false)} actions={<button type="button" className="btn" onClick={() => setAll(false)}>Close</button>}>
          <div className="bdg-row">
            {badges.featured.map((b) => pill(b, true))}
            {badges.more.map((b) => pill(b))}
          </div>
        </Modal>
      )}
    </div>
  );
}

/**
 * Badge toasts (badge-toast.md): asks for waiting toasts after each page load and every minute while signed in and
 * visible. Several earned or granted at once → one "You earned N badges" toast; a removed one (S-Tier) → its own warn
 * toast. Then acknowledges them, so another tab or the next load doesn't repeat them, and refreshes the header badge.
 */
export function BadgeToastWatcher() {
  const session = useSession();
  const push = useToast();
  const busy = useRef(false);
  const signedIn = session.signedIn;
  const refresh = session.refresh;
  const check = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    try {
      const { toasts } = await api('/api/account/badges/toasts');
      if (!toasts.length) return;
      const gained = toasts.filter((x) => x.kind !== 'removed');
      const lost = toasts.filter((x) => x.kind === 'removed');
      if (gained.length > 1) {
        push({ kind: 'ok', ms: TOAST_MS, badge: gained[0].badge, title: `You earned ${gained.length} badges`, body: gained.map((x) => x.badge.name).join(', ') + '.', action: { to: '/settings#badges', label: 'See your badges' } });
      } else if (gained.length === 1) {
        const g = gained[0];
        push(g.kind === 'granted'
          ? { kind: 'info', ms: TOAST_MS, badge: g.badge, title: `Badge granted: ${g.badge.name}`, body: 'Granted by Everstats staff.', action: { to: `/badges/${g.badge.id}`, label: 'View badge' } }
          : { kind: 'ok', ms: TOAST_MS, badge: g.badge, title: `Badge earned: ${g.badge.name}`, body: g.badge.how, action: { to: `/badges/${g.badge.id}`, label: 'View badge' } });
      }
      for (const l of lost) {
        push({ kind: 'warn', ms: TOAST_MS, badge: l.badge, title: `${l.badge.name} badge removed`, body: `${l.reason ?? 'You no longer meet its rule.'} It comes back automatically if you regain it.` });
      }
      await api('/api/account/badges/toasts/ack', { method: 'POST', body: { ids: toasts.map((x) => x.badge.id) } });
      refresh();
    } catch {
      /* a toast that didn't arrive comes on the next check */
    } finally {
      busy.current = false;
    }
  }, [push, refresh]);
  useEffect(() => {
    if (!signedIn) return undefined;
    check();
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') check();
    }, 60_000);
    return () => {
      clearInterval(timer);
    };
  }, [signedIn, check]);
  return null;
}
