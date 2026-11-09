import { useEffect, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { api } from '../api.js';
import { EmptyState } from '../components/EmptyState.jsx';
import { ServiceUnavailable } from '../components/States.jsx';
import { RenderFrame } from '../components/Stats.jsx';
import { formatDate } from '../format.js';

/**
 * A player's public profile: /u/{username} (GET /api/users/:username). Anyone can view it. It shows the display name,
 * @username, beta membership, the featured character and their other characters that aren't hidden.
 *
 * The page is a list of SECTIONS from the server, each drawn by its entry in SECTION_VIEWS: badges, pinned statistics
 * and anything else later are a new section id and a new entry here, not a new page. An id this build doesn't know
 * is skipped (an older page never breaks on a newer server).
 *
 * A renamed username redirects to the new one (30 days); a placeholder has no profile and says so; a name nobody
 * holds is "no such player".
 */
const SECTION_VIEWS = {
  featured: FeaturedSection,
  characters: CharactersSection,
};

export function ProfilePage() {
  const { username } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => {
    let live = true;
    setData(null);
    setError(null);
    api(`/api/users/${encodeURIComponent(username)}`).then((d) => { if (live) setData(d); }, (err) => { if (live) setError(err); });
    return () => {
      live = false;
    };
  }, [username]);

  if (data?.status === 'moved') return <Navigate to={`/u/${data.username}`} replace />;
  if (error) {
    if (error.status === 404) {
      const placeholder = error.code === 'placeholder';
      return (
        <div className="wrap page-pad stack gap-24 narrow-wrap">
          <h1 className="h1">{placeholder ? 'No profile yet' : 'No such player'}</h1>
          <EmptyState kind="nocoverage" title={placeholder ? 'This player hasn’t chosen a username yet' : `Nobody is called @${String(username).toLowerCase()}`}>
            <span>{placeholder ? 'Profiles start once a player claims a username.' : 'No Everstats account uses that username.'}</span>
          </EmptyState>
        </div>
      );
    }
    return <div className="wrap page-pad"><ServiceUnavailable title="Couldn't load this profile">{error.message}</ServiceUnavailable></div>;
  }
  if (!data) return <div className="wrap page-pad"><h1 className="h1">@{String(username).toLowerCase()}</h1><span className="t2 small" role="status">Loading…</span></div>;

  const p = data.profile;
  return (
    <div className="wrap page-pad stack gap-28">
      <section className="sheet sheet-pad stack gap-10" aria-label="Player">
        <h1 className="h-display profile-name">{p.displayName}</h1>
        <div className="row gap-10">
          <span className="mono t2">@{p.username}</span>
          {p.beta && <span className="tag gold">Beta member since {formatDate(p.beta.since)}</span>}
        </div>
      </section>
      {data.sections.map((s) => {
        const View = SECTION_VIEWS[s.id];
        return View ? <View key={s.id} section={s} profile={p} /> : null;
      })}
    </div>
  );
}

function FeaturedSection({ section, profile }) {
  const c = section.character;
  if (!c) {
    return (
      <EmptyState kind="nodata" title="No characters to show yet">
        <span>{profile.displayName} has no tracked characters that aren't hidden.</span>
      </EmptyState>
    );
  }
  return (
    <section className="panel pad-20 stack gap-14" aria-labelledby="featured-h">
      <span className="eyebrow" id="featured-h">Featured character</span>
      <div className="grid-auto col-lg gap-18 align-start-grid">
        <RenderFrame src={c.render} alt={`${c.name} ${c.surname}, as Blizzard renders them`} pending={!c.render} />
        <div className="stack gap-8">
          <Link className="h-display char-name" to={`/c/${encodeURIComponent(c.slug)}`}>{c.name} <span className="surname">{c.surname}</span></Link>
          <span className="t2">{[c.level ? `Level ${c.level}` : null, c.race, c.class, c.ruleset?.name].filter(Boolean).join(' · ')}</span>
          <Link className="btn sm self-start" to={`/c/${encodeURIComponent(c.slug)}`}>Character page</Link>
        </div>
      </div>
    </section>
  );
}

function CharactersSection({ section }) {
  if (!section.characters.length) return null;
  return (
    <section className="panel clip" aria-labelledby="chars-h">
      <div className="row board-head"><h2 className="h3" id="chars-h">Characters</h2><span className="muted xsmall">{section.characters.length}</span></div>
      <div className="listbox flush">
        {section.characters.map((c) => (
          <div key={c.slug} className="listrow">
            <span className="stack grow-col">
              <b><Link to={`/c/${encodeURIComponent(c.slug)}`}>{c.name} <span className="surname">{c.surname}</span></Link></b>
              <span className="muted xsmall">{[c.level ? `Level ${c.level}` : null, c.race, c.class, c.ruleset?.name].filter(Boolean).join(' · ')}</span>
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}
