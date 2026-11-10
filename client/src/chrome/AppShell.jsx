import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate, useNavigationType } from 'react-router-dom';
import { api } from '../api.js';
import { APP_VERSION, SITE_ENVIRONMENT } from '../release.js';
import { parseCharacterSearch } from '../search.js';
import { useSession } from '../session.jsx';
import { ToastProvider } from '../components/Toasts.jsx';
import { BetaBanner, BetaBadge } from './BetaBanner.jsx';
import { fullTitle, pageTitleFor } from '../../../server/core/pageTitles.js';
import { UsernamePrompt } from '../components/UsernameClaim.jsx';
import { BrandMark } from './BrandMark.jsx';
import { Icon } from './Icon.jsx';
import { createScrollMemory, focusMainHeading, restoreScroll, scrollDecision } from './scrollMemory.js';
import { TierBadge } from '../components/Tier.jsx';
import { BadgeToastWatcher, InlineBadge } from '../badges/Badges.jsx';
import { feedbackHref } from '../feedback/FeedbackPages.jsx';
import { UpdateBar } from './UpdateBar.jsx';
import { BannedStrip, NoticeGate } from '../moderation/Moderation.jsx';

/**
 * The frame of every page (design v1, navigation option A "Ledger Bar", design/v1/components/nav.md):
 *
 *   top bar     emblem + wordmark · Leaderboards · Guilds · character search · Sign in / Account
 *               phone (≤ 719px): two icon buttons, search and menu, each opening a sheet under the bar
 *   beta        while the beta window is open: a "Beta" badge beside the wordmark and a slim banner under the bar,
 *               both linking to /beta (BetaBanner.jsx). Gone the moment the owner closes the beta.
 *   footer      disclaimer · Privacy · Feedback (0.7.1: the form, about the page you're on) · the version chip, which is
 *               the ONLY link to /changelog
 *   0.7.1       an unread dot on the account button when Everstats replied to your feedback; the phone menu lists
 *               Feedback and, signed in, Your feedback. (There is no account dropdown: the button opens Settings.)
 *
 * No admin link anywhere, ever (CLAUDE.md "Admin"): the design's "Admin for the owner" nav item is left out on
 * purpose. The admin is not an account, so there is no "owner" signed in on the public site to show it to.
 */
export function AppShell() {
  const { pathname } = useLocation();
  return (
    // 0.7.1: the toast stack lives INSIDE .es, so it gets the site's font, sizes, link colours and button font like
    // everything else (0.7.0 only gave the stack a font-family; its buttons, links and numbers still used defaults).
    <div className="es mapbg">
      <ToastProvider>
        <a className="skip-link" href="#main">Skip to content</a>
        <ScrollManager />
        <TopBar />
        {/* 0.8.2: the "Everstats was updated" bar, a banned sign-in's strip, and moderation notices (shown once). */}
        <UpdateBar />
        <BannedStrip />
        <BetaBanner />
        <NoticeGate />
        <UsernamePrompt />
        <BadgeToastWatcher />
        {/* 0.9.2: before <main>, so a page that knows its own title (usePageTitle) sets it after this one. */}
        <PageTitle pathname={pathname} />
        <main id="main" className="app-main" key={pathname}>
          <Outlet />
        </main>
        <footer className="foot">
          <div className="wrap in">
            <span>Everstats · Character data comes from Blizzard Entertainment’s game data API · Not affiliated with or endorsed by Blizzard Entertainment · <Link to="/privacy">Privacy</Link> · <Link to={feedbackHref(pathname)}>Feedback</Link></span>
            <Link to="/changelog" className="ver" aria-label={`Everstats version ${APP_VERSION}: what's new`}>
              <span>v{APP_VERSION}</span>
              <span className="ver-sep" aria-hidden="true">·</span>
              <span className="ver-new">What's new</span>
            </Link>
          </div>
        </footer>
      </ToastProvider>
    </div>
  );
}

/**
 * 0.10.2: the DEV bar. On the dev site (dev.everstats.app) a thin striped strip sits at the very top of every page,
 * inside the sticky header so it never scrolls away, in the same magenta in every theme. Production never renders it:
 * SITE_ENVIRONMENT comes from the server's theme boot, set from the server's own environment.
 */
function EnvBar() {
  if (SITE_ENVIRONMENT !== 'dev') return null;
  return (
    <div className="env-bar" role="note" aria-label="Test site">
      <div className="wrap in">
        <b>DEV</b>
        <span className="env-bar-text">
          Test site<span className="env-bar-long">: not the real Everstats. Its accounts, characters and data are separate</span> · v{APP_VERSION}
        </span>
      </div>
    </div>
  );
}

/** 0.9.2: the browser-tab title from the shared table (server/core/pageTitles.js); unknown paths are "Not found". */
function PageTitle({ pathname }) {
  useEffect(() => {
    const t = pageTitleFor(pathname);
    document.title = fullTitle(t === undefined ? 'Not found' : t);
  }, [pathname]);
  return null;
}

function TopBar() {
  const { pathname } = useLocation();
  const [sheet, setSheet] = useState(null); // null | 'search' | 'menu' (phone only)

  // A sheet closes when the page changes and on Escape.
  useEffect(() => {
    setSheet(null);
  }, [pathname]);
  useEffect(() => {
    if (!sheet) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') setSheet(null);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [sheet]);

  const toggle = (which) => setSheet((s) => (s === which ? null : which));

  // The sticky bar's real height, as --es-sticky-top on <html>: anything else that sticks (the Settings section nav)
  // sits just under it, and anchor jumps land below it (scroll-padding-top). Set through the CSSOM: the CSP forbids
  // style="" attributes, not this. The beta banner isn't sticky, so it scrolls away and isn't counted.
  const sticky = useRef(null);
  useEffect(() => {
    const el = sticky.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(() => {
      document.documentElement.style.setProperty('--es-sticky-top', `${Math.round(el.getBoundingClientRect().height)}px`);
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
    };
  }, []);

  // The sheet is a sibling of .topbar, not inside it: the design hides .topbar .search on phones.
  return (
    <div className="topbar-sticky" ref={sticky}>
      <EnvBar />
      <header className="topbar">
        <div className="wrap in">
        <Link to="/" className="brand" aria-label="Everstats, home">
          <BrandMark />
          <span>Everstats</span>
        </Link>
        <BetaBadge />
        <nav className="navlinks" aria-label="Primary">
          <NavLinks />
        </nav>
        <span className="spacer" />
        <TopSearch shortcut />
        <AccountButton className="signin" />
        <button
          type="button"
          className="btn ghost icon nav-icon"
          aria-label="Search characters and guilds"
          aria-expanded={sheet === 'search'}
          aria-controls="phone-sheet"
          onClick={() => toggle('search')}
        >
          <Icon name="search" size="md" />
        </button>
        <button
          type="button"
          className="btn ghost icon nav-icon"
          aria-label="Menu"
          aria-expanded={sheet === 'menu'}
          aria-controls="phone-sheet"
          onClick={() => toggle('menu')}
        >
          <Icon name={sheet === 'menu' ? 'close' : 'menu'} size="md" />
        </button>
        </div>
      </header>
      {sheet && (
        <div id="phone-sheet" className="phone-sheet">
          <div className="wrap stack gap-8">
            {sheet === 'search' ? (
              <TopSearch full autoFocus />
            ) : (
              <nav className="stack gap-4" aria-label="Primary">
                <NavLinks block />
                <AccountButton block />
                <FeedbackLinks />
              </nav>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** Phone menu: Feedback, and (signed in) Your feedback with its unread dot. */
function FeedbackLinks() {
  const session = useSession();
  const { pathname } = useLocation();
  return (
    <>
      <NavLink to={feedbackHref(pathname)} className="btn ghost block left">Feedback</NavLink>
      {session.signedIn && (
        <NavLink to="/settings/feedback" className="btn ghost block left">
          Your feedback{session.feedbackUnread > 0 && <span className="dot-unread" aria-label={`${session.feedbackUnread} new repl${session.feedbackUnread === 1 ? 'y' : 'ies'}`} />}
        </NavLink>
      )}
    </>
  );
}

function NavLinks({ block = false }) {
  const cls = block ? 'btn ghost block left' : undefined;
  // NavLink sets aria-current="page", which the design's .navlinks underline keys off.
  return (
    <>
      <NavLink to="/leaderboards" className={cls}>Leaderboards</NavLink>
      <NavLink to="/guilds" className={cls}>Guilds</NavLink>
    </>
  );
}

/**
 * Sign in / Account (the sign-in button's states):
 *   loading            an invisible placeholder of the same size, so the bar doesn't jump when the session arrives
 *   signed out         "Sign in"
 *   waiting for 2FA    "Finish sign-in" → the code page (a half-signed-in session can do nothing else)
 *   signed in          the display name with @username under it → Settings; before a username is claimed,
 *                      "Choose a username" (a placeholder is never shown as if it were a chosen name)
 *   admin area         on /admin pages the bar says "Admin": the admin is not a player and has no username
 */
function AccountButton({ className = '', block = false }) {
  const session = useSession();
  const { pathname } = useLocation();
  const size = block ? 'block left' : 'sm';
  if (pathname === '/admin' || pathname.startsWith('/admin/')) {
    return <span className={`tag gold ${className} admin-label`}>Admin</span>;
  }
  if (session.loading) return <span className={`btn ${size} ghost ${className} is-placeholder`} aria-hidden="true">Sign in</span>;
  if (session.signedIn) {
    const u = session.user;
    // 0.7.0: the player's one inline badge sits BESIDE the link (a button can't live inside a link); its name shows on
    // hover, focus and tap, and the link's own label names it too.
    const unread = session.feedbackUnread > 0;
    const replies = unread ? `, ${session.feedbackUnread} new feedback repl${session.feedbackUnread === 1 ? 'y' : 'ies'}` : '';
    const link = (
      <NavLink to={unread ? '/settings/feedback' : '/settings'} className={`btn ${size} ghost ${className} who-btn`} aria-label={u?.claimed ? `${u.displayName}, @${u.username}${u.badge ? `, ${u.badge.name} badge` : ''}${replies}: ${unread ? 'your feedback' : 'settings'}` : `Choose a username${replies}: settings`}>
        <Icon name="user" size="sm" />
        {unread && <span className="dot-unread on-icon" aria-hidden="true" />}
        {u?.claimed ? (
          <span className="who-names"><span className="who-display ellipsis">{u.displayName}</span><span className="who-handle ellipsis">@{u.username}</span></span>
        ) : <span className="who-claim-label">Choose a username</span>}
      </NavLink>
    );
    if (!u?.badge) return link;
    return <span className={`who-wrap${block ? ' block' : ''}`}>{link}<InlineBadge badge={u.badge} /></span>;
  }
  if (session.stage === 'banned') {
    return <NavLink to="/banned" className={`btn ${size} ${className}`}><Icon name="lock" size="sm" />Account banned</NavLink>;
  }
  if (session.stage === 'second_factor') {
    return <NavLink to="/sign-in/2fa" className={`btn ${size} ${className}`}>Finish sign-in</NavLink>;
  }
  return <NavLink to="/sign-in" className={`btn ${size} ${className}`}>Sign in</NavLink>;
}

/**
 * The search box: "Name Surname" (or "name-surname") → /c/name-surname, a character look-up. `/` focuses it from
 * anywhere (desktop). 0.5.0: while typing, it also suggests guilds and tracked characters Everstats already knows
 * (GET /api/search), each clearly labelled; text that isn't a character's name and surname goes to /search.
 */
function TopSearch({ full = false, autoFocus = false, shortcut = false }) {
  const navigate = useNavigate();
  const [value, setValue] = useState('');
  const [problem, setProblem] = useState(null);
  const [found, setFound] = useState(null);
  const [open, setOpen] = useState(false);
  const input = useRef(null);
  const box = useRef(null);

  useEffect(() => {
    if (!shortcut) return undefined;
    const onKey = (e) => {
      if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target;
      if (t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      if (!input.current || input.current.offsetParent === null) return; // hidden on phone
      e.preventDefault();
      input.current.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [shortcut]);

  useEffect(() => {
    const q = value.trim();
    if (q.length < 2) {
      setFound(null);
      return undefined;
    }
    let live = true;
    const t = setTimeout(() => {
      api(`/api/search?q=${encodeURIComponent(q)}`).then((r) => { if (live) setFound(r); }, () => { if (live) setFound(null); });
    }, 200);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [value]);

  // Close the suggestions when focus or a click leaves the box.
  useEffect(() => {
    if (!open) return undefined;
    const away = (e) => {
      if (box.current && !box.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('pointerdown', away);
    document.addEventListener('focusin', away);
    return () => {
      document.removeEventListener('pointerdown', away);
      document.removeEventListener('focusin', away);
    };
  }, [open]);

  const done = (to) => {
    setProblem(null);
    setValue('');
    setOpen(false);
    input.current?.blur();
    // 0.7.1: marks the visit as a search (the admin's Activity counts searches; a count, nothing else is kept).
    navigate(to, { state: { via: 'search' } });
  };
  const submit = (e) => {
    e.preventDefault();
    const r = parseCharacterSearch(value);
    if (r.ok) return done(`/c/${encodeURIComponent(r.slug)}`);
    if (value.trim().length >= 2) return done(`/search?q=${encodeURIComponent(value.trim())}`);
    setProblem(r.problem);
  };
  const onKeyDown = (e) => {
    if (e.key === 'Escape') setOpen(false);
    if (e.key === 'ArrowDown' && open) {
      const first = box.current?.querySelector('.search-suggest a');
      if (first) {
        e.preventDefault();
        first.focus();
      }
    }
  };
  const onListKey = (e) => {
    const links = [...(box.current?.querySelectorAll('.search-suggest a') ?? [])];
    const i = links.indexOf(document.activeElement);
    if (e.key === 'ArrowDown' && i < links.length - 1) {
      e.preventDefault();
      links[i + 1].focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      (i > 0 ? links[i - 1] : input.current).focus();
    } else if (e.key === 'Escape') {
      setOpen(false);
      input.current?.focus();
    }
  };

  const id = full ? 'sheet-search-problem' : 'top-search-problem';
  const listId = full ? 'sheet-search-list' : 'top-search-list';
  const any = found && (found.guilds.length > 0 || found.characters.length > 0);
  return (
    <div ref={box} className={`top-search-box${full ? ' full' : ''}`} data-edit-guard="off">
      <form role="search" className={`search ${full ? 'full' : ''} top-search`} onSubmit={submit} noValidate>
        <Icon name="search" size="sm" />
        <input
          ref={input}
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setOpen(true);
            if (problem) setProblem(null);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder="Character or guild"
          aria-label="Search characters by name and surname, or guilds by name"
          aria-invalid={problem ? 'true' : undefined}
          aria-describedby={problem ? id : undefined}
          aria-controls={open && any ? listId : undefined}
          aria-expanded={open && any ? 'true' : 'false'}
          autoComplete="off"
          spellCheck="false"
          enterKeyHint="search"
          maxLength={60}
          // eslint-disable-next-line jsx-a11y/no-autofocus
          autoFocus={autoFocus}
        />
        {!full && <span className="kbd" aria-hidden="true">/</span>}
        {problem && <span id={id} className="search-problem" role="alert">{problem}</span>}
      </form>
      {open && any && (
        <div id={listId} className="search-suggest" onKeyDown={onListKey}>
          {found.characters.length > 0 && <span className="eyebrow search-suggest-h">Characters</span>}
          {found.characters.map((c) => (
            <Link key={`c-${c.slug}`} to={`/c/${encodeURIComponent(c.slug)}`} state={{ via: 'search' }} onClick={() => done(`/c/${encodeURIComponent(c.slug)}`)}>
              <span className="tag search-kind">Character</span>
              <TierBadge letter={c.tier ?? null} size="sm" />
              <span className="ellipsis flex-fill">{c.name} <span className="surname">{c.surname}</span></span>
              <span className="muted xsmall nowrap">{[c.level ? `Level ${c.level}` : null, c.ruleset].filter(Boolean).join(' · ')}</span>
            </Link>
          ))}
          {found.guilds.length > 0 && <span className="eyebrow search-suggest-h">Guilds</span>}
          {found.guilds.map((g) => (
            <Link key={`g-${g.slug}`} to={`/g/${encodeURIComponent(g.slug)}`} state={{ via: 'search' }} onClick={() => done(`/g/${encodeURIComponent(g.slug)}`)}>
              <span className="tag gold search-kind">Guild</span>
              <span className="ellipsis flex-fill">{g.name}</span>
              <span className="muted xsmall nowrap">{[g.ruleset, g.faction].filter(Boolean).join(' · ')}</span>
            </Link>
          ))}
          <span className="muted xsmall search-suggest-foot">Enter looks up a character by name and surname at Blizzard.</span>
        </div>
      )}
    </div>
  );
}

const memory = createScrollMemory();

/** From next-up: a new page opens at the top with its heading focused; Back / Forward return to where it was left. */
function ScrollManager() {
  const location = useLocation();
  const navType = useNavigationType();
  const prevPath = useRef(null);

  useEffect(() => {
    if ('scrollRestoration' in window.history) window.history.scrollRestoration = 'manual';
  }, []);

  useEffect(() => {
    const save = () => memory.save(`${location.key}:${location.pathname}`, window.scrollY);
    window.addEventListener('scroll', save, { passive: true });
    return () => {
      window.removeEventListener('scroll', save);
    };
  }, [location.key]); // eslint-disable-line react-hooks/exhaustive-deps

  useLayoutEffect(() => {
    const decision = scrollDecision({ navType, prevPath: prevPath.current, nextPath: location.pathname });
    prevPath.current = location.pathname;
    if (decision === 'stay') return undefined;
    if (decision === 'restore') return restoreScroll(window, document, memory.get(`${location.key}:${location.pathname}`) ?? 0);
    window.scrollTo(0, 0);
    let touched = false;
    const touch = () => {
      touched = true;
    };
    window.addEventListener('keydown', touch, true);
    window.addEventListener('pointerdown', touch, true);
    const timers = [0, 150, 600].map((ms) => setTimeout(() => {
      if (!touched && (!document.activeElement || document.activeElement === document.body)) focusMainHeading(document);
    }, ms));
    return () => {
      timers.forEach(clearTimeout);
      window.removeEventListener('keydown', touch, true);
      window.removeEventListener('pointerdown', touch, true);
    };
  }, [location.key]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}
