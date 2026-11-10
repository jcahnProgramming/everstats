import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { api } from '../../api.js';
import { Icon } from '../../chrome/Icon.jsx';
import { BrandMark } from '../../chrome/BrandMark.jsx';
import { EnvBar } from '../../chrome/AppShell.jsx';
import { ToastProvider } from '../../components/Toasts.jsx';
import { UpdateBar } from '../../chrome/UpdateBar.jsx';
import { fullTitle } from '../../../../server/core/pageTitles.js';
import { NAV, navActive, pageFor } from './nav.js';
import { RefreshProvider, ago, useRefresh, useRefreshState } from './refresh.jsx';
import { ShellInfoProvider, useScope, useShellInfo } from './scope.jsx';

/**
 * The v5 admin shell (design/v5-admin components/shell.md): a left sidebar (collapsible to an icon rail; a slide-in menu
 * on phones) grouped Moderation / Game data / Site with count badges, and one sticky top bar with the version + region
 * switcher, settings search and the ONE refresh control. Every admin page renders inside it.
 *
 * Not the public AppShell: the admin is not an account and has its own frame. The public top bar never links here.
 * Without an admin session the API answers 404 and the shell sends the browser to /admin/sign-in.
 *
 * Built differently from the mockup, on purpose (CLAUDE.md rules win):
 *   - The auto-refresh picker is a small menu button, not a native <select> (its popup ignores the theme).
 *   - The brand links to the public site with a full page load, so the admin stylesheet never stays on public pages.
 */
const AUTO_CHOICES = [0, 30, 60, 300];
const autoLabel = (s) => (s === 0 ? 'Auto: off' : s < 60 ? `Auto: ${s} s` : `Auto: ${s / 60} min`);

export function AdminShell() {
  const navigate = useNavigate();
  const [info, setInfo] = useState(undefined);
  const [problem, setProblem] = useState(null);
  const loadInfo = useCallback(async () => {
    try {
      setInfo({ ...(await api('/api/admin/shell')), role: 'admin' });
      setProblem(null);
    } catch (err) {
      if (err.status !== 404) {
        setProblem(err.message);
        return;
      }
      // Not the admin: a player with the moderator role (only while moderators are switched on) gets the moderator's
      // shell: Inbox › Reports, the accounts they may act on, their own audit entries. Anyone else: sign-in.
      try {
        const me = await api('/api/admin/moderation/me');
        if (me.actor?.kind !== 'moderator') throw Object.assign(new Error('not a moderator'), { status: 404 });
        setInfo({ role: 'moderator', can: me.can, versions: [], regions: [], primary: null, primaryRegion: null, counts: {}, prefs: {} });
      } catch {
        navigate('/admin/sign-in', { replace: true });
      }
    }
  }, [navigate]);
  useEffect(() => {
    loadInfo();
  }, [loadInfo]);

  if (info === undefined) {
    return (
      <div className="es adm-loading">
        {problem ? (
          <div className="perr" role="alert"><Icon name="error" /><span><b>Couldn’t open the admin.</b> {problem}</span><span className="spacer" /><button type="button" className="btn sm" onClick={loadInfo}>Retry</button></div>
        ) : <span className="muted small" role="status">Opening the admin…</span>}
      </div>
    );
  }
  return (
    <ShellInfoProvider value={info}>
      <Frame info={info} setInfo={setInfo} />
    </ShellInfoProvider>
  );
}

function Frame({ info, setInfo }) {
  const { pathname } = useLocation();
  const [collapsed, setCollapsed] = useState(Boolean(info.prefs?.['shell.collapsed']));
  const [menuOpen, setMenuOpen] = useState(false);
  const [auto, setAuto] = useState(info.prefs?.['refresh.auto'] ?? 0);
  const page = pageFor(pathname);

  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  // Titles from the registry; new pages open at the top with the heading focused.
  useEffect(() => {
    document.title = fullTitle(`${page?.title ?? 'Not found'} · Admin`);
  }, [page?.title]);
  useLayoutEffect(() => {
    window.scrollTo(0, 0);
    const h = document.querySelector('[data-admin-heading]');
    h?.focus({ preventScroll: true });
  }, [pathname]);

  const savePref = useCallback(async (key, value) => {
    try {
      const r = await api(`/api/admin/prefs/${key}`, { method: 'PUT', body: { value } });
      setInfo((i) => ({ ...i, prefs: r.prefs }));
    } catch {
      // A preference that didn't save is still applied for this visit.
    }
  }, [setInfo]);

  const toggleCollapsed = () => {
    setCollapsed((c) => {
      savePref('shell.collapsed', !c);
      return !c;
    });
  };
  const pickAuto = (s) => {
    setAuto(s);
    savePref('refresh.auto', s);
  };

  return (
    <div className={`es adm${collapsed ? ' is-collapsed' : ''}${menuOpen ? ' menu-open' : ''}`}>
      <ToastProvider>
        <RefreshProvider autoSeconds={auto}>
          <Sidebar info={info} setInfo={setInfo} pathname={pathname} onCollapse={toggleCollapsed} collapsed={collapsed} />
          <div className="menu-scrim" aria-hidden="true" onClick={() => setMenuOpen(false)} />
          <div className="amain">
            <EnvBar />
            <TopBar page={page} auto={auto} onAuto={pickAuto} onMenu={() => setMenuOpen(true)} />
            <UpdateBar />
            <main id="main" className="acontent" key={pathname}>
              <Outlet />
            </main>
          </div>
        </RefreshProvider>
      </ToastProvider>
    </div>
  );
}

function Count({ c }) {
  if (!c || !c.n) return null;
  const cls = { accent: '', quiet: ' quiet', warn: ' warn', err: ' err' }[c.tone] ?? '';
  return <span className={`ncount${cls}`} aria-label={`${c.n} ${c.label}`}>{c.n > 99 ? '99+' : c.n}</span>;
}

function Sidebar({ info, setInfo, pathname, onCollapse, collapsed }) {
  const { query } = useScope();
  const refresh = useRefresh();
  // Counts follow the page refresh (and every route change), never a clock of their own.
  useEffect(() => {
    if (info.role === 'moderator') return undefined;
    let live = true;
    api('/api/admin/shell/counts').then((r) => {
      if (live) setInfo((i) => ({ ...i, counts: r.counts }));
    }).catch(() => {});
    return () => {
      live = false;
    };
  }, [pathname, refresh?.lastRun, setInfo, info.role]);

  const signOut = async () => {
    try {
      await api('/api/admin/sign-out', { method: 'POST', body: {} });
    } catch {
      // the cookie is cleared either way when the session is gone
    }
    window.location.assign('/');
  };
  let group = null;
  return (
    <aside className="aside" aria-label="Admin navigation">
      <div className="brandrow">
        {/* A full page load to the public site, so the admin stylesheet doesn't stay loaded there. */}
        <a className="brand" href="/" aria-label="Everstats home"><BrandMark /><span>Everstats</span></a>
        <span className="admtag">Admin</span>
        <button type="button" className="btn ghost sm icon collapse only-desk" aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} aria-pressed={collapsed} onClick={onCollapse}>
          <Icon name="sidebar" />
        </button>
      </div>
      <nav className="anav">
        {NAV.filter((item) => info.role !== 'moderator' || item.moderator).map((item) => {
          const head = item.group !== group ? item.group : null;
          group = item.group;
          const on = navActive(item, pathname);
          const to = info.role === 'moderator' && item.moderator === 'reports' ? '/admin/inbox/reports' : item.to;
          const keep = item.id === 'dashboard' || ['tiers', 'discovery', 'data', 'retention', 'release'].includes(item.id);
          return (
            <span key={item.id} className="contents">
              {head && <span className="grp">{head}</span>}
              <Link className="nitem" to={`${to}${keep && query ? `?${query}` : ''}`} aria-current={on ? 'page' : undefined} title={item.label}>
                <Icon name={item.icon} />
                <span className="lbl">{item.label}</span>
                <Count c={item.count ? info.counts?.[item.count] : null} />
              </Link>
            </span>
          );
        })}
      </nav>
      <div className="foot-id">
        <div className="who"><Icon name={info.role === 'moderator' ? 'user' : 'passkey'} /><span><b>{info.role === 'moderator' ? 'Moderator' : 'Admin'}</b>{info.role === 'moderator' ? 'Your player account' : 'Passkey session · 2 h'}</span></div>
        {info.role !== 'moderator' && <button type="button" className="nitem signout" onClick={signOut} title="Sign out of admin">
          <Icon name="sign-out" /><span className="lbl">Sign out of admin</span>
        </button>}
      </div>
    </aside>
  );
}

function TopBar({ page, auto, onAuto, onMenu }) {
  const { role } = useShellInfo();
  const rs = useRefreshState();
  const refresh = useRefresh();
  const stamp = rs.busy ? 'Refreshing…'
    : rs.stale ? `Stale · last good ${ago(rs.oldest, rs.now).replace(' ago', '')} ago`
      : rs.newest ? `Updated ${ago(rs.newest, rs.now)}${rs.failed ? ` · ${rs.failed} panel${rs.failed === 1 ? '' : 's'} failed` : ''}` : '';
  const warn = rs.stale || rs.failed > 0;
  return (
    <header className="atop">
      <button type="button" className="btn ghost icon menu-btn" aria-label="Open admin menu" onClick={onMenu}><Icon name="menu" /></button>
      <span className="phone-title">{page?.title ?? 'Admin'}</span>
      <VersionSwitcher global={page?.scope !== 'version'} />
      {role !== 'moderator' && <SettingsSearch />}
      <span className="spacer" />
      <div className={`rfx${rs.busy ? ' is-busy' : ''}`} role="status" aria-live="polite">
        <span className={`stamp${warn ? ' stale' : ''}`}>{stamp}</span>
        <button type="button" className="btn sm" aria-label="Refresh page" onClick={() => refresh.refreshAll()} disabled={rs.panels === 0}>
          <Icon name="refresh" /><span className="only-desk">Refresh</span>
        </button>
        <MenuButton label={autoLabel(auto)} ariaLabel="Auto-refresh" options={AUTO_CHOICES.map((s) => ({ id: s, label: autoLabel(s) }))} value={auto} onPick={onAuto} />
      </div>
      {rs.busy && <div className="progress" aria-hidden="true"><i /></div>}
    </header>
  );
}

/** A small themed menu in place of a native <select>. */
function MenuButton({ label, ariaLabel, options, value, onPick }) {
  const [open, setOpen] = useState(false);
  const box = useRef(null);
  useOutside(box, open, () => setOpen(false));
  return (
    <div className="anchor auto-menu" ref={box}>
      <button type="button" className="btn sm ghost" aria-haspopup="listbox" aria-expanded={open} aria-label={`${ariaLabel}: ${label}`} onClick={() => setOpen((o) => !o)}>
        {label}<Icon name="chevron-down" size="sm" />
      </button>
      {open && (
        <div className="vmenu panel auto-list" role="listbox" aria-label={ariaLabel}>
          {options.map((o) => (
            <button key={o.id} type="button" role="option" className="vopt" aria-selected={o.id === value} onClick={() => {
              onPick(o.id);
              setOpen(false);
            }}>
              <span>{o.label}</span>{o.id === value ? <Icon name="check" size="sm" /> : <span />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function useOutside(ref, open, close) {
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (!ref.current?.contains(e.target)) close();
    };
    const onKey = (e) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [ref, open, close]);
}

function VersionSwitcher({ global }) {
  const info = useShellInfo();
  const { version, region, versionName, setScope } = useScope();
  const [open, setOpen] = useState(false);
  const box = useRef(null);
  const close = useCallback(() => setOpen(false), []);
  useOutside(box, open, close);
  if (global) {
    return (
      <div className="anchor vs">
        <span className="vswitch is-global" title="This section covers every game version and region"><Icon name="globe" /><span>All versions</span></span>
      </div>
    );
  }
  return (
    <div className="anchor vs" ref={box}>
      <button type="button" className="vswitch" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <Icon name="globe" /><span>{versionName}</span><span className="reg">{region.toUpperCase()}</span><Icon name="chevron-down" />
      </button>
      {open && (
        <div className="vmenu panel">
          <span className="grp" id="vs-versions">Game version</span>
          <div role="listbox" aria-labelledby="vs-versions">
            {info.versions.map((v) => (
              <button key={v.id} type="button" role="option" aria-selected={v.id === version} className={`vopt${v.enabled ? '' : ' is-off'}`}
                onClick={() => {
                  setScope({ version: v.id });
                  setOpen(false);
                }}>
                <span>{v.name}</span>
                {v.enabled ? <span className="chip ok"><Icon name="check-circle" />On</span> : <span className="chip off"><Icon name="no-coverage" />Off · admin only</span>}
              </button>
            ))}
          </div>
          <span className="grp" id="vs-regions">Region</span>
          <div className="regs" role="listbox" aria-labelledby="vs-regions">
            {info.regions.map((g) => (
              <button key={g.id} type="button" role="option" aria-selected={g.id === region} className={`btn sm${g.id === region ? ' gold' : ' ghost'}`}
                title={g.enabled ? g.name : `${g.name}: off · admin only`}
                onClick={() => {
                  setScope({ region: g.id });
                  setOpen(false);
                }}>
                {g.id.toUpperCase()}{g.enabled ? '' : ' · off'}
              </button>
            ))}
          </div>
          <span className="muted xsmall vs-note">This changes what you’re looking at. Whether a version runs is a switch on Features.</span>
        </div>
      )}
    </div>
  );
}

const KIND_ICON = { setting: 'settings', feature: 'features', audit: 'audit' };

/** Settings search (`/` focuses it): settings, feature switches and the audit log, each with its path and value. */
function SettingsSearch() {
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [results, setResults] = useState(null);
  const [sel, setSel] = useState(0);
  const [open, setOpen] = useState(false);
  const input = useRef(null);
  const box = useRef(null);
  const close = useCallback(() => setOpen(false), []);
  useOutside(box, open, close);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target;
      if (t instanceof HTMLElement && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName))) return;
      e.preventDefault();
      input.current?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  useEffect(() => {
    const text = q.trim();
    if (text.length < 2) {
      setResults(null);
      return undefined;
    }
    let live = true;
    const t = setTimeout(() => {
      api(`/api/admin/search?q=${encodeURIComponent(text)}`).then((r) => {
        if (!live) return;
        setResults(r.results);
        setSel(0);
        setOpen(true);
      }).catch(() => {
        if (live) setResults([]);
      });
    }, 180);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [q]);

  const go = (r) => {
    if (!r) return;
    setOpen(false);
    setQ('');
    input.current?.blur();
    navigate(r.href);
  };
  const onKey = (e) => {
    if (!results?.length) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSel((s) => (s + 1) % results.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSel((s) => (s - 1 + results.length) % results.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      go(results[sel]);
    }
  };
  return (
    <div className="asearch" ref={box}>
      <label className="search">
        <Icon name="search" />
        <input ref={input} value={q} placeholder="Search settings and switches…" aria-label="Search settings, switches and the audit log"
          role="combobox" aria-expanded={open && Boolean(results)} aria-controls="admin-search-results" aria-autocomplete="list"
          aria-activedescendant={open && results?.length ? `sres-${sel}` : undefined}
          data-edit-guard="off" onChange={(e) => setQ(e.target.value)} onFocus={() => results && setOpen(true)} onKeyDown={onKey} />
        <span className="kbd" aria-hidden="true">/</span>
      </label>
      {open && results && (
        <div className="sresults panel" id="admin-search-results" role="listbox" aria-label="Search results">
          {results.length === 0 ? <span className="muted small pad-8">Nothing matches “{q.trim()}”.</span> : results.map((r, i) => (
            <a key={`${r.kind}:${r.id}`} id={`sres-${i}`} href={r.href} role="option" aria-selected={i === sel} className="sres"
              onMouseEnter={() => setSel(i)}
              onClick={(e) => {
                e.preventDefault();
                go(r);
              }}>
              <Icon name={KIND_ICON[r.kind] ?? 'info'} />
              <span className="t">{r.label}</span>
              <span className="v">{r.value}</span>
              <span className="p">{r.path}</span>
            </a>
          ))}
          <span className="ft">↑ ↓ to move · Enter to open · searches settings, feature switches and the audit log</span>
        </div>
      )}
    </div>
  );
}
