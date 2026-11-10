import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { usePopover } from '../badges/Badges.jsx';
import { Icon } from '../chrome/Icon.jsx';
import { Modal } from '../components/Controls.jsx';
import { useToast } from '../components/Toasts.jsx';
import { formatDate, formatNumber } from '../format.js';
import { useSession } from '../session.jsx';
import { GuildBadgeArt } from './art.jsx';

/**
 * Guild badges (0.7.1), built from design/v2-guild-badges/components/*.md. Different from the design, on purpose:
 *   - Icon-only guild badges (boards, /guilds) say their name and level on hover, keyboard focus and tap, like the
 *     player's inline badge; they are not links (the guild's name beside them is).
 *   - The Verified mark is a status mark beside the name (the owner accepted the proposal), with its words on hover.
 *   - "Copy sign-up link" copies the guild page's own address, nothing appended: no tracking or referral parameter.
 *     The page itself asks signed-out visitors to sign in with Battle.net.
 */
export const guildBadgeName = (b) => `${b.name}${b.numeral ? ` ${b.numeral}` : ''}`;
const label = (b, extra = '') => `${guildBadgeName(b)}: guild badge${extra}`;
const LEVEL_WORD = (b) => (b.numeral ? `Level ${b.numeral} (${b.metal})` : null);

function Mark({ kind }) {
  if (!kind) return null;
  const icon = kind === 'held' || kind === 'lost' ? 'hourglass' : kind === 'closed' ? 'clock' : 'lock';
  return <span className={`mark ${kind}`} aria-hidden="true"><Icon name={icon} /></span>;
}

/**
 * The guild badge drawing (guild-badge.md). state: null (unlocked) | 'held' | 'lost' | 'locked' | 'progress' |
 * 'retired'. size: inline | pill-ico | std | lg | xl.
 */
export function GuildBadgeIcon({ badge, size = 'std', state = null, isNew = false, labelled = true, extraLabel = '' }) {
  const stateCls = { lost: 'is-lost', locked: 'is-locked', progress: 'is-progress', retired: 'is-retired', held: 'is-held' }[state] ?? '';
  const cls = ['gbdg', size, stateCls, isNew ? 'is-new' : ''].filter(Boolean).join(' ');
  const mark = state === 'held' ? 'held' : state === 'lost' ? 'lost' : state === 'locked' ? 'lock' : state === 'retired' ? 'closed' : null;
  const words = { held: ' (held)', lost: ' (lost)', locked: ' (locked)', progress: ' (in progress)', retired: ' (no longer available)' }[state] ?? '';
  return (
    <span className={cls} role={labelled ? 'img' : undefined} aria-label={labelled ? label(badge, `${words}${extraLabel}`) : undefined} aria-hidden={labelled ? undefined : 'true'}>
      <GuildBadgeArt badge={badge} inline={size === 'inline'} />
      {size !== 'inline' && size !== 'pill-ico' && <Mark kind={mark} />}
    </span>
  );
}

const BOARD_RANK = { 'board-champion': '#1', 'top-ten': 'Top 10', 'weekly-champion': '#1 this week' };
const boardLine = (b, badgeId) => [BOARD_RANK[badgeId] ?? '', b.statistic ?? 'A statistic no longer available', b.mode === 'average' ? 'per-member average' : 'total', b.ruleset].filter(Boolean).join(' · ');

function Progress({ p, measure, small = false }) {
  if (!p) return null;
  return (
    <>
      <div className={`gprog${small ? ' sm' : ''}`} role="progressbar" aria-valuemin={0} aria-valuemax={p.threshold} aria-valuenow={Math.min(p.value, p.threshold)} aria-label={`${formatNumber(p.value)} of ${formatNumber(p.threshold)} ${measure}`}>
        <span style={{ width: `${(p.pct * 100).toFixed(1)}%` }} />
      </div>
      <div className="nums"><span><b>{formatNumber(p.value)}</b> / {formatNumber(p.threshold)} {measure}</span><span>{formatNumber(p.toGo)} to go</span></div>
    </>
  );
}

/** The popover body (guild-popover.md). */
function GuildPopoverCard({ badge, popRef, pos, id }) {
  const style = pos ? { top: `${pos.top}px`, left: `${pos.left}px`, '--pop-arrow': `${pos.arrow}px` } : { visibility: 'hidden', top: 0, left: 0 };
  const state = badge.keptWhileHeld ? (badge.state === 'lost' ? 'lost' : 'held') : null;
  const eyebrow = ['Guild badge', badge.familyLabel, LEVEL_WORD(badge)].filter(Boolean).join(' · ');
  return (
    <div ref={popRef} id={id} className={`bdg-pop is-fixed gbdg-pop${pos?.above ? ' above' : ''}`} role="dialog" aria-label={`${guildBadgeName(badge)} guild badge`} style={style}>
      <div className="hd">
        <GuildBadgeIcon badge={badge} state={state} labelled={false} />
        <div className="stack gap-4">
          <span className="nm">{guildBadgeName(badge)}</span>
          <span className="eyebrow">{eyebrow}</span>
        </div>
      </div>
      <p className="how">
        {badge.levelled && badge.reached ? `Reached ${formatNumber(badge.reached)} ${badge.measure}.` : badge.how}
        {badge.event?.label ? ` ${badge.event.label}.` : ''}
      </p>
      {badge.levelled && badge.progress && (
        <div className="stack gap-6 gpop-next">
          <span className="eyebrow">Next · {badge.name} {badge.progress.numeral} ({badge.progress.metal}) at {formatNumber(badge.progress.threshold)}</span>
          <Progress p={badge.progress} measure={badge.measure} small />
        </div>
      )}
      {badge.levelled && badge.measured === false && <span className="muted xsmall">Progress appears once this guild’s totals are added up.</span>}
      {badge.boards && badge.boards.length > 0 && (
        <div className="stack gap-4 xsmall t2">
          <span className="eyebrow">Board{badge.boards.length === 1 ? '' : 's'}</span>
          {badge.boards.slice(0, 4).map((b) => <span key={`${b.statisticId}-${b.mode}-${b.period}`}>{boardLine(b, badge.id)}</span>)}
          {badge.boards.length > 4 && <span className="muted">and {formatNumber(badge.boards.length - 4)} more</span>}
        </div>
      )}
      <div className="meta">
        {badge.keptWhileHeld && badge.state === 'lost'
          ? <span>Lost {formatDate(badge.lostAt)} · held {formatDate(badge.heldSince)} – {formatDate(badge.lostAt)} · returns if regained</span>
          : badge.keptWhileHeld
            ? <><span className="row gap-4 held-line"><Icon name="hourglass" size="sm" />Held since {formatDate(badge.heldSince)}</span><span>Kept while held</span></>
            : <span>Unlocked {formatDate(badge.levelled ? badge.levelAt : badge.firstAt)}</span>}
        {badge.ribbon && badge.keptWhileHeld && badge.state !== 'lost' && <span>Unlocked {formatDate(badge.ribbon)}</span>}
        <span>Held by {formatNumber(badge.heldBy)} guild{badge.heldBy === 1 ? '' : 's'}{badge.levelled ? ` at ${badge.numeral}` : ''}</span>
      </div>
      <Link className="small" to={`/guild-badges/${badge.id}`}>Badge details →</Link>
    </div>
  );
}

/**
 * A guild badge PILL (guild-pill.md): icon + name + level numeral, as a button opening the popover. `ribbon`: for 7 days
 * after an unlock, a small "NEW" marker INSIDE the pill (0.9.0). The design's "Unlocked [date]" ribbon (unlocked-ribbon.md)
 * floated over the pill and cut off it and its neighbours; the date now lives in the popover and on the badge's page.
 */
export function GuildPill({ badge, pinned = false, small = false, ribbon = true }) {
  const popId = useId();
  const { open, pos, pop, wrapProps, anchorProps } = usePopover();
  const held = badge.keptWhileHeld && badge.state === 'held';
  const showRibbon = ribbon && Boolean(badge.ribbon);
  return (
    <span className="bdg-anchor gpill-anchor" {...wrapProps}>
      <button type="button" className={`gpill${pinned ? ' pinned' : ''}${small ? ' sm' : ''}${showRibbon ? ' is-new' : ''}`} aria-haspopup="dialog" aria-controls={open ? popId : undefined}
        aria-label={label(badge, `${pinned ? ', pinned' : ''}${held ? ', held' : ''}${showRibbon ? `, unlocked ${formatDate(badge.ribbon)}` : ''}`)} {...anchorProps}>
        <GuildBadgeIcon badge={badge} size="pill-ico" labelled={false} />
        <span>{badge.name}</span>
        {badge.numeral && <span className="lvl">{badge.numeral}</span>}
        {pinned && <span className="pin" aria-hidden="true"><Icon name="pin" /></span>}
        {held && <span className="held"><Icon name="hourglass" />Held</span>}
        {showRibbon && <span className="gnew" aria-hidden="true">New</span>}
      </button>
      {open && <GuildPopoverCard badge={badge} popRef={pop} pos={pos} id={popId} />}
    </span>
  );
}

/** The 18px inline guild badge beside a guild's name on boards and lists: its name and level on hover, focus and tap. */
export function InlineGuildBadge({ badge, still = false }) {
  const [tapped, setTapped] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!tapped) return undefined;
    const off = (e) => {
      if (!ref.current?.contains(e.target)) setTapped(false);
    };
    document.addEventListener('pointerdown', off);
    return () => {
      document.removeEventListener('pointerdown', off);
    };
  }, [tapped]);
  if (!badge) return null;
  // Inside a link (a phone board row) a button isn't allowed: the drawing alone, named for screen readers.
  if (still) return <span className="gbdg inline" role="img" aria-label={label(badge)}><GuildBadgeArt badge={badge} inline /></span>;
  return (
    <span className={`ibdg${tapped ? ' is-open' : ''}`} ref={ref}>
      <button type="button" className="gbdg inline" aria-label={label(badge)} onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setTapped((v) => !v);
      }} onBlur={() => setTapped(false)}>
        <GuildBadgeArt badge={badge} inline />
      </button>
      <span className="ibdg-tip" role="tooltip" aria-hidden="true">{guildBadgeName(badge)} · guild badge</span>
    </span>
  );
}

/** Verified Guild as a status mark beside the guild's name (never a badge slot). `compact`: the icon only. */
const VERIFIED_ART = { id: 'verified-guild', name: 'Verified Guild', art: 'recognition/verified-guild' };
export function VerifiedMark({ compact = false, still = false }) {
  if (still) return <span className="gverified compact" role="img" aria-label="Verified Guild"><span className="gbdg inline" aria-hidden="true"><GuildBadgeArt badge={VERIFIED_ART} inline /></span></span>;
  return (
    <span className={`gverified ibdg${compact ? ' compact' : ''}`} tabIndex={compact ? 0 : undefined} aria-label={compact ? 'Verified Guild: its Guild Master is on Everstats' : undefined} role={compact ? 'img' : undefined}>
      <span className="gbdg inline" aria-hidden="true"><GuildBadgeArt badge={VERIFIED_ART} inline /></span>
      {!compact && <span>Verified</span>}
      <span className="ibdg-tip" role="tooltip" aria-hidden="true">Verified Guild · its Guild Master is on Everstats</span>
    </span>
  );
}

/** A guild's name with its pinned badge and Verified mark (boards, /guilds). */
export function GuildName({ guild, link = true, still = false }) {
  if (!guild?.name) return <span className="muted">A guild Everstats no longer has</span>;
  return (
    <span className="gname">
      {link ? <Link to={`/g/${encodeURIComponent(guild.slug)}`}>{guild.name}</Link> : <b className="ellipsis">{guild.name}</b>}
      {guild.badge && <InlineGuildBadge badge={guild.badge} still={still} />}
      {guild.verified && <VerifiedMark compact still={still} />}
    </span>
  );
}

/**
 * The guild page's badge area: the row (up to 6 pills, pinned first, "+N more"), Next unlocks with the rally line.
 * A guild with nothing to show draws NO row and no heading (states/empty), only Next unlocks.
 */
/**
 * 0.9.2: how many of the row's pills fit on ONE line beside "+N more" (the button used to wrap alone onto a second
 * line). Starts from all of them; while the "+N more" button (or the last pill) sits lower than the first pill, one
 * fewer is shown and it counts into "+N more" instead. Measured again whenever the row's width changes.
 */
function useFitOnOneLine(ref, total) {
  const [fit, setFit] = useState(total);
  const width = useRef(null);
  useLayoutEffect(() => {
    setFit(total);
    const el = ref.current;
    if (!el || typeof ResizeObserver !== 'function') return undefined;
    const ro = new ResizeObserver(() => {
      if (el.clientWidth !== width.current) {
        width.current = el.clientWidth;
        setFit(total);
      }
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
    };
  }, [ref, total]);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || fit <= 1) return;
    const items = [...el.children].filter((k) => k.matches('[data-fit-item]'));
    if (items.length < 2) return;
    const top = items[0].offsetTop;
    if (items.some((k) => k.offsetTop > top + 2)) setFit((f) => Math.max(1, f - 1));
  });
  return fit;
}

export function GuildBadgeArea({ data, guild, canManage }) {
  const b = data;
  const [all, setAll] = useState(false);
  const rowRef = useRef(null);
  const fit = useFitOnOneLine(rowRef, b?.row.length ?? 0);
  if (!b) return null;
  const any = b.row.length > 0;
  const pinnedId = b.row[0]?.id ?? null;
  const extra = b.row.length - Math.min(fit, b.row.length) + b.more.length;
  return (
    <section className="stack gap-16" aria-label="Guild badges">
      {any && (
        <>
          <div className="orn"><span className="gem" /><h2 className="h2">Guild badges</h2><span className="rule" />{b.automatic && <span className="muted xsmall">shown automatically</span>}</div>
          <div className="grow gbadge-row" ref={rowRef}>
            {b.row.slice(0, Math.max(1, fit)).map((x) => <span key={x.id} className="gbadge-fit" data-fit-item=""><GuildPill badge={x} pinned={x.id === pinnedId} /></span>)}
            {extra > 0 && <button type="button" className="gmore" data-fit-item="" aria-haspopup="dialog" onClick={() => setAll(true)}>+{extra} more</button>}
            {canManage && <Link className="btn sm ghost" to={`/g/${encodeURIComponent(guild.slug)}/manage/badges`}><Icon name="pin" size="sm" />Manage badges</Link>}
          </div>
        </>
      )}
      {all && (
        <Modal title={`Guild badges · ${b.row.length + b.more.length}`} onClose={() => setAll(false)} actions={<button type="button" className="btn" onClick={() => setAll(false)}>Close</button>}>
          <div className="grow">{[...b.row, ...b.more].map((x) => <GuildPill key={x.id} badge={x} pinned={x.id === pinnedId} />)}</div>
          <span className="muted xsmall">{b.automatic ? 'Shown automatically: nobody on Everstats manages this guild yet.' : 'Chosen by the Guild Master and officers. Pinned first.'}</span>
        </Modal>
      )}
      <NextUnlocks items={b.nextUnlocks} measuring={b.measuring} guild={guild} canManage={canManage && !any} />
    </section>
  );
}

/** Next unlocks (progress-strip.md): the 3 levelled badges closest to their next level, and the rally line. */
export function NextUnlocks({ items, measuring, guild, canManage = false }) {
  const toast = useToast();
  const copy = async () => {
    const url = `${window.location.origin}/g/${encodeURIComponent(guild.slug)}`;
    try {
      await navigator.clipboard.writeText(url);
      toast({ kind: 'ok', title: 'Sign-up link copied', body: url });
    } catch {
      toast({ kind: 'warn', title: 'Couldn’t copy', body: `Copy it yourself: ${url}` });
    }
  };
  return (
    <div className="stack gap-12">
      <div className="row gap-10 wrap-row">
        <h3 className="h3">Next unlocks</h3>
        <span className="muted xsmall">Closest to their next level</span>
        {canManage && <><span className="spacer" /><Link className="btn sm ghost" to={`/g/${encodeURIComponent(guild.slug)}/manage/badges`}>Manage badges</Link></>}
      </div>
      {items.length === 0 ? (
        <span className="t2 small">{measuring ? 'Being added up: progress appears within a few minutes of a member being fetched.' : 'Every levelled guild badge is at its top level.'}</span>
      ) : (
        <div className="unlocks">
          {items.map((x) => (
            <div key={x.id} className="ucard">
              <Link to={`/guild-badges/${x.id}`} className="gbdg std is-progress" aria-label={label(x, ' (in progress)')}><GuildBadgeArt badge={x} /></Link>
              <div className="ttl"><b>{x.name}</b><span className="lvl">{x.numeral}</span><span className="muted xsmall">· {x.metal}</span></div>
              <span className="muted xsmall">{x.measure.charAt(0).toUpperCase() + x.measure.slice(1)}{x.id === 'muster' ? ' on Everstats' : ', combined'}</span>
              <Progress p={x.progress} measure={x.measure} />
            </div>
          ))}
        </div>
      )}
      <div className="rally">
        <span className="muted small">Every guildie who signs in with Battle.net is tracked, and moves {guild.name} closer.</span>
        <button type="button" className="btn sm gold" onClick={copy}><Icon name="copy" size="sm" />Copy sign-up link</button>
      </div>
    </div>
  );
}

/**
 * Guild badge toasts (guild-toast.md): only for the Guild Master and officers, when they open the guild page or Manage.
 * Several unlocks → one "N guild badges unlocked" toast; each loss its own warn toast. Then acknowledged.
 */
export function GuildBadgeToasts({ slug, enabled }) {
  const session = useSession();
  const push = useToast();
  const done = useRef(null);
  const run = useCallback(async () => {
    try {
      const { toasts, until } = await api(`/api/guilds/${encodeURIComponent(slug)}/badges/toasts`);
      if (!toasts.length) return;
      const gained = toasts.filter((t) => t.kind !== 'lost');
      const lost = toasts.filter((t) => t.kind === 'lost');
      const manage = { to: `/g/${encodeURIComponent(slug)}/manage/badges`, label: 'Manage badges' };
      if (gained.length > 1) {
        push({ kind: 'ok', ms: 8000, guildBadge: gained.at(-1).badge, title: `${gained.length} guild badges unlocked`, body: gained.map((t) => guildBadgeName(t.badge)).join(', ') + '.', action: manage });
      } else if (gained.length === 1) {
        push({ kind: 'ok', ms: 8000, guildBadge: gained[0].badge, title: `Guild badge unlocked: ${guildBadgeName(gained[0].badge)}`, body: gained[0].badge.how, action: manage });
      }
      for (const l of lost) {
        push({ kind: 'warn', ms: 8000, guildBadge: l.badge, title: `${l.badge.name} lost`, body: 'The guild no longer holds it. It returns automatically if regained.', action: manage });
      }
      await api(`/api/guilds/${encodeURIComponent(slug)}/badges/toasts/ack`, { method: 'POST', body: { until } });
    } catch {
      /* the next visit shows them */
    }
  }, [slug, push]);
  useEffect(() => {
    if (!session.signedIn || !enabled || done.current === slug) return;
    done.current = slug;
    run();
  }, [session.signedIn, enabled, slug, run]);
  return null;
}
