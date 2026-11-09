import { useEffect, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { api } from '../api.js';
import { EmptyState, Provenance } from '../components/EmptyState.jsx';
import { ServiceUnavailable } from '../components/States.jsx';
import { RenderFrame } from '../components/Stats.jsx';
import { TierBadge, TierBrief } from '../components/Tier.jsx';
import { formatNumber } from '../format.js';
import { BadgeRow } from '../badges/Badges.jsx';

/**
 * A player's public profile: /u/{username} (GET /api/users/:username). Anyone can view it.
 *
 * 0.7.0, the design's profile (design/v2-badges/pages/profile), adopted where it is better than 0.4.2's:
 *   - one header sheet: an initials avatar, the display name, "@username · Joined", the BADGE ROW (pills: badge + name;
 *     "+N more" opens All badges; no badges → no row at all), then the bio, the main ruleset / faction / guild tags and
 *     the social handles, which 0.4.2 split between the header and an "About" panel
 *   - other characters as cards with their tier shield (the design's grid), not a list
 *   - the "Beta member since" tag is gone: the Beta Tester badge says it, and the player decides whether it shows
 * Kept from 0.4.2: the pinned-stats section (and its on/off setting), the featured character with its render, the
 * guilds section (which character is in which guild), the joined date, and every "Source" line.
 *
 * Then SECTIONS from the server, each drawn by its entry in SECTION_VIEWS. A section with nothing in it isn't sent, so
 * there are no empty boxes; an id this build doesn't know is skipped. 'about' is drawn inside the header now.
 *
 * Everything from Blizzard (ruleset, faction, characters, guilds, pinned values) follows the 30-day rule and carries a
 * "Source" line; the bio and social links are the player's own.
 */
const SECTION_VIEWS = {
  pins: PinsSection,
  featured: FeaturedSection,
  characters: CharactersSection,
  guilds: GuildsSection,
};

const monthYear = (iso) => new Date(iso).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });

/** Up to two initials from the display name (letters or digits); the avatar is decoration only. */
function initials(name) {
  const ok = (ch) => /[\p{L}\p{N}]/u.test(ch);
  const words = String(name ?? '').trim().split(/[\s_-]+/u).filter(Boolean);
  const first = (w) => [...w].find(ok) ?? '';
  const out = words.length > 1 ? first(words[0]) + first(words[1]) : [...(words[0] ?? '')].filter(ok).slice(0, 2).join('');
  return out.toUpperCase() || '?';
}

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
  const about = data.sections.find((s) => s.id === 'about') ?? null;
  const guilds = data.sections.find((s) => s.id === 'guilds')?.guilds ?? [];
  return (
    <div className="wrap page-pad stack gap-28">
      <section className="sheet sheet-pad" aria-label="Player">
        <div className="profile-head">
          <span className="profile-av" aria-hidden="true">{initials(p.displayName)}</span>
          <div className="stack gap-12">
            <div className="stack gap-4">
              <h1 className="h-display profile-name">{p.displayName}</h1>
              <span className="t2"><span className="mono">@{p.username}</span> · Joined {monthYear(p.joinedAt)}</span>
            </div>
            <BadgeRow badges={data.badges} whose={`@${p.username}`} />
            {about?.bio && <p className="t2 profile-bio">{about.bio}</p>}
            {(p.main || guilds.length > 0) && (
              <div className="profile-tags" aria-label="Main ruleset, faction and guilds">
                {p.main?.ruleset && <span className="tag">Main · {p.main.ruleset}</span>}
                {p.main?.faction && <span className="tag">{p.main.faction}</span>}
                {guilds.slice(0, 3).map((g) => <Link key={g.slug} className="tag gold" to={`/g/${encodeURIComponent(g.slug)}`}>{g.name}</Link>)}
              </div>
            )}
            {about?.links?.length > 0 && <SocialLinks links={about.links} />}
          </div>
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

/** The social links: handles only, each link built by Everstats. (The bio is plain text: nothing in it is a link.) */
function SocialLinks({ links }) {
  return (
    <div className="stack gap-6">
      {links.length > 0 && (
        <ul className="plain row gap-10 profile-links" aria-label="Elsewhere">
          {links.map((l) => (
            <li key={l.platform}>
              <a className="btn sm ghost" href={l.url} target="_blank" rel="noopener noreferrer nofollow">
                <b>{l.label}</b><span className="mono profile-handle">{l.platform === 'discord' ? `discord.gg/${l.handle}` : `@${l.handle}`}</span>
              </a>
            </li>
          ))}
        </ul>
      )}
      <span className="muted xsmall">Links are the player’s own and aren’t verified by Everstats.</span>
    </div>
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
          <TierBrief brief={c.tierBrief} slug={c.slug} />
          <Link className="btn sm self-start" to={`/c/${encodeURIComponent(c.slug)}`}>Character page</Link>
          <Provenance source="Blizzard Entertainment’s game data API" fetchedAt={c.fetchedAt} />
        </div>
      </div>
    </section>
  );
}

function CharactersSection({ section }) {
  return (
    <section className="stack gap-12" aria-labelledby="chars-h">
      <div className="row gap-10"><h2 className="h2" id="chars-h">Other characters</h2><span className="muted xsmall">{section.characters.length} · claimed through Battle.net</span></div>
      <div className="profile-chars">
        {section.characters.map((c) => (
          <div key={c.slug} className="panel">
            <TierBadge letter={c.tier ?? null} size="md" />
            <span className="stack grow-col gap-2">
              <b className="ellipsis"><Link to={`/c/${encodeURIComponent(c.slug)}`}>{c.name} <span className="surname">{c.surname}</span></Link></b>
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
