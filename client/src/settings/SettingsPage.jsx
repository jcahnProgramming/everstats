import { useCallback, useEffect, useRef, useState } from 'react';
import { activeSection } from './sectionSpy.js';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import { authError } from '../authMessages.js';
import { Icon } from '../chrome/Icon.jsx';
import { Button, Field, Modal, Toggle } from '../components/Controls.jsx';
import { EmptyState } from '../components/EmptyState.jsx';
import { TierBadge } from '../components/Tier.jsx';
import { useToasts } from '../components/Toasts.jsx';
import { formatDate } from '../format.js';
import { providerNames, startProvider } from '../pages/SignInPages.jsx';
import { passkeyRegister, passkeySignIn, passkeysSupported, wasCancelled } from '../passkeyClient.js';
import { useSession } from '../session.jsx';
import { UsernameClaim } from '../components/UsernameClaim.jsx';
import { BadgesSection, YourGuildsSection } from './BadgesSection.jsx';

/**
 * Account settings (design/v1/pages/account-settings): a side nav and five sections. Behaviour is the scaffold's,
 * unchanged (same endpoints, same rules); this is the design pass.
 *
 * Different from the mockup, on purpose:
 *   - Merge runs the other way round. The mockup keeps THIS account and absorbs the other; Everstats (CLAUDE.md
 *     "Merge") merges the signed-in account INTO the one you prove, and deletes this one. The layout follows the app.
 *   - No "Reduce motion" toggle: the site already follows the system's reduce-motion setting, and an account setting
 *     for it would be new account data this pass doesn't add.
 *   - Added for 0.4.0: the beta membership line, the characters list with "Hide this character", and Delete account.
 */
export const THEMES = [
  { id: 'forever', name: 'Forever', blurb: 'Twilight blue, gold and white' },
  { id: 'alliance', name: 'Alliance', blurb: 'Royal blue, gold trim, parchment' },
  { id: 'horde', name: 'Horde', blurb: 'Crimson and charcoal, bronze and ember' },
];

const SECTIONS = [
  ['profile', 'Profile'],
  ['appearance', 'Appearance'],
  ['signin', 'Sign-in methods'],
  ['twofa', 'Two-factor'],
  ['badges', 'Badges'],
  ['characters', 'Characters'],
  ['guilds', 'Your guilds'],
  ['merge', 'Merge accounts'],
  ['delete', 'Delete account'],
];

export function SettingsPage() {
  const session = useSession();
  const [params, setParams] = useSearchParams();
  const [account, setAccount] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const notice = params.get('linked') ? { kind: 'ok', text: 'Linked. You can now sign in with it too.' } : params.get('error') ? { kind: 'err', text: authError(params.get('error')) } : null;

  const load = useCallback(async () => {
    try {
      setAccount((await api('/api/account')).account);
    } catch (err) {
      if (err.status !== 401) setLoadError(err.message);
    }
  }, []);
  useEffect(() => {
    if (session.signedIn) load();
  }, [session.signedIn, load]);
  // 0.7.0: guilds this account can manage (Guild Master or officer). The section and its nav link exist only then.
  const [guilds, setGuilds] = useState([]);
  useEffect(() => {
    if (session.signedIn) api('/api/account/guilds').then((r) => setGuilds(r.guilds), () => setGuilds([]));
  }, [session.signedIn]);
  const sections = SECTIONS.filter(([id]) => id !== 'guilds' || guilds.length > 0);

  if (session.loading) return <div className="wrap page-pad"><h1 className="h1">Settings</h1></div>;

  if (!session.signedIn) {
    return (
      <div className="wrap page-pad stack gap-28 narrow-wrap">
        <div className="stack gap-10">
          <h1 className="h1">Settings</h1>
          <p className="t2">Settings belong to an account, and accounts are optional: everything public works without one.</p>
        </div>
        <ThemeSection current="forever" disabled />
        <Link to="/sign-in" className="btn gold self-start">Sign in</Link>
      </div>
    );
  }

  return (
    <div className="wrap page-pad split settings">
      <aside className="settings-side">
        <div className="stack gap-2 settings-head">
          <h1 className="h1 settings-title">Settings</h1>
          {account && (
            <span className="muted xsmall settings-since">
              {account.usernameClaimed ? <span className="mono">@{account.username}</span> : 'No username yet'} · since {formatDate(account.createdAt)}
            </span>
          )}
          {account?.beta.member && <span className="tag gold self-start settings-beta">Beta member since {formatDate(account.beta.since)}</span>}
        </div>
        <SectionNav sections={sections} />
      </aside>
      <div className="main stack gap-28">
        {notice && (
          <div className={`note ${notice.kind} small`} role="status">
            <Icon name={notice.kind === 'ok' ? 'check' : 'error'} />
            <span className="grow">{notice.text}</span>
            <button type="button" className="btn ghost sm" onClick={() => setParams({})}>Dismiss</button>
          </div>
        )}
        {loadError && <div className="note err small" role="alert"><Icon name="error" /><span>{loadError}</span></div>}
        {account && <ProfileSection account={account} onChange={setAccount} />}
        <ThemeSection current={session.theme} onChange={session.setTheme} />
        {account && (
          <>
            <MethodsSection account={account} providers={session.providers} onChange={setAccount} />
            <TwoFactorSection account={account} onChange={setAccount} />
            <BadgesSection />
            <CharactersSection account={account} providers={session.providers} onChange={setAccount} />
            {guilds.length > 0 && <YourGuildsSection guilds={guilds} />}
            <MergeSection account={account} providers={session.providers} />
            <DeleteSection account={account} />
          </>
        )}
      </div>
    </div>
  );
}

/**
 * The section links. Desktop: a sidebar that stays in view under the sticky top bar (and scrolls itself if it's ever
 * taller than the window). Phone: a horizontal strip pinned under the top bar. The link for the section in view is
 * marked (aria-current).
 *
 * 0.5.0 (three bugs found on 0.4.2): the old IntersectionObserver watched a narrow band and started before the account
 * (and so the Profile section) had loaded, so the first load highlighted Appearance; the last section could never reach
 * the band, so Delete account never lit up; and on phones the strip's scrollIntoView fought the page scroll. Now
 * (activeSection in sectionSpy.js, tested on its own): on every scroll, resize and layout change the current section
 * is the last one whose top has passed a line just under the sticky bars; at the very bottom of the page, the last
 * section. A clicked link stays current until the person scrolls themselves. The phone strip scrolls ITSELF
 * (horizontally) to keep the current link in view, never the page.
 */
function SectionNav({ sections = SECTIONS }) {
  const [current, setCurrent] = useState(sections[0][0]);
  const list = useRef(sections);
  list.current = sections;
  const bar = useRef(null);
  const clicked = useRef(null); // { id, settledY } while a clicked link should stay current
  useEffect(() => {
    let frame = 0;
    let settle = 0;
    const measure = () => {
      frame = 0;
      const pin = clicked.current;
      if (pin) {
        if (pin.settledY === null) {
          // The jump (or smooth scroll) to the clicked section is still moving: wait for it to stop.
          clearTimeout(settle);
          settle = setTimeout(() => {
            if (clicked.current === pin) pin.settledY = window.scrollY;
          }, 150);
          return;
        }
        if (Math.abs(window.scrollY - pin.settledY) < 8) return;
        clicked.current = null; // the person scrolled away themselves
      }
      const tops = list.current.map(([id]) => {
        const el = document.getElementById(id);
        return el ? { id, top: el.getBoundingClientRect().top } : null;
      }).filter(Boolean);
      const header = document.querySelector('.topbar')?.getBoundingClientRect().bottom ?? 0;
      const strip = bar.current && getComputedStyle(bar.current).position === 'sticky' && getComputedStyle(bar.current).flexDirection === 'row'
        ? bar.current.getBoundingClientRect().bottom : 0;
      const id = activeSection({
        tops,
        line: Math.max(header, strip) + Math.min(160, window.innerHeight * 0.25),
        atBottom: window.scrollY > 0 && window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2,
      });
      if (id) setCurrent(id);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    schedule();
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    // Sections appear (and grow) as the account loads: measure again whenever the page changes size.
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(schedule) : null;
    ro?.observe(document.body);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(settle);
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      ro?.disconnect();
    };
  }, []);
  // The phone strip keeps the current link in view by scrolling itself sideways (never the page).
  useEffect(() => {
    const strip = bar.current;
    const link = strip?.querySelector('[aria-current="true"]');
    if (!strip || !link || strip.scrollWidth <= strip.clientWidth) return;
    const left = link.offsetLeft - (strip.clientWidth - link.offsetWidth) / 2;
    strip.scrollTo({ left: Math.max(0, left), behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }, [current]);
  return (
    <nav aria-label="Settings sections" className="settings-nav" ref={bar}>
      {sections.map(([id, label]) => (
        <a
          key={id}
          className="btn ghost left settings-link"
          href={`#${id}`}
          aria-current={current === id ? 'true' : undefined}
          onClick={(e) => {
            if (e.detail > 0) e.currentTarget.blur(); // a mouse click; a keyboard user keeps focus here
            clicked.current = { id, settledY: null };
            setCurrent(id);
            requestAnimationFrame(() => window.dispatchEvent(new Event('scroll')));
          }}
        >{label}</a>
      ))}
      <span className="hr settings-hr" />
      <SignOut />
    </nav>
  );
}

/**
 * Profile: the username (claim it, or rename with the allowance left), the display name, and the public profile link.
 * A placeholder name is shown only here, to its owner, and clearly as a placeholder.
 */
function ProfileSection({ account, onChange }) {
  const session = useSession();
  const toast = useToasts();
  const [renaming, setRenaming] = useState(false);
  const [display, setDisplay] = useState(account.displayNameSet ? account.displayName : '');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState(null);
  const saveDisplay = async (value) => {
    setBusy(true);
    setProblem(null);
    try {
      const r = await api('/api/account/display-name', { method: 'PUT', body: { displayName: value } });
      onChange(r.account);
      setDisplay(r.account.displayNameSet ? r.account.displayName : '');
      await session.refresh();
      toast.ok('Display name saved', `People see ${r.account.displayName}.`);
    } catch (err) {
      setProblem(err.message);
    }
    setBusy(false);
  };
  return (
    <section id="profile" className="panel pad-24 stack gap-18" aria-labelledby="profile-h">
      <div className="row gap-10">
        <h2 className="h2 h2-panel grow" id="profile-h">Profile</h2>
        {account.usernameClaimed && <Link className="btn sm" to={`/u/${account.username}`}><Icon name="user" size="sm" />View your public profile</Link>}
      </div>
      <div className="stack gap-10">
        <span className="eyebrow">Username</span>
        {account.usernameClaimed ? (
          <>
            <div className="row gap-10">
              <span className="h3 mono">@{account.username}</span>
              <span className="muted small">everstats.app/u/{account.username}</span>
              <span className="spacer" />
              {!renaming && <button type="button" className="btn sm ghost" onClick={() => setRenaming(true)}>Rename</button>}
            </div>
            {renaming && (
              <div className="raised pad-16 stack gap-10">
                <UsernameClaim renaming renamesLeft={account.renamesLeft} onDone={(a) => { onChange(a); setRenaming(false); }} />
                <button type="button" className="btn ghost sm self-start" onClick={() => setRenaming(false)}>Cancel</button>
              </div>
            )}
            {!renaming && <span className="muted xsmall">{account.renamesLeft > 0 ? `${account.renamesLeft} rename${account.renamesLeft === 1 ? '' : 's'} left.` : 'Renames aren’t available on your account right now.'}</span>}
          </>
        ) : (
          <>
            <div className="note small"><Icon name="info" /><span>Claim your username. Until you do, your account has the placeholder <span className="mono">@{account.username}</span>, which nobody else sees, and you have no public profile.</span></div>
            <UsernameClaim onDone={onChange} />
          </>
        )}
      </div>
      <span className="hr" />
      <form className="stack gap-8" onSubmit={(e) => { e.preventDefault(); saveDisplay(display); }}>
        <span className="eyebrow">Display name</span>
        {account.usernameClaimed ? (
          <>
            <div className="row gap-8 align-end wrap-field-row">
              <Field label="What people see on your profile" className="grow" value={display} maxLength={32} placeholder={account.username} onChange={(e) => setDisplay(e.target.value)} error={problem} />
              <Button type="submit" className="gold" loading={busy} disabled={!display.trim()}>Save</Button>
              {account.displayNameSet && <button type="button" className="btn ghost" disabled={busy} onClick={() => saveDisplay(null)}>Use my username</button>}
            </div>
            <span className="muted xsmall">1–32 characters, change it any time; others can have the same one. Your username is what identifies you.</span>
          </>
        ) : <span className="muted small">Your display name starts as your username, once you've claimed one.</span>}
      </form>
      <span className="hr" />
      <ProfileDetails account={account} onChange={onChange} />
      <span className="hr" />
      <p className="muted xsmall">Your profile shows your display name, @username, when you joined, beta membership, your main ruleset and faction, your characters that aren't hidden and their guilds, plus anything you fill in here. Empty fields simply don't show. Profiles can't be hidden yet: hide individual characters below instead.</p>
    </section>
  );
}

/**
 * Bio, social handles and "Show my pinned stats". Handles only: Everstats builds each link itself, so there's no box
 * for a URL anywhere. Saved together; a field that isn't valid is named in the error and nothing is saved.
 */
function ProfileDetails({ account, onChange }) {
  const toast = useToasts();
  const prof = account.profile;
  const [bio, setBio] = useState(prof.bio ?? '');
  const [links, setLinks] = useState(prof.links);
  const [showPins, setShowPins] = useState(prof.showPins);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState(null);
  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    setProblem(null);
    try {
      const r = await api('/api/account/profile', { method: 'PUT', body: { bio, links, showPins } });
      onChange(r.account);
      setLinks(r.account.profile.links);
      setBio(r.account.profile.bio ?? '');
      toast.ok('Profile saved', account.usernameClaimed ? `It's live at /u/${account.username}.` : 'It goes live when you claim a username.');
    } catch (err) {
      setProblem(err.message);
    }
    setBusy(false);
  };
  const bioId = 'profile-bio';
  return (
    <form className="stack gap-14" onSubmit={save}>
      <div className="field">
        <label htmlFor={bioId}>Bio</label>
        <textarea id={bioId} className="inp profile-bio-input" rows={4} maxLength={280} value={bio} onChange={(e) => setBio(e.target.value)} placeholder="A few words about you and your characters." />
        <span className="help">{[...bio].length} / 280 · plain text: line breaks are kept, links aren't made clickable.</span>
      </div>
      <fieldset className="plain-fieldset stack gap-8">
        <legend className="eyebrow">Elsewhere</legend>
        <span className="muted xsmall">Type just your handle; Everstats builds the link. Links show as yours and aren't verified.</span>
        <div className="grid-auto col-md gap-10">
          {prof.platforms.map((pl) => (
            <Field
              key={pl.id}
              label={pl.label}
              inputClassName="mono"
              value={links[pl.id] ?? ''}
              placeholder={pl.id === 'discord' ? 'invite code' : pl.id === 'bluesky' ? 'name.bsky.social' : 'handle'}
              autoComplete="off"
              spellCheck="false"
              autoCapitalize="none"
              maxLength={253}
              help={pl.help}
              onChange={(e) => setLinks((l) => ({ ...l, [pl.id]: e.target.value }))}
            />
          ))}
        </div>
      </fieldset>
      <Toggle checked={showPins} onChange={setShowPins}>Show my pinned stats on my profile</Toggle>
      {problem && <div className="note err small" role="alert"><Icon name="error" /><span>{problem}</span></div>}
      <div className="row gap-10">
        <Button type="submit" className="gold" loading={busy}>Save profile</Button>
        {account.usernameClaimed && <Link className="btn ghost" to={`/u/${account.username}`}>View my profile</Link>}
      </div>
    </form>
  );
}

/** Theme cards (role=radio), each previewing its own tokens. Applies at once and saves to the account. */
function ThemeSection({ current, onChange, disabled = false }) {
  const toast = useToasts();
  const choose = async (id) => {
    if (id === current) return;
    const before = current;
    onChange(id);
    try {
      await api('/api/account/theme', { method: 'PUT', body: { theme: id } });
      toast.ok('Theme saved', `${THEMES.find((t) => t.id === id).name} follows your account to every device.`);
    } catch (err) {
      onChange(before);
      toast.err("Couldn't save the theme", err.message);
    }
  };
  return (
    <section id="appearance" className="panel pad-24 stack gap-18" aria-labelledby="theme-h">
      <div className="row gap-10">
        <h2 className="h2 h2-panel" id="theme-h">Theme</h2>
        <span className="tag gold">Signed-in perk</span>
        <span className="muted small">{disabled ? 'Visitors always see Forever. Sign in to choose; it follows your account to every device.' : 'Visitors always see Forever. Your choice applies at once.'}</span>
      </div>
      <div className="grid-auto col-sm gap-14" role="radiogroup" aria-label="Theme">
        {THEMES.map((t) => (
          <button key={t.id} type="button" role="radio" className="theme-card" data-theme={t.id} aria-checked={current === t.id} disabled={disabled} onClick={() => choose(t.id)}>
            <span className="stack gap-10 theme-preview">
              <span className="row gap-6">{['S', 'A', 'B', 'C', 'D'].map((l) => <TierBadge key={l} letter={l} size="sm" />)}</span>
              <span className="row gap-6"><span className="swatch-bar accent" /><span className="swatch-bar line" /></span>
            </span>
            <span className="row theme-name">
              <span className="stack gap-2"><span className="h3 theme-title">{t.name}</span><span className="muted xsmall">{t.blurb}</span></span>
              <span className="muted xsmall act">Active</span>
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}

function MethodsSection({ account, providers, onChange }) {
  const toast = useToasts();
  const [confirm, setConfirm] = useState(null); // { kind: 'unlink' | 'passkey', id, label }
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState('');
  const [adding, setAdding] = useState(false);
  const [problem, setProblem] = useState(null);
  const linked = new Set(account.identities.map((i) => i.provider));
  const ways = account.identities.length + account.passkeys.length;
  const lastWay = ways <= 1;

  const link = async (id) => {
    try {
      await startProvider(id, 'link', '/settings');
    } catch (err) {
      setProblem(err.message);
    }
  };
  const add = async () => {
    setAdding(true);
    setProblem(null);
    try {
      const r = await passkeyRegister('/api/account/passkeys/options', '/api/account/passkeys/verify', { verifyBody: { name } });
      onChange(r.account);
      setName('');
      toast.ok('Passkey added', 'You can sign in with it now. Passkey sign-ins skip the two-factor code.');
    } catch (err) {
      if (!wasCancelled(err)) setProblem(err.message);
    }
    setAdding(false);
  };
  const doConfirm = async () => {
    setBusy(true);
    try {
      const path = confirm.kind === 'unlink' ? `/api/account/identities/${confirm.id}` : `/api/account/passkeys/${confirm.id}`;
      onChange((await api(path, { method: 'DELETE' })).account);
      toast.ok(confirm.kind === 'unlink' ? `${confirm.label} unlinked` : 'Passkey removed');
      setConfirm(null);
    } catch (err) {
      toast.err(confirm.kind === 'unlink' ? "Couldn't unlink" : "Couldn't remove the passkey", err.message);
      setConfirm(null);
    }
    setBusy(false);
  };
  const lastTitle = lastWay ? "It's your only way to sign in. Add another first." : undefined;

  return (
    <section id="signin" className="panel pad-24 stack gap-16" aria-labelledby="methods-h">
      <div className="stack gap-4">
        <h2 className="h2 h2-panel" id="methods-h">Sign-in methods</h2>
        <span className="muted small">Sign in with any of these. New ones can only be added here, while you're signed in.</span>
      </div>
      <div className="listbox">
        {account.identities.map((i) => (
          <div key={i.id} className="listrow">
            <span className="provider-ico"><Icon name="provider-account" size="md" /></span>
            <span className="stack grow-col"><b>{i.label}</b><span className="muted xsmall">{i.displayName ? `Linked as ${i.displayName}` : 'Linked'} · since {formatDate(i.linkedAt)}</span></span>
            <span className="tag ok">Linked</span>
            <button type="button" className="btn sm danger" disabled={lastWay} title={lastTitle} onClick={() => setConfirm({ kind: 'unlink', id: i.id, label: i.label })}>Unlink</button>
          </div>
        ))}
        {providers.filter((p) => !linked.has(p.id)).map((p) => (
          <div key={p.id} className="listrow">
            <span className="provider-ico"><Icon name="provider-account" size="md" /></span>
            <span className="stack grow-col"><b>{p.label}</b><span className="muted xsmall">Not linked</span></span>
            {p.configured
              ? <button type="button" className="btn sm" onClick={() => link(p.id)}>Link {p.label}</button>
              : <span className="tag">Not configured</span>}
          </div>
        ))}
        <div className="listrow passkey-row">
          <div className="row gap-14">
            <span className="provider-ico"><Icon name="passkey" size="md" /></span>
            <span className="stack grow-col"><b>Passkeys</b><span className="muted xsmall">Your device's fingerprint, face or PIN. A passkey sign-in skips the two-factor step.</span></span>
          </div>
          {account.passkeys.length > 0 && (
            <div className="raised">
              {account.passkeys.map((p, i) => (
                <div key={p.id}>
                  {i > 0 && <div className="hr" />}
                  <div className="passkey-item">
                    <span><b>{p.name}</b></span>
                    <span className="muted xsmall">{p.lastUsedAt ? `Last used ${formatDate(p.lastUsedAt)}` : `Added ${formatDate(p.createdAt)} · never used`}</span>
                    <button type="button" className="btn sm ghost" disabled={lastWay} title={lastTitle} onClick={() => setConfirm({ kind: 'passkey', id: p.id, label: p.name })}>Remove</button>
                  </div>
                </div>
              ))}
            </div>
          )}
          {passkeysSupported() ? (
            <div className="row gap-8 align-end">
              <Field label="Name (optional)" className="grow" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder="e.g. My phone" />
              <Button className="gold" loading={adding} onClick={add}><Icon name="plus" size="sm" />Add a passkey</Button>
            </div>
          ) : (
            <span className="muted xsmall">This browser doesn't support passkeys.</span>
          )}
        </div>
      </div>
      {problem && <div className="note err small" role="alert"><Icon name="error" /><span>{problem}</span></div>}
      {confirm && (
        <Modal
          title={confirm.kind === 'unlink' ? `Unlink ${confirm.label}?` : `Remove “${confirm.label}”?`}
          busy={busy}
          onClose={() => setConfirm(null)}
          actions={<><button type="button" className="btn ghost" onClick={() => setConfirm(null)} disabled={busy}>Cancel</button><Button className="danger" loading={busy} onClick={doConfirm}>{confirm.kind === 'unlink' ? 'Unlink' : 'Remove'}</Button></>}
        >
          <p className="t2 small">
            {confirm.kind === 'unlink'
              ? `You won't be able to sign in with ${confirm.label} any more. Signing in with it later would make a new, separate account; link it again from here instead.`
              : 'This passkey stops working for Everstats. Remove it from your device too if you no longer want it.'}
          </p>
        </Modal>
      )}
    </section>
  );
}

function TwoFactorSection({ account, onChange }) {
  const toast = useToasts();
  const [setup, setSetup] = useState(null);
  const [codes, setCodes] = useState(null);
  const [code, setCode] = useState('');
  const [problem, setProblem] = useState(null);
  const [busy, setBusy] = useState(null);
  const [confirmOff, setConfirmOff] = useState(false);
  const on = account.twoFactor.state === 'on';

  const act = (name, fn) => async (e) => {
    e?.preventDefault();
    setProblem(null);
    setBusy(name);
    try {
      await fn();
    } catch (err) {
      setProblem(err.message);
    }
    setBusy(null);
  };
  const begin = act('begin', async () => setSetup((await api('/api/account/2fa/setup', { method: 'POST', body: {} })).setup));
  const enable = act('enable', async () => {
    const r = await api('/api/account/2fa/enable', { method: 'POST', body: { code } });
    setCodes(r.recoveryCodes);
    setSetup(null);
    setCode('');
    onChange(r.account);
  });
  const disable = act('disable', async () => {
    try {
      const r = await api('/api/account/2fa/disable', { method: 'POST', body: { code } });
      setCode('');
      onChange(r.account);
      toast.ok('Two-factor is off');
    } finally {
      setConfirmOff(false);
    }
  });
  const regenerate = act('regenerate', async () => {
    const r = await api('/api/account/2fa/recovery-codes', { method: 'POST', body: { code } });
    setCodes(r.recoveryCodes);
    setCode('');
    onChange(r.account);
  });

  return (
    <section id="twofa" className="panel pad-24 stack gap-18" aria-labelledby="tfa-h">
      <div className="row gap-10">
        <h2 className="h2 h2-panel" id="tfa-h">Two-factor authentication</h2>
        <span className={`tag ${on ? 'ok' : ''}`}>{on ? `On since ${formatDate(account.twoFactor.enabledAt)}` : 'Optional · off'}</span>
        <span className="muted small">An authenticator-app code after a Battle.net or Discord sign-in. Passkey sign-ins skip it.</span>
      </div>

      {codes && <RecoveryCodes codes={codes} onDone={() => { setCodes(null); toast.ok('Two-factor is on', 'Your recovery codes are put away. Each works once.'); }} />}

      {!on && !setup && !codes && <div><Button loading={busy === 'begin'} onClick={begin}>Turn on two-factor</Button></div>}

      {!on && setup && (
        <form className="raised stack gap-14 pad-20" onSubmit={enable}>
          <span className="eyebrow">Step 1 · Scan</span>
          <div className="row gap-16">
            <img className="qr qr-img" src={setup.qr} alt="QR code for your authenticator app" />
            <span className="stack gap-6 grow-120">
              <span className="t2 small">Can't scan? Enter this key:</span>
              <span className="mono small code-key">{setup.secret.match(/.{1,4}/g).join(' ')}</span>
              <button type="button" className="btn sm self-start" onClick={() => navigator.clipboard?.writeText(setup.secret).then(() => toast.ok('Key copied'))}><Icon name="copy" size="sm" />Copy key</button>
            </span>
          </div>
          <div className="field">
            <label htmlFor="tfa-code">Enter the 6-digit code</label>
            <div className="row gap-8 nowrap">
              <input id="tfa-code" className="inp otp grow" value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" autoComplete="one-time-code" placeholder="000 000" maxLength={7} />
              <Button type="submit" className="gold" loading={busy === 'enable'}>Verify</Button>
            </div>
          </div>
          <span className="muted xsmall">Step 2 shows your ten recovery codes, once.</span>
          <button type="button" className="btn ghost sm self-start" onClick={() => { setSetup(null); setCode(''); }}>Cancel</button>
        </form>
      )}

      {on && !codes && (
        <form className="stack gap-14" onSubmit={(e) => e.preventDefault()}>
          <span className="t2 small">{account.twoFactor.recoveryCodesLeft} of 10 recovery codes left.</span>
          <div className="row gap-8 align-end">
            <Field label="Current code (or a recovery code)" inputClassName="otp" value={code} onChange={(e) => setCode(e.target.value)} autoComplete="one-time-code" maxLength={11} />
            <Button loading={busy === 'regenerate'} onClick={regenerate}>Regenerate codes</Button>
            <button type="button" className="btn danger" onClick={() => setConfirmOff(true)}>Turn off</button>
          </div>
        </form>
      )}
      {problem && <div className="note err small" role="alert"><Icon name="error" /><span>{problem}</span></div>}
      {confirmOff && (
        <Modal
          title="Turn off two-factor?"
          busy={busy === 'disable'}
          onClose={() => setConfirmOff(false)}
          actions={<><button type="button" className="btn ghost" onClick={() => setConfirmOff(false)} disabled={busy === 'disable'}>Cancel</button><Button className="danger" loading={busy === 'disable'} onClick={disable}>Turn off</Button></>}
        >
          <p className="t2 small">Battle.net and Discord sign-ins stop asking for a code. Your secret and remaining recovery codes are deleted; turning it on again starts fresh. It uses the code you entered above.</p>
        </Modal>
      )}
    </section>
  );
}

/**
 * The ten recovery codes, shown exactly once (on turning 2FA on, or regenerating). Download / Copy / Print, and
 * "I've stored these" before Finish. Nothing keeps them after this: only an HMAC of each is stored.
 */
function RecoveryCodes({ codes, onDone }) {
  const toast = useToasts();
  const [stored, setStored] = useState(false);
  const text = `Everstats recovery codes. Each works once.\n\n${codes.join('\n')}\n`;
  const download = () => {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'everstats-recovery-codes.txt';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const print = () => {
    document.body.classList.add('printing-codes');
    window.print();
    document.body.classList.remove('printing-codes');
  };
  return (
    <div className="sheet stack gap-14 pad-20 recovery" role="status">
      <span className="eyebrow">Recovery codes — shown once</span>
      <div className="note warn small"><Icon name="warning" /><span>Save these now. Each works once if you lose your authenticator. We can't show them again — only generate a new set.</span></div>
      <ol className="codes print-codes">
        {codes.map((c, i) => <li key={c}><span className="muted code-n">{String(i + 1).padStart(2, '0')}</span> {c}</li>)}
      </ol>
      <div className="row gap-8">
        <button type="button" className="btn sm" onClick={download}><Icon name="download" size="sm" />Download .txt</button>
        <button type="button" className="btn sm" onClick={() => navigator.clipboard?.writeText(text).then(() => toast.ok('Codes copied'))}><Icon name="copy" size="sm" />Copy all</button>
        <button type="button" className="btn sm" onClick={print}><Icon name="print" size="sm" />Print</button>
      </div>
      <label className="check"><input type="checkbox" checked={stored} onChange={(e) => setStored(e.target.checked)} />I've stored these somewhere safe</label>
      <button type="button" className="btn gold self-start" disabled={!stored} onClick={onDone}>Finish</button>
    </div>
  );
}

const CHAR_STATE = {
  tracked: 'Tracked',
  fetching: 'Fetching now',
  under_10: 'Under level 10: characters appear at 10',
  not_visible: 'Not visible at Blizzard yet (not logged out since 10, or Blizzard is catching up)',
  missing: 'Blizzard hasn’t returned it lately',
};

/** The account's characters (from its Battle.net character list), each with "Hide this character". */
function CharactersSection({ account, providers, onChange }) {
  const toast = useToasts();
  const [busy, setBusy] = useState(null);
  const readers = providers.filter((p) => account.characterProviders.includes(p.id));
  const linkedReader = readers.find((p) => account.identities.some((i) => i.provider === p.id));
  const hide = async (c, hidden) => {
    setBusy(c.id);
    try {
      onChange((await api(`/api/account/characters/${c.id}/hidden`, { method: 'PUT', body: { hidden } })).account);
      toast.ok(hidden ? `${c.name} ${c.surname} is hidden` : `${c.name} ${c.surname} is public again`, hidden ? 'No public page, on no leaderboard. You still see it.' : 'Back on the boards.');
    } catch (err) {
      toast.err("Couldn't change that", err.message);
    }
    setBusy(null);
  };
  return (
    <section id="characters" className="panel pad-24 stack gap-16" aria-labelledby="chars-h">
      <div className="row gap-10">
        <h2 className="h2 h2-panel grow" id="chars-h">Your characters</h2>
        {linkedReader && <button type="button" className="btn sm" onClick={() => startProvider(linkedReader.id, 'characters', '/').catch((err) => toast.err("Couldn't start", err.message))}><Icon name="refresh" size="sm" />Refresh my characters</button>}
      </div>
      {!linkedReader && (
        <EmptyState kind="nodata" compact title={`Link ${readers[0]?.label ?? 'Battle.net'} to bring your characters in`}>
          <span>Linking it (under Sign-in methods above) reads the Forever characters on that account, once, and adds them here.</span>
        </EmptyState>
      )}
      {account.characters.length > 0 && (
        <div className="listbox">
          {account.characters.map((c) => (
            <div key={c.id} className="listrow">
              <span className="stack grow-col">
                <b>{c.state === 'tracked' ? <Link to={`/c/${encodeURIComponent(c.slug)}`}>{c.name} <span className="surname">{c.surname}</span></Link> : <>{c.name} <span className="surname">{c.surname}</span></>}</b>
                <span className="muted xsmall">{[c.level ? `Level ${c.level}` : null, c.class, c.ruleset?.name].filter(Boolean).join(' · ')} · {c.state === 'missing' ? `Blizzard hasn’t returned this character since ${formatDate(c.since)}` : CHAR_STATE[c.state]}</span>
              </span>
              <Toggle checked={c.hidden} disabled={busy === c.id} onChange={(v) => hide(c, v)}>Hide this character</Toggle>
            </div>
          ))}
        </div>
      )}
      {linkedReader && account.characters.length === 0 && <span className="t2 small">No characters yet. Your dashboard says what Battle.net answered last time.</span>}
      <span className="muted xsmall">A hidden character has no public page and is on no leaderboard; you still see it. <Link to="/privacy">More about privacy</Link>.</span>
    </section>
  );
}

/** Delete the account (2FA code too, when it's on). Characters stay tracked as public data; hidden ones stay hidden. */
function DeleteSection({ account }) {
  const session = useSession();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState(null);
  const twoFactor = account.twoFactor.state === 'on';
  const go = async () => {
    setBusy(true);
    setProblem(null);
    try {
      await api('/api/account', { method: 'DELETE', body: { confirm: 'delete', code: twoFactor ? code : undefined } });
      await session.refresh();
      navigate('/');
    } catch (err) {
      setProblem(err.message);
      setBusy(false);
    }
  };
  return (
    <section id="delete" className="panel pad-24 stack gap-14" aria-labelledby="delete-h">
      <h2 className="h2 h2-panel" id="delete-h">Delete account</h2>
      <p className="t2 small">Removes this account, its sign-in links, passkeys, two-factor settings, pins and its claim on your characters. Your characters stay on Everstats as the public data they are; any you've hidden stay hidden. It can't be undone.</p>
      <button type="button" className="btn danger self-start" onClick={() => setOpen(true)}>Delete this account</button>
      {open && (
        <Modal
          title="Delete this account?"
          busy={busy}
          onClose={() => setOpen(false)}
          actions={<><button type="button" className="btn ghost" onClick={() => setOpen(false)} disabled={busy}>Cancel</button><Button className="danger" loading={busy} onClick={go} disabled={twoFactor && code.trim().length < 6}>Delete for good</Button></>}
        >
          <p className="t2 small">{account.usernameClaimed ? `@${account.username}` : 'This account'} is deleted and you're signed out.{account.usernameClaimed ? ' Its username is held for 30 days, then anyone can claim it.' : ''}{account.beta.member ? ' Its beta membership goes with it: a new account made later is a beta member only if the beta is still open then.' : ''}</p>
          {twoFactor && <Field label="Two-factor code (or a recovery code)" value={code} onChange={(e) => setCode(e.target.value)} autoComplete="one-time-code" maxLength={20} />}
          {problem && <div className="note err small" role="alert"><Icon name="error" /><span>{problem}</span></div>}
        </Modal>
      )}
    </section>
  );
}

/**
 * Merge: THIS account moves into the one you prove, and this one is deleted (CLAUDE.md "Merge"). The design's
 * "Keep this / absorb the other" is the wrong way round for Everstats, so the two boxes read "Moves · this account"
 * and "Keeps · the other account". The confirmation is the merge page itself (/settings/merge), shown after proof.
 */
function MergeSection({ account, providers }) {
  const navigate = useNavigate();
  const [problem, setProblem] = useState(null);
  const viaProvider = async (id) => {
    try {
      await startProvider(id, 'merge', '/settings/merge');
    } catch (err) {
      setProblem(err.message);
    }
  };
  const viaPasskey = async () => {
    try {
      const r = await passkeySignIn('/api/auth/passkey/options', '/api/auth/passkey/verify', { intent: 'merge' });
      navigate(r.next);
    } catch (err) {
      if (!wasCancelled(err)) setProblem(err.message);
    }
  };
  const configured = providers.filter((p) => p.configured);
  return (
    <section id="merge" className="panel pad-24 stack gap-16" aria-labelledby="merge-h">
      <div className="stack gap-4">
        <h2 className="h2 h2-panel" id="merge-h">Merge accounts</h2>
        <span className="muted small">Signed in with {providerNames(providers) || 'a provider'} that you hadn't linked, and got a second account? Move this one into the account you want to keep.</span>
      </div>
      <div className="grid-auto gap-16 merge-boxes">
        <div className="raised stack gap-4 pad-16">
          <span className="eyebrow">Moves · this account</span>
          <b>{account.identities.map((i) => i.label).join(' + ') || 'Passkeys only'}</b>
          <span className="muted xsmall">{account.identities.length} login(s) · {account.passkeys.length} passkey(s) · then deleted</span>
        </div>
        <div className="stack gap-8 pad-16 merge-target">
          <span className="eyebrow">Keeps · the other account</span>
          <span className="t2 small">Sign in to it here to prove it's yours.</span>
          <div className="row gap-8">
            {configured.map((p) => <button key={p.id} type="button" className="btn sm" onClick={() => viaProvider(p.id)}>{p.label}</button>)}
            {passkeysSupported() && <button type="button" className="btn sm" onClick={viaPasskey}><Icon name="passkey" size="sm" />Its passkey</button>}
          </div>
        </div>
      </div>
      <div className="note small"><Icon name="info" /><span>This account's logins, passkeys and characters move to the other account; its theme and 2FA settings are dropped and the other account keeps its own. Beta membership is kept if either account has it. You'll see exactly what happens and confirm before anything changes. It can't be undone.</span></div>
      {problem && <div className="note err small" role="alert"><Icon name="error" /><span>{problem}</span></div>}
    </section>
  );
}

function SignOut() {
  const session = useSession();
  const navigate = useNavigate();
  return (
    <button type="button" className="btn ghost left" onClick={async () => { await api('/api/auth/sign-out', { method: 'POST', body: {} }); await session.refresh(); navigate('/'); }}>
      <Icon name="arrow-left" size="sm" />Sign out
    </button>
  );
}
