import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate, useNavigationType } from 'react-router-dom';
import { APP_VERSION } from '../release.js';
import { parseCharacterSearch } from '../search.js';
import { useSession } from '../session.jsx';
import { ToastProvider } from '../components/Toasts.jsx';
import { BetaBanner, BetaBadge } from './BetaBanner.jsx';
import { BrandMark } from './BrandMark.jsx';
import { Icon } from './Icon.jsx';
import { createScrollMemory, focusMainHeading, restoreScroll, scrollDecision } from './scrollMemory.js';

/**
 * The frame of every page (design v1, navigation option A "Ledger Bar", design/v1/components/nav.md):
 *
 *   top bar     emblem + wordmark · Leaderboards · Guilds · character search · Sign in / Account
 *               phone (≤ 719px): two icon buttons, search and menu, each opening a sheet under the bar
 *   beta        while the beta window is open: a "Beta" badge beside the wordmark and a slim banner under the bar,
 *               both linking to /beta (BetaBanner.jsx). Gone the moment the owner closes the beta.
 *   footer      disclaimer · Privacy · the version chip, which is the ONLY link to /changelog
 *
 * No admin link anywhere, ever (CLAUDE.md "Admin"): the design's "Admin for the owner" nav item is left out on
 * purpose. The admin is not an account, so there is no "owner" signed in on the public site to show it to.
 */
export function AppShell() {
  const { pathname } = useLocation();
  return (
    <ToastProvider>
      <div className="es mapbg">
        <a className="skip-link" href="#main">Skip to content</a>
        <ScrollManager />
        <TopBar />
        <BetaBanner />
        <main id="main" className="app-main" key={pathname}>
          <Outlet />
        </main>
        <footer className="foot">
          <div className="wrap in">
            <span>Everstats · Not affiliated with or endorsed by Blizzard Entertainment · <Link to="/privacy">Privacy</Link></span>
            <Link to="/changelog" className="ver" aria-label={`Everstats version ${APP_VERSION}: what's new`}>
              <span>v{APP_VERSION}</span>
              <span className="ver-sep" aria-hidden="true">·</span>
              <span className="ver-new">What's new</span>
            </Link>
          </div>
        </footer>
      </div>
    </ToastProvider>
  );
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

  // The sheet is a sibling of .topbar, not inside it: the design hides .topbar .search on phones.
  return (
    <div className="topbar-sticky">
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
          aria-label="Search characters"
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
              </nav>
            )}
          </div>
        </div>
      )}
    </div>
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
 *   signed in          user icon + "Account" → Settings
 */
function AccountButton({ className = '', block = false }) {
  const session = useSession();
  const size = block ? 'block left' : 'sm';
  if (session.loading) return <span className={`btn ${size} ghost ${className} is-placeholder`} aria-hidden="true">Sign in</span>;
  if (session.signedIn) {
    return (
      <NavLink to="/settings" className={`btn ${size} ghost ${className}`}>
        <Icon name="user" size="sm" />
        <span>Account</span>
      </NavLink>
    );
  }
  if (session.stage === 'second_factor') {
    return <NavLink to="/sign-in/2fa" className={`btn ${size} ${className}`}>Finish sign-in</NavLink>;
  }
  return <NavLink to="/sign-in" className={`btn ${size} ${className}`}>Sign in</NavLink>;
}

/** The character search box: "Name Surname" → /c/name-surname. `/` focuses it from anywhere (desktop). */
function TopSearch({ full = false, autoFocus = false, shortcut = false }) {
  const navigate = useNavigate();
  const [value, setValue] = useState('');
  const [problem, setProblem] = useState(null);
  const input = useRef(null);

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

  const submit = (e) => {
    e.preventDefault();
    const r = parseCharacterSearch(value);
    if (!r.ok) {
      setProblem(r.problem);
      return;
    }
    setProblem(null);
    setValue('');
    input.current?.blur();
    navigate(`/c/${encodeURIComponent(r.slug)}`);
  };

  const id = full ? 'sheet-search-problem' : 'top-search-problem';
  return (
    <form role="search" className={`search ${full ? 'full' : ''} top-search`} onSubmit={submit} noValidate>
      <Icon name="search" size="sm" />
      <input
        ref={input}
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          if (problem) setProblem(null);
        }}
        placeholder="Character name + surname"
        aria-label="Search characters by name and surname"
        aria-invalid={problem ? 'true' : undefined}
        aria-describedby={problem ? id : undefined}
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
