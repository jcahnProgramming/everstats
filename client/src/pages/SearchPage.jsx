import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Link, useScope } from '../scope.jsx';
import { parseGuildAddress } from '../../../server/stats/slug.js';
import { api } from '../api.js';
import { Icon } from '../chrome/Icon.jsx';
import { useCharacterLookup } from '../chrome/GameVersion.jsx';
import { EmptyState } from '../components/EmptyState.jsx';
import { ServiceUnavailable } from '../components/States.jsx';
import { TierBadge } from '../components/Tier.jsx';
import { formatNumber } from '../format.js';
import { parseCharacterSearch } from '../search.js';

/**
 * /search?q= (0.5.0): what the top-bar search finds for text that isn't a character's address. Characters and guilds
 * Everstats already knows, labelled apart. Nothing here asks Blizzard; the look-up links and the form at the bottom do
 * (a character look-up, a guild look-up), the same way typing an address would.
 *
 * 0.11.1: across every game version that is switched on (GET /api/search/all). Each result says which version it is,
 * and its realm on a version with realms. A character Everstats doesn't know yet is looked up with the form: name and
 * surname on WoW Forever, name and realm on a version with realms (the version the header shows).
 */
export function SearchPage() {
  const [params] = useSearchParams();
  const scope = useScope();
  const q = (params.get('q') ?? '').trim().slice(0, 60);
  const [res, setRes] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => {
    let live = true;
    setRes(null);
    setError(null);
    if (q.length < 2) return undefined;
    api(`/api/search/all?q=${encodeURIComponent(q)}&count=1`).then((r) => { if (live) setRes(r.results ?? []); }, (err) => { if (live) setError(err.message); });
    return () => {
      live = false;
    };
  }, [q]);
  const several = scope.versions.length > 1;
  const characters = (res ?? []).flatMap((r) => r.characters.map((c) => ({ ...c, scope: r.scope })));
  const guilds = (res ?? []).flatMap((r) => r.guilds.map((g) => ({ ...g, scope: r.scope })));
  const primary = scope.versions.find((v) => v.primary) ?? null;
  const asCharacter = parseCharacterSearch(q);
  const asGuild = q.includes('/') ? null : parseGuildAddress(q.replace(/\s+/g, '-'));
  const line = (row, extra) => [several ? row.scope.short : null, row.realm, ...extra, row.scope.onePool ? null : row.ruleset].filter(Boolean).join(' · ');
  return (
    <div className="wrap page-pad stack gap-24 narrow-wrap">
      <h1 className="h1">Search</h1>
      <p className="t2">Results for “{q}” among the characters and guilds Everstats tracks{several ? `, on ${scope.versions.map((v) => v.name).join(' and ')}` : ''}.</p>
      {error && <ServiceUnavailable inline title="Search isn't answering">{error}</ServiceUnavailable>}
      {q.length < 2 && <EmptyState kind="nodata" title="Type at least two letters" />}
      {res && (
        <>
          <section className="panel clip" aria-labelledby="sc-h">
            <div className="row board-head"><h2 className="h3" id="sc-h">Characters</h2><span className="muted xsmall">{characters.length}</span></div>
            <div className="listbox flush">
              {characters.length === 0 ? <div className="listrow"><span className="t2 small">No tracked character matches.</span></div> : characters.map((c) => (
                <Link key={`${c.scope.version}-${c.slug}`} className="listrow linkrow" scope={c.scope.version} to={`/c/${encodeURIComponent(c.slug)}`}>
                  <span className="tag search-kind">Character</span>
                  <TierBadge letter={c.tier ?? null} size="sm" />
                  <span className="stack grow-col"><b>{c.name} <span className="surname">{c.surname}</span></b><span className="muted xsmall">{line(c, [c.level ? `Level ${c.level}` : null, c.class])}</span></span>
                </Link>
              ))}
            </div>
          </section>
          <section className="panel clip" aria-labelledby="sg-h">
            <div className="row board-head"><h2 className="h3" id="sg-h">Guilds</h2><span className="muted xsmall">{guilds.length}</span></div>
            <div className="listbox flush">
              {guilds.length === 0 ? <div className="listrow"><span className="t2 small">No guild Everstats knows matches.</span></div> : guilds.map((g) => (
                <Link key={`${g.scope.version}-${g.slug}`} className="listrow linkrow" scope={g.scope.version} to={`/g/${encodeURIComponent(g.slug)}`}>
                  <span className="tag gold search-kind">Guild</span>
                  <span className="stack grow-col"><b>{g.name}</b><span className="muted xsmall">{line(g, [g.faction, `${formatNumber(g.tracked)} tracked`])}</span></span>
                </Link>
              ))}
            </div>
          </section>
          <p className="muted small">
            Not here? Everstats only lists what it has fetched.
            {asCharacter.ok && primary && <> <Link scope={primary.id} to={`/c/${encodeURIComponent(asCharacter.slug)}`}>Look up the {several ? `${primary.name} ` : ''}character “{q}”</Link>.</>}
            {asGuild && primary && <> <Link scope={primary.id} to={`/g/${encodeURIComponent(asGuild)}`}>Look up the {several ? `${primary.name} ` : ''}guild “{q}”</Link>.</>}
          </p>
        </>
      )}
      {scope.meta?.realms && <LookupForm meta={scope.meta} />}
    </div>
  );
}

/** A version with realms can't look a bare name up: Blizzard addresses a character by realm and name. */
function LookupForm({ meta }) {
  const { fields, submit } = useCharacterLookup(meta);
  return (
    <section className="panel pad-20 stack gap-12" aria-labelledby="lookup-h">
      <h2 className="h3" id="lookup-h">Look up a {meta.name} character</h2>
      <p className="t2 small">A {meta.name} character is found by its name and its realm. Everstats asks Blizzard for it straight away.</p>
      <form className="stack gap-12" role="search" onSubmit={submit} noValidate>
        <div className="grid-auto col-120 gap-12">{fields}</div>
        <button type="submit" className="btn gold self-start"><Icon name="search" />Open character sheet</button>
      </form>
    </section>
  );
}
