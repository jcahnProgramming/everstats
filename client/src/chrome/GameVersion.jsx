import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { characterSlug, realmCharacter, realmSlugFromName } from '../../../server/stats/slug.js';
import { api } from '../api.js';
import { Field } from '../components/Controls.jsx';
import { VersionMenu } from '../components/VersionMenu.jsx';
import { rememberVersion, useNavigate, useScope } from '../scope.jsx';
import { Icon } from './Icon.jsx';

/**
 * The public side of game versions (0.11.1): the header's switcher, the realm list of a version with realms, and the
 * character look-up form that asks for what that version needs (WoW Forever: name + surname; a version with realms:
 * name + realm). Nothing here names a version: everything comes from the session's list (scope.jsx).
 */

/**
 * The header's game-version switcher: the admin's version menu (components/VersionMenu.jsx), with only the versions
 * that are switched on and no region row. Shown only when there is more than one version to choose from, so a site
 * with one version looks exactly as it always did.
 *
 * Picking a version is remembered in this browser. On a page that belongs to a version it also goes to the same kind
 * of page in the other one (leaderboards ↔ leaderboards, guilds ↔ guilds, tiers ↔ tiers; a character or guild has no
 * twin elsewhere, so those go to that version's leaderboards). Pages of no version (home, search, settings) stay put
 * and show the chosen version's side of themselves.
 */
export function GameVersionSwitcher({ block = false }) {
  const scope = useScope();
  const navigate = useNavigate();
  if (scope.versions.length < 2 || !scope.meta) return null;
  const pick = (id) => {
    rememberVersion(id);
    if (!scope.fromUrl) return;
    const rest = scope.rest;
    const target = rest.startsWith('/guilds') ? '/guilds' : rest.startsWith('/tiers/how') ? '/tiers/how' : rest.startsWith('/tiers') ? '/tiers' : '/leaderboards';
    navigate(target, { scope: id });
  };
  return (
    <VersionMenu
      wrapClass={`pub-vs${block ? ' block' : ''}`}
      idBase={block ? 'pvs-sheet' : 'pvs'}
      current={{ id: scope.version, name: scope.meta.name }}
      title={`Game version: ${scope.meta.name}`}
      label={`Game version: ${scope.meta.name}. Change game version`}
      versions={scope.versions.map((v) => ({ id: v.id, name: v.name }))}
      onPick={pick}
      optionState={(v) => (v.id === scope.version ? <Icon name="check" size="sm" /> : null)}
    />
  );
}

/** The player realms of a version with realms: [{ slug, name, type, typeName }] ([] while loading or on a realmless one). */
export function useRealms(version, on = true) {
  const [realms, setRealms] = useState({ version: null, list: [], loaded: false });
  useEffect(() => {
    if (!on || !version) return undefined;
    let live = true;
    api('/api/realms', { version }).then((r) => {
      if (live) setRealms({ version, list: r.realms ?? [], loaded: true });
    }, () => {
      if (live) setRealms({ version, list: [], loaded: true });
    });
    return () => {
      live = false;
    };
  }, [version, on]);
  return realms.version === version ? realms : { version, list: [], loaded: false };
}

const fold = (s) => String(s ?? '').normalize('NFKD').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

/** The realm a text names: by its slug or its name as Blizzard writes it, else the slug that text would make. */
export function resolveRealm(text, list) {
  const t = fold(text);
  if (!t) return null;
  const hit = list.find((r) => fold(r.name) === t || fold(r.slug) === t);
  if (hit) return { slug: hit.slug, name: hit.name, known: true };
  const slug = realmSlugFromName(text);
  // With a realm list, a realm that isn't on it isn't a player realm; without one (not loaded yet), take the text.
  return slug && list.length === 0 ? { slug, name: String(text).trim(), known: false } : null;
}

/**
 * A realm field with suggestions (a text box and a list: no native <select>, its popup ignores the theme).
 * value: { slug, name } | null. The list is Blizzard's player realms for that version; until it has been read, the
 * field takes the realm's name as typed.
 */
export function RealmPicker({ version, value, onChange, error = null, label = 'Realm' }) {
  const { list, loaded } = useRealms(version);
  const [text, setText] = useState(value?.name ?? '');
  const [open, setOpen] = useState(false);
  const box = useRef(null);
  const id = useId();
  useEffect(() => {
    setText(value?.name ?? '');
  }, [value?.slug]); // eslint-disable-line react-hooks/exhaustive-deps
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
  const matches = useMemo(() => {
    const t = fold(text);
    if (!t) return list.slice(0, 8);
    const starts = list.filter((r) => fold(r.name).startsWith(t));
    const has = list.filter((r) => !fold(r.name).startsWith(t) && fold(r.name).includes(t));
    return [...starts, ...has].slice(0, 8);
  }, [text, list]);
  const type = (v) => {
    setText(v);
    setOpen(true);
    onChange(resolveRealm(v, list));
  };
  const choose = (r) => {
    setText(r.name);
    setOpen(false);
    onChange({ slug: r.slug, name: r.name, known: true });
  };
  const help = error ?? (loaded && list.length === 0 ? 'The realm list hasn’t been read from Blizzard yet: type the realm’s name as the game shows it.' : null);
  return (
    <div className="field realm-pick" ref={box}>
      <label htmlFor={id}>{label}</label>
      <input
        id={id} className={`inp${error ? ' is-error' : ''}`} value={text} autoComplete="off" spellCheck="false" maxLength={60}
        role="combobox" aria-expanded={open && matches.length > 0} aria-controls={`${id}-list`} aria-autocomplete="list"
        aria-invalid={error ? 'true' : undefined} aria-describedby={help ? `${id}-note` : undefined}
        onChange={(e) => type(e.target.value)} onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') setOpen(false);
          if (e.key === 'ArrowDown' && open) {
            const first = box.current?.querySelector('.realm-list button');
            if (first) {
              e.preventDefault();
              first.focus();
            }
          }
        }}
      />
      {open && matches.length > 0 && (
        <div id={`${id}-list`} className="realm-list" role="listbox" aria-label="Realms"
          onKeyDown={(e) => {
            const items = [...(box.current?.querySelectorAll('.realm-list button') ?? [])];
            const i = items.indexOf(document.activeElement);
            if (e.key === 'ArrowDown' && i < items.length - 1) {
              e.preventDefault();
              items[i + 1].focus();
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              (i > 0 ? items[i - 1] : box.current?.querySelector('input'))?.focus();
            } else if (e.key === 'Escape') setOpen(false);
          }}>
          {matches.map((r) => (
            <button key={r.slug} type="button" role="option" aria-selected={r.slug === value?.slug} onClick={() => choose(r)}>
              <span className="ellipsis">{r.name}</span>
              {r.typeName && <span className="muted xsmall nowrap">{r.typeName}</span>}
            </button>
          ))}
        </div>
      )}
      {help && <span id={`${id}-note`} className={`help${error ? ' err' : ''}`} role={error ? 'alert' : undefined}>{help}</span>}
    </div>
  );
}

/**
 * The character look-up form for one version: the fields that version needs, and where its character page is.
 * WoW Forever (no realms): first name + surname → /c/name-surname. A version with realms: name + realm →
 * /{version}/{region}/c/{realm}/{name}. `children(fields, submitting)` lays the fields and the button out.
 */
export function useCharacterLookup(meta) {
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [surname, setSurname] = useState('');
  const [realm, setRealm] = useState(null);
  const [problem, setProblem] = useState(null);
  const realms = Boolean(meta?.realms);
  useEffect(() => {
    setProblem(null);
  }, [meta?.id]);
  const submit = (e) => {
    e?.preventDefault?.();
    if (realms) {
      const r = realm ? realmCharacter(realm.slug, name) : { ok: false, problem: name.trim() ? 'Choose the character’s realm.' : 'Enter the character’s name.' };
      if (!r.ok) return setProblem(r.problem);
      setProblem(null);
      return navigate(`/c/${r.realmSlug}/${encodeURIComponent(r.slug)}`, { state: { via: 'search' }, scope: meta.id });
    }
    const r = characterSlug(name, surname);
    if (!r.ok) return setProblem(r.problem);
    setProblem(null);
    return navigate(`/c/${encodeURIComponent(r.slug)}`, { state: { via: 'search' }, scope: meta?.id });
  };
  const second = /surname|realm/i.test(problem ?? '');
  const fields = realms ? (
    <>
      <Field label="Character name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" spellCheck="false" maxLength={12} error={second ? null : problem} />
      <RealmPicker version={meta.id} value={realm} onChange={setRealm} error={second ? problem : null} />
    </>
  ) : (
    <>
      <Field label="First name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" spellCheck="false" maxLength={24} error={second ? null : problem} />
      <Field label="Surname" value={surname} onChange={(e) => setSurname(e.target.value)} autoComplete="off" spellCheck="false" maxLength={24} error={second ? problem : null} />
    </>
  );
  return { fields, submit, realms };
}

/**
 * "Thrall Area 52" / "thrall-area-52" on a version with realms → { ok, to } for the header's one-box search. The first
 * word is the name, the rest the realm (as its name or its slug); it must be a realm Blizzard lists.
 */
export function parseRealmSearch(text, list) {
  const value = String(text ?? '').trim();
  const m = /^(\S+?)(?:\s+|-)(.+)$/u.exec(value);
  if (!m) return { ok: false, problem: 'Add the realm too: “Name Realm”.' };
  const realm = resolveRealm(m[2], list);
  if (!realm) return { ok: false, problem: 'That realm isn’t one Blizzard lists.' };
  const r = realmCharacter(realm.slug, m[1]);
  return r.ok ? { ok: true, to: `/c/${r.realmSlug}/${encodeURIComponent(r.slug)}` } : { ok: false, problem: r.problem };
}

/** "on Area 52" for a row of a version with realms; nothing for a realmless one. Names come from the realm list when it is loaded. */
export const realmLabel = (slug, list = []) => (slug ? list.find((r) => r.slug === slug)?.name ?? slug : null);
