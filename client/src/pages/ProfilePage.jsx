import { useEffect, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { api } from '../api.js';
import { EmptyState, Provenance } from '../components/EmptyState.jsx';
import { ServiceUnavailable } from '../components/States.jsx';
import { RenderFrame } from '../components/Stats.jsx';
import { formatDate, formatNumber } from '../format.js';

/**
 * A player's public profile: /u/{username} (GET /api/users/:username). Anyone can view it.
 *
 * The header: display name, @username, joined date, beta membership, and the main ruleset and faction (from the
 * featured character). Then SECTIONS from the server, each drawn by its entry in SECTION_VIEWS. A section with
 * nothing in it isn't sent, so there are no empty boxes; an id this build doesn't know is skipped. Badges later are a
 * new section id and a new entry here.
 *
 * Everything from Blizzard (ruleset, faction, characters, guilds, pinned values) follows the 30-day rule and carries a
 * "Source" line; the bio and social links are the player's own.
 */
const SECTION_VIEWS = {
  about: AboutSection,
  pins: PinsSection,
  featured: FeaturedSection,
  characters: CharactersSection,
  guilds: GuildsSection,
};

const monthYear = (iso) => new Date(iso).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });

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
  const main = p.main ? [p.main.ruleset, p.main.faction].filter(Boolean).join(' · ') : null;
  return (
    <div className="wrap page-pad stack gap-28">
      <section className="sheet sheet-pad stack gap-10" aria-label="Player">
        <h1 className="h-display profile-name">{p.displayName}</h1>
        <div className="row gap-10">
          <span className="mono t2">@{p.username}</span>
          <span className="muted small">Joined {monthYear(p.joinedAt)}</span>
          {p.beta && <span className="tag gold">Beta member since {formatDate(p.beta.since)}</span>}
          {main && <span className="tag">{main}</span>}
        </div>
      </section>
      {data.sections.map((s) => {
        const View = SECTION_VIEWS[s.id];
        return View ? <View key={s.id} section={s} profile={p} /> : null;
      })}
      {!data.sections.some((s) => s.id === 'featured') && (
        <EmptyState kind="nodata" title="No characters to show yet">
          <span>{p.displayName} has no tracked characters that aren't hidden.</span>
        </EmptyState>
      )}
    </div>
  );
}

/** The bio (plain text: nothing in it is a link) and the social links, each built by Everstats from a handle. */
function AboutSection({ section }) {
  return (
    <section className="panel pad-20 stack gap-14" aria-labelledby="about-h">
      <h2 className="eyebrow" id="about-h">About</h2>
      {section.bio && <p className="t2 profile-bio">{section.bio}</p>}
      {section.links.length > 0 && (
        <ul className="plain row gap-10 profile-links" aria-label="Elsewhere">
          {section.links.map((l) => (
            <li key={l.platform}>
              <a className="btn sm ghost" href={l.url} target="_blank" rel="noopener noreferrer nofollow">
                <b>{l.label}</b><span className="mono profile-handle">{l.platform === 'discord' ? `discord.gg/${l.handle}` : `@${l.handle}`}</span>
              </a>
            </li>
          ))}
        </ul>
      )}
      {section.links.length > 0 && <span className="muted xsmall">Links are the player’s own and aren’t verified by Everstats.</span>}
    </section>
  );
}

function PinsSection({ section }) {
  const c = section.character;
  return (
    <section className="panel pad-20 stack gap-14" aria-labelledby="pins-h">
      <div className="row gap-10 pins-head">
        <h2 className="eyebrow grow" id="pins-h">Pinned statistics</h2>
        <span className="muted xsmall">for <Link to={`/c/${encodeURIComponent(c.slug)}`}>{c.name} {c.surname}</Link>{c.ruleset ? ` · ${c.ruleset}` : ''}</span>
      </div>
      <div className="grid-auto col-sm gap-14">
        {section.cards.map((p) => (
          <Link key={p.id} className="panel statcard" to={`/leaderboards/${c.rulesetId}/${p.id}`}>
            <span className="eyebrow ellipsis">{p.name ?? 'Statistic no longer available'}</span>
            <span className="big">{p.text ? <span className="small muted">{p.text} · </span> : null}{formatNumber(p.value)}</span>
            <span className="row gap-8 small">
              {p.rank !== null ? <span className="t2"><b className="strong-text">#{formatNumber(p.rank)}</b> of {formatNumber(p.withAny)} with any</span> : <span className="muted">Not ranked</span>}
              <span className={p.move > 0 ? 'up' : p.move < 0 ? 'down' : 'muted'}>{p.move === null ? '—' : p.move > 0 ? `▲ ${p.move}` : p.move < 0 ? `▼ ${-p.move}` : '± 0'}</span>
            </span>
          </Link>
        ))}
      </div>
      <Provenance source="Blizzard Entertainment’s game data API" fetchedAt={section.fetchedAt} />
    </section>
  );
}

function FeaturedSection({ section }) {
  const c = section.character;
  return (
    <section className="panel pad-20 stack gap-14" aria-labelledby="featured-h">
      <span className="eyebrow" id="featured-h">Featured character</span>
      <div className="grid-auto col-lg gap-18 align-start-grid">
        <RenderFrame src={c.render} alt={`${c.name} ${c.surname}, as Blizzard renders them`} pending={!c.render} />
        <div className="stack gap-8">
          <Link className="h-display char-name" to={`/c/${encodeURIComponent(c.slug)}`}>{c.name} <span className="surname">{c.surname}</span></Link>
          <span className="t2">{[c.level ? `Level ${c.level}` : null, c.race, c.class, c.ruleset?.name].filter(Boolean).join(' · ')}</span>
          <Link className="btn sm self-start" to={`/c/${encodeURIComponent(c.slug)}`}>Character page</Link>
          <Provenance source="Blizzard Entertainment’s game data API" fetchedAt={c.fetchedAt} />
        </div>
      </div>
    </section>
  );
}

function CharactersSection({ section }) {
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

function GuildsSection({ section }) {
  return (
    <section className="panel clip" aria-labelledby="guilds-h">
      <div className="row board-head"><h2 className="h3" id="guilds-h">Guilds</h2><span className="muted xsmall">{section.guilds.length}</span></div>
      <div className="listbox flush">
        {section.guilds.map((g) => (
          <div key={g.slug} className="listrow">
            <span className="stack grow-col">
              <b><Link to={`/g/${encodeURIComponent(g.slug)}`}>{g.name}</Link></b>
              <span className="muted xsmall">{[g.ruleset, g.characters.join(', ')].filter(Boolean).join(' · ')}</span>
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}
