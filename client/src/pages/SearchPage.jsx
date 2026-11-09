import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { parseGuildSlug } from '../../../server/stats/slug.js';
import { api } from '../api.js';
import { EmptyState } from '../components/EmptyState.jsx';
import { ServiceUnavailable } from '../components/States.jsx';
import { TierBadge } from '../components/Tier.jsx';
import { formatNumber } from '../format.js';
import { parseCharacterSearch } from '../search.js';

/**
 * /search?q= (0.5.0): what the top-bar search finds for text that isn't a character's name and surname. Characters
 * and guilds Everstats already knows, labelled apart. Nothing here asks Blizzard; the two links at the bottom do
 * (a character look-up, a guild look-up), the same way typing an address would.
 */
export function SearchPage() {
  const [params] = useSearchParams();
  const q = (params.get('q') ?? '').trim().slice(0, 60);
  const [res, setRes] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => {
    let live = true;
    setRes(null);
    setError(null);
    if (q.length < 2) return undefined;
    api(`/api/search?q=${encodeURIComponent(q)}&count=1`).then((r) => { if (live) setRes(r); }, (err) => { if (live) setError(err.message); });
    return () => {
      live = false;
    };
  }, [q]);
  const asCharacter = parseCharacterSearch(q);
  const asGuild = parseGuildSlug(q.replace(/\s+/g, '-'));
  return (
    <div className="wrap page-pad stack gap-24 narrow-wrap">
      <h1 className="h1">Search</h1>
      <p className="t2">Results for “{q}” among the characters and guilds Everstats tracks.</p>
      {error && <ServiceUnavailable inline title="Search isn't answering">{error}</ServiceUnavailable>}
      {q.length < 2 && <EmptyState kind="nodata" title="Type at least two letters" />}
      {res && (
        <>
          <section className="panel clip" aria-labelledby="sc-h">
            <div className="row board-head"><h2 className="h3" id="sc-h">Characters</h2><span className="muted xsmall">{res.characters.length}</span></div>
            <div className="listbox flush">
              {res.characters.length === 0 ? <div className="listrow"><span className="t2 small">No tracked character matches.</span></div> : res.characters.map((c) => (
                <Link key={c.slug} className="listrow linkrow" to={`/c/${encodeURIComponent(c.slug)}`}>
                  <span className="tag search-kind">Character</span>
                  <TierBadge letter={c.tier ?? null} size="sm" />
                  <span className="stack grow-col"><b>{c.name} <span className="surname">{c.surname}</span></b><span className="muted xsmall">{[c.level ? `Level ${c.level}` : null, c.class, c.ruleset].filter(Boolean).join(' · ')}</span></span>
                </Link>
              ))}
            </div>
          </section>
          <section className="panel clip" aria-labelledby="sg-h">
            <div className="row board-head"><h2 className="h3" id="sg-h">Guilds</h2><span className="muted xsmall">{res.guilds.length}</span></div>
            <div className="listbox flush">
              {res.guilds.length === 0 ? <div className="listrow"><span className="t2 small">No guild Everstats knows matches.</span></div> : res.guilds.map((g) => (
                <Link key={g.slug} className="listrow linkrow" to={`/g/${encodeURIComponent(g.slug)}`}>
                  <span className="tag gold search-kind">Guild</span>
                  <span className="stack grow-col"><b>{g.name}</b><span className="muted xsmall">{[g.ruleset, g.faction, `${formatNumber(g.tracked)} tracked`].filter(Boolean).join(' · ')}</span></span>
                </Link>
              ))}
            </div>
          </section>
          <p className="muted small">
            Not here? Everstats only lists what it has fetched.
            {asCharacter.ok && <> <Link to={`/c/${encodeURIComponent(asCharacter.slug)}`}>Look up the character “{q}”</Link>.</>}
            {asGuild && <> <Link to={`/g/${encodeURIComponent(asGuild)}`}>Look up the guild “{q}”</Link>.</>}
          </p>
        </>
      )}
    </div>
  );
}
