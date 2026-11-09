import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { api } from '../api.js';
import { Icon } from '../chrome/Icon.jsx';
import { useSession } from '../session.jsx';
import { Button, Field, Modal } from './Controls.jsx';
import { useToasts } from './Toasts.jsx';

/**
 * Claiming or renaming a username, with live availability while typing (GET /api/account/username/check). The check
 * waits until typing pauses (CHECK_DELAY_MS) and skips anything the format rules already refuse, so it costs few of
 * the per-account checks the server allows; a rejection says why, in plain words, never which list entry matched.
 *
 *   <UsernameClaim renaming={bool} renamesLeft={n} onDone={(account) => …} />
 */
const CHECK_DELAY_MS = 450;
const SHAPE = /^[a-z](?:[a-z0-9]|[-_](?=[a-z0-9]))*$/;

/** The rules the browser can say without asking: the same words the server uses (server/accounts/names.js). */
function localProblem(v) {
  if (!v) return null;
  if (v.length < 3) return 'At least 3 characters.';
  if (v.length > 20) return 'Up to 20 characters.';
  if (!/^[a-z0-9_-]+$/.test(v)) return 'Use only lower-case letters a–z, digits, hyphens and underscores.';
  if (!/^[a-z]/.test(v)) return 'Start with a letter.';
  if (!SHAPE.test(v)) return 'Hyphens and underscores can’t be doubled up or come last.';
  return null;
}

export function UsernameClaim({ renaming = false, renamesLeft = 0, onDone, autoFocus = false }) {
  const toast = useToasts();
  const session = useSession();
  const [value, setValue] = useState('');
  const [check, setCheck] = useState(null); // null | { state: 'checking' } | { ok, message }
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState(null);
  const seq = useRef(0);
  const name = value.trim().toLowerCase();
  const local = localProblem(name);

  useEffect(() => {
    setProblem(null);
    if (!name || local) {
      setCheck(null);
      return undefined;
    }
    const mine = ++seq.current;
    setCheck({ state: 'checking' });
    const t = setTimeout(async () => {
      try {
        const r = await api(`/api/account/username/check?name=${encodeURIComponent(name)}`);
        if (mine === seq.current) setCheck(r.ok ? { ok: true, message: `@${r.name} is free.` } : { ok: false, message: r.message });
      } catch (err) {
        if (mine === seq.current) setCheck({ ok: false, message: err.message });
      }
    }, CHECK_DELAY_MS);
    return () => {
      clearTimeout(t);
    };
  }, [name, local]);

  const submit = async (e) => {
    e.preventDefault();
    if (local || !name) return;
    setBusy(true);
    try {
      const { account } = await api('/api/account/username', { method: 'PUT', body: { username: name } });
      await session.refresh();
      toast.ok(renaming ? 'Username changed' : 'Username claimed', `You're @${account.username}. Your profile is at everstats.app/u/${account.username}.`);
      setValue('');
      onDone?.(account);
    } catch (err) {
      setProblem(err.message);
    }
    setBusy(false);
  };

  if (renaming && renamesLeft < 1) {
    return <div className="note small"><Icon name="info" /><span>Renames aren’t available on your account right now.</span></div>;
  }
  const note = problem ?? local ?? (check?.state === 'checking' ? 'Checking…' : check?.message ?? '3–20 characters: a–z, 0–9, - and _, starting with a letter.');
  const bad = Boolean(problem || local || (check && check.ok === false));
  return (
    <form className="stack gap-10" onSubmit={submit} noValidate>
      <div className="row gap-8 align-end wrap-field-row">
        <Field
          label={renaming ? 'New username' : 'Username'}
          className="flex-fill"
          inputClassName="mono"
          value={value}
          onChange={(e) => setValue(e.target.value.toLowerCase())}
          autoComplete="off"
          spellCheck="false"
          autoCapitalize="none"
          maxLength={20}
          placeholder="e.g. galewhisper"
          // eslint-disable-next-line jsx-a11y/no-autofocus
          autoFocus={autoFocus}
          error={bad ? note : null}
          help={bad ? null : note}
        />
        <Button type="submit" className="gold" loading={busy} disabled={!name || bad || check?.ok !== true}>{renaming ? 'Rename' : 'Claim'}</Button>
      </div>
      <span className="muted xsmall" aria-live="polite">
        {renaming
          ? `Renaming uses one of your renames (${renamesLeft} left). Your old name is held for you for 30 days, and its profile address points to the new one.`
          : 'Claiming your first username is free. Display names can be changed any time; usernames are first come, first served.'}
      </span>
    </form>
  );
}

/**
 * The prompt after signing in, on every sign-in until a username is claimed (session.user.promptUsername). "Not now"
 * keeps the placeholder for this sign-in; Settings always offers it too.
 */
export function UsernamePrompt() {
  const session = useSession();
  const { pathname } = useLocation();
  const [open, setOpen] = useState(true);
  // Never over the admin area: the admin isn't a player, even when the same browser also has a player session.
  const inAdmin = pathname === '/admin' || pathname.startsWith('/admin/');
  if (inAdmin || !session.signedIn || !session.user?.promptUsername || !open) return null;
  const later = async () => {
    setOpen(false);
    await api('/api/account/username/prompt-dismiss', { method: 'POST', body: {} }).catch(() => {});
  };
  return (
    <Modal title="Claim your username" onClose={later} actions={<button type="button" className="btn ghost" onClick={later}>Not now</button>}>
      <p className="t2 small">
        Your username is how people find you: <span className="mono">everstats.app/u/yourname</span>. Until you choose one,
        your account has a placeholder (<span className="mono">@{session.user.username}</span>) and no public profile.
      </p>
      <UsernameClaim autoFocus onDone={() => setOpen(false)} />
      <p className="muted xsmall">You can do this later in <Link to="/settings#profile" onClick={later}>Settings</Link>.</p>
    </Modal>
  );
}
