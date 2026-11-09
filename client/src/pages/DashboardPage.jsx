import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import { authError } from '../authMessages.js';
import { Icon } from '../chrome/Icon.jsx';
import { Button, Modal } from '../components/Controls.jsx';
import { EmptyState, Fresh } from '../components/EmptyState.jsx';
import { Sortable } from '../components/Sortable.jsx';
import { ServiceUnavailable } from '../components/States.jsx';
import { useToasts } from '../components/Toasts.jsx';
import { TierBadge, TierBrief } from '../components/Tier.jsx';
import { formatDate, formatNumber, timeAgo } from '../format.js';
import { useSession } from '../session.jsx';
import { startProvider } from './SignInPages.jsx';

/**
 * The signed-in home: the featured character, the pinned statistics, and every character the account owns, each in
 * its honest state (GET /api/dashboard). There's no design mockup for it: it's built from the design's own parts
 * (sheet, stat cards, list rows, the empty states).
 *
 * Characters come in through a Battle.net sign-in: its token reads the account's character list once. "Refresh my
 * characters" re-authorizes Battle.net to read it again.
 */
const STATE_TEXT = {
  tracked: null,
  fetching: () => 'Fetching from Blizzard now…',
  under_10: (c) => `${c.name} ${c.surname} is level ${c.level ?? '?'}: characters appear at level 10.`,
  not_visible: () => 'Hasn’t logged out since reaching 10, or Blizzard hasn’t caught up yet (it can take 20–40 minutes).',
  missing: (c) => `Blizzard hasn’t returned this character since ${formatDate(c.since)}. Still checking; its old numbers aren’t shown.`,
};

export function DashboardPage() {
  const session = useSession();
  const [params, setParams] = useSearchParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [picking, setPicking] = useState(false);
  const toast = useToasts();

  const load = useCallback(async () => {
    try {
      setData(await api('/api/dashboard'));
      setError(null);
    } catch (err) {
      setError(err.message);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);
  // While a character is being fetched, look again every few seconds.
  useEffect(() => {
    if (!data?.characters.some((c) => c.state === 'fetching')) return undefined;
    const id = setTimeout(load, 4000);
    return () => {
      clearTimeout(id);
    };
  }, [data, load]);

  const refreshed = params.get('characters') === 'refreshed';
  const problem = params.get('error');
  const providers = session.providers.filter((p) => data?.characterProviders.includes(p.id));
  const linkedReader = providers.find((p) => data?.linked.includes(p.id));

  const feature = async (id) => {
    try {
      await api('/api/account/featured', { method: 'PUT', body: { characterId: id } });
      await load();
    } catch (err) {
      toast.err("Couldn't change the featured character", err.message);
    }
  };

  return (
    <div className="wrap page-pad stack gap-28">
      <div className="row gap-12">
        <h1 className="h1 flex-fill">{session.user?.claimed ? `Welcome back, ${session.user.displayName}` : 'Your characters'}</h1>
        {linkedReader && (
          <button type="button" className="btn sm" onClick={() => startProvider(linkedReader.id, 'characters', '/').catch((err) => toast.err("Couldn't start", err.message))}>
            <Icon name="refresh" size="sm" />Refresh my characters
          </button>
        )}
      </div>
      {refreshed && <Notice kind="ok" onDismiss={() => setParams({})}>Read your character list from Battle.net again. New characters are being fetched.</Notice>}
      {problem && <Notice kind="err" onDismiss={() => setParams({})}>{authError(problem)}</Notice>}
      {error && <ServiceUnavailable inline title="Couldn't load your dashboard" onRetry={load}>{error}</ServiceUnavailable>}
      {data && (
        <>
          <CheckState data={data} providers={providers} linkedReader={linkedReader} />
          {data.featured ? (
            <Featured data={data} onPick={() => setPicking(true)} onReordered={load} />
          ) : data.characters.length > 0 ? (
            <EmptyState kind="nodata" title="No tracked character to feature yet">
              <span>None of your characters has a public profile at Blizzard yet. Each one's state is below.</span>
            </EmptyState>
          ) : null}
          {data.characters.length > 0 && <CharacterList data={data} onFeature={feature} />}
          {picking && <PinPicker current={data.pinIds} onClose={() => setPicking(false)} onSaved={() => { setPicking(false); load(); }} />}
        </>
      )}
      <section className="panel pad-20 row gap-14" aria-label="Find a character">
        <Icon name="search" />
        <span className="t2 flex-fill">Look anyone up with the search at the top of every page (press <span className="kbd">/</span>), or browse <Link to="/leaderboards">the leaderboards</Link>.</span>
      </section>
    </div>
  );
}

function Notice({ kind, children, onDismiss }) {
  return (
    <div className={`note ${kind} small`} role="status">
      <Icon name={kind === 'ok' ? 'check' : 'error'} />
      <span className="flex-fill">{children}</span>
      <button type="button" className="btn ghost sm" onClick={onDismiss}>Dismiss</button>
    </div>
  );
}

/** What happened the last time Battle.net listed this account's characters: honest about "none" vs "couldn't". */
function CheckState({ data, providers, linkedReader }) {
  if (!linkedReader) {
    const p = providers[0];
    return (
      <EmptyState kind="nodata" title={`Link ${p?.label ?? 'Battle.net'} to bring your characters in`}>
        <span>Your characters come from your {p?.label ?? 'Battle.net'} account's character list. You signed in another way, so Everstats can't see it yet. Link {p?.label ?? 'Battle.net'} in <Link to="/settings#signin">Settings</Link>, and every Forever character on it is added at once.</span>
      </EmptyState>
    );
  }
  const c = data.lastCheck;
  if (!c) {
    return (
      <EmptyState kind="nodata" title="Your character list hasn't been read yet">
        <span>Use “Refresh my characters” to read it from {linkedReader.label}.</span>
      </EmptyState>
    );
  }
  if (c.outcome === 'error') {
    return (
      <EmptyState kind="couldnt" title="We couldn't check your characters right now">
        <span>{linkedReader.label} didn't answer when we asked for your character list ({timeAgo(c.at)}). That's not the same as having none: try “Refresh my characters” in a minute.</span>
      </EmptyState>
    );
  }
  if (c.outcome === 'none') {
    return (
      <EmptyState kind="nodata" title="No Forever characters on this Battle.net account">
        <span>{linkedReader.label} says this account has no WoW Forever characters (checked {timeAgo(c.at)}). Made one since? Use “Refresh my characters”.</span>
      </EmptyState>
    );
  }
  return <span className="muted xsmall">Character list read from {linkedReader.label} {timeAgo(c.at)}: {formatNumber(c.characters)} character{c.characters === 1 ? '' : 's'}.</span>;
}

function Featured({ data, onPick, onReordered }) {
  const f = data.featured;
  const toast = useToasts();
  // 0.8.1: the pins reorder by drag (components/Sortable.jsx); the order is saved at once (PUT /api/account/pins), with Undo.
  const reorder = async (ids) => {
    try {
      await api('/api/account/pins', { method: 'PUT', body: { statisticIds: ids } });
      onReordered();
    } catch (err) {
      toast.err("Couldn't save the new order", err.message);
      throw err;
    }
  };
  return (
    <section className="sheet sheet-pad stack gap-20" aria-labelledby="featured-h">
      <div className="row gap-16">
        <div className="stack gap-6 flex-fill">
          <span className="eyebrow">{data.featuredChosen ? 'Featured character' : 'Featured: your highest level'}</span>
          <h2 className="h-display char-name" id="featured-h"><Link to={`/c/${encodeURIComponent(f.slug)}`}>{f.name} <span className="surname">{f.surname}</span></Link></h2>
          <span className="t2">{[f.level ? `Level ${f.level}` : null, f.race, f.class, f.ruleset?.name].filter(Boolean).join(' · ')}</span>
          <Fresh at={f.fetchedAt} prefix="Data as of " />
        </div>
        <TierBrief brief={f.tier} slug={f.slug} />
        <button type="button" className="btn sm ghost" onClick={onPick}><Icon name="plus" size="sm" />Choose pins</button>
      </div>
      {f.hidden && <EmptyState kind="hidden" compact title="Hidden, so it isn't ranked"><span>Show it again in <Link to="/settings#characters">Settings</Link> to see its ranks.</span></EmptyState>}
      {data.pins.length > 0 && (
        <Sortable items={data.pins} labelOf={(p) => p.name ?? 'Statistic no longer available'} className="grid-auto col-sm gap-14" itemClassName="pin-item"
          ariaLabel="Pinned statistics, in order" onReorder={reorder}
          renderItem={(p, { grip }) => (
            <>
              <span className="pin-grip">{grip}</span>
              <Link className="panel statcard" draggable={false} to={`/leaderboards/${f.ruleset.id}/${p.id}`}>
              {/* 0.9.0: the label wraps (two lines, a step smaller when long) in a box that leaves room for the grip,
                  so the grip can never sit on it; rank and movement each have their own line, movement at the foot. */}
              <span className={`eyebrow pin-label${(p.name ?? '').length > 22 ? ' is-long' : ''}`} title={p.name ?? undefined}>{p.name ?? 'Statistic no longer available'}</span>
              <span className="big">{p.text ? <span className="small muted">{p.text} · </span> : null}{formatNumber(p.value)}</span>
              <span className="small pin-rank">
                {p.rank !== null ? <span className="t2"><b className="strong-text">#{formatNumber(p.rank)}</b> of {formatNumber(p.withAny)} with any</span> : <span className="muted">Not ranked</span>}
              </span>
              <span className={`small pin-move ${p.move > 0 ? 'up' : p.move < 0 ? 'down' : 'muted'}`} title={p.move === null ? 'Movement shows once there is a week of rank history' : `Since ${formatDate(p.since)}`}>
                {p.move === null ? '— vs a week ago' : p.move > 0 ? `▲ ${p.move} vs a week ago` : p.move < 0 ? `▼ ${-p.move} vs a week ago` : '± 0 vs a week ago'}
              </span>
            </Link>
            </>
          )} />
      )}
      {data.pins.length === 0 && <EmptyState kind="nodata" compact title="No pinned statistics"><span>Pin statistics from any character page, or with “Choose pins”.</span></EmptyState>}
      <span className="muted xsmall">{data.pinsAreDefault ? 'These are the default pins. ' : ''}Rank movement compares with a week ago; it shows “—” until a week of history exists.</span>
    </section>
  );
}

function CharacterList({ data, onFeature }) {
  return (
    <section className="panel clip" aria-labelledby="chars-h">
      <div className="row board-head"><h2 className="h3" id="chars-h">All your characters</h2><span className="muted xsmall">{data.characters.length}</span></div>
      <div className="listbox flush">
        {data.characters.map((c) => (
          <div key={c.id} className="listrow">
            {c.state === 'tracked' && !c.hidden && <TierBadge letter={c.tier ?? null} size="sm" />}
            <span className="stack grow-col">
              <b>{c.state === 'tracked' ? <Link to={`/c/${encodeURIComponent(c.slug)}`}>{c.name} <span className="surname">{c.surname}</span></Link> : <>{c.name} <span className="surname">{c.surname}</span></>}</b>
              <span className="muted xsmall">{STATE_TEXT[c.state]?.(c) ?? [c.level ? `Level ${c.level}` : null, c.race, c.class, c.ruleset?.name].filter(Boolean).join(' · ')}</span>
            </span>
            {c.hidden && <span className="tag">Hidden</span>}
            {c.state === 'tracked' && data.featured?.id !== c.id && <button type="button" className="btn sm ghost" onClick={() => onFeature(c.id)}>Feature</button>}
            {c.state === 'tracked' && data.featured?.id === c.id && <span className="tag gold">Featured</span>}
            {c.state !== 'tracked' && <span className="tag">{{ fetching: 'Fetching', under_10: 'Under 10', missing: 'Not returned' }[c.state] ?? 'Not visible yet'}</span>}
          </div>
        ))}
      </div>
    </section>
  );
}

function PinPicker({ current, onClose, onSaved }) {
  const toast = useToasts();
  const [catalog, setCatalog] = useState(null);
  const [chosen, setChosen] = useState(() => new Set(current));
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api('/api/statistics').then((r) => setCatalog(r.categories), () => setCatalog([]));
  }, []);
  const save = async () => {
    setBusy(true);
    try {
      await api('/api/account/pins', { method: 'PUT', body: { statisticIds: [...chosen] } });
      toast.ok('Pins saved');
      onSaved();
    } catch (err) {
      toast.err("Couldn't save your pins", err.message);
      setBusy(false);
    }
  };
  return (
    <Modal title="Pinned statistics" onClose={onClose} busy={busy} actions={<><button type="button" className="btn ghost" onClick={onClose} disabled={busy}>Cancel</button><Button className="gold" loading={busy} onClick={save}>Save pins</Button></>}>
      <p className="t2 small">Up to 12. Each shows your featured character's value and rank.</p>
      <div className="stack gap-14 pin-picker">
        {catalog === null && <span className="muted small">Loading…</span>}
        {catalog?.map((cat) => (
          <fieldset key={cat.key} className="stack gap-4 plain-fieldset">
            <legend className="eyebrow">{cat.label}</legend>
            {cat.statistics.map((s) => (
              <label key={s.id} className="check">
                <input type="checkbox" checked={chosen.has(s.id)} disabled={!chosen.has(s.id) && chosen.size >= 12} onChange={(e) => setChosen((c) => {
                  const n = new Set(c);
                  if (e.target.checked) n.add(s.id);
                  else n.delete(s.id);
                  return n;
                })} />
                {s.name}
              </label>
            ))}
          </fieldset>
        ))}
      </div>
    </Modal>
  );
}
