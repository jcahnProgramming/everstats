import { useEffect, useLayoutEffect, useRef } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigationType } from 'react-router-dom';
import { APP_VERSION } from '../release.js';
import { useSession } from '../session.jsx';
import { Emblem, TrophyIcon, UserIcon } from './icons.jsx';
import { createScrollMemory, focusMainHeading, restoreScroll, scrollDecision } from './scrollMemory.js';
import './chrome.css';

// A top bar (emblem + name, Leaderboards, and Sign in or Settings) and one strip pinned to the bottom of every page
// with the version, which is the ONLY link to /changelog. No admin link anywhere.
export function AppShell() {
  const { pathname } = useLocation();
  const session = useSession();
  return (
    <>
      <ScrollManager />
      <header className="topbar-bar">
        <div className="topbar">
          <Link to="/" className="topbar-name" aria-label="Everstats, home">
            <Emblem />
            <span className="topbar-word display">Everstats</span>
          </Link>
          <nav className="topbar-actions" aria-label="Main">
            <NavLink to="/leaderboards" className="btn btn-ghost btn-sm">
              <TrophyIcon size={18} />
              <span className="topbar-label">Leaderboards</span>
            </NavLink>
            {session.signedIn ? (
              <NavLink to="/settings" className="btn btn-sm" aria-label="Account settings">
                <UserIcon size={18} />
                <span className="topbar-label">Settings</span>
              </NavLink>
            ) : (
              <NavLink to="/sign-in" className="btn btn-primary btn-sm">Sign in</NavLink>
            )}
          </nav>
        </div>
      </header>

      <div className="shell">
        <main className="page" key={pathname}>
          <Outlet />
        </main>
      </div>

      {/* Parts are spaced by the flex gap, never by literal spaces (inside a flex box bare text runs lose their edge
          whitespace: "Everstatsv0.1.0"). */}
      <footer className="bottombar">
        <NavLink to="/changelog" className="version-link">
          <span className="version-name">Everstats</span>
          <span className="version-number">v{APP_VERSION}</span>
          <span aria-hidden="true">·</span>
          <span>What's new</span>
        </NavLink>
        <span className="bottombar-note">US · Not affiliated with Blizzard Entertainment</span>
      </footer>
    </>
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
  }, [location.key]);

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
