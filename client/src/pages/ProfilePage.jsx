import { usePageTitle } from '../pageTitle.js';
import { displayName } from '../../../server/stats/names.js';
import { useEffect, useState } from 'react';
import { Link, Navigate, useParams } from '../scope.jsx';
import { api } from '../api.js';
import { Icon } from '../chrome/Icon.jsx';
import { EmptyState, Provenance } from '../components/EmptyState.jsx';
import { ServiceUnavailable } from '../components/States.jsx';
import { RenderFrame } from '../components/Stats.jsx';
import { TierBadge, TierBrief } from '../components/Tier.jsx';
import { formatNumber } from '../format.js';
import { BadgePill, BadgeRow } from '../badges/Badges.jsx';
import { ReportButton } from '../moderation/Moderation.jsx';
import { useSession } from '../session.jsx';

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
  const session = useSession();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  usePageTitle(data?.profile ? `${data.profile.displayName} (@${data.profile.username})` : null); // 0.9.2
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
      // 0.8.2: a banned account's profile. Neutral on purpose: it never says why.
      if (error.code === 'unavailable') {
        return (
          <div className="wrap page-pad stack gap-24 narrow-wrap">
            <h1 className="h1">Profile unavailable</h1>
            <EmptyState kind="nocoverage" title="This profile isn’t available">
              <span>Characters still have their own pages and stay on the leaderboards.</span>
            </EmptyState>
          </div>
        );
      }
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
                {guilds.slice(0, 3).map((g) => <Link key={g.slug} className="tag gold" scope={g.version} to={`/g/${encodeURIComponent(g.slug)}`}>{g.name}</Link>)}
              </div>
            )}
            {about?.links?.length > 0 && <SocialLinks links={about.links} />}
            {/* 0.8.2: anyone can report a profile, except its owner. */}
            {!(session.signedIn && session.user?.claimed && session.user.username === p.username) && (
              <div className="row profile-report"><ReportButton username={p.username} socials={about?.links ?? []} label="Report this profile" /></div>
            )}
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

/**
 * The social links: handles only, each link built by Everstats. (The bio is plain text: nothing in it is a link.)
 * 0.8.1: a handle Everstats checked for a Verified Content Creator carries a "Verified" mark (text and a check, never a
 * platform logo), only while the handle is exactly the one checked; every other handle keeps the "not verified" note.
 */
function SocialLinks({ links }) {
  return (
    <div className="stack gap-6">
      {links.length > 0 && (
        <ul className="plain row gap-10 profile-links" aria-label="Elsewhere">
          {links.map((l) => (
            <li key={l.platform} className="row gap-6">
              <a className="btn sm ghost" href={l.url} target="_blank" rel="noopener noreferrer nofollow">
                <b>{l.label}</b><span className="mono profile-handle">{l.platform === 'discord' ? `discord.gg/${l.handle}` : `@${l.handle}`}</span>
              </a>
              {l.verified && <span className="verified-mark" title="Everstats checked this handle (Verified Content Creator)"><Icon name="check" size="sm" />Verified</span>}
            </li>
          ))}
        </ul>
      )}
      <span className="muted xsmall">{links.some((l) => l.verified)
        ? (links.some((l) => !l.verified) ? 'Handles marked Verified were checked by Everstats. The others are the player’s own and aren’t verified.' : 'Handles marked Verified were checked by Everstats.')
        : 'Links are the player’s own and aren’t verified by Everstats.'}</span>
    </div>
  );
}

function PinsSection({ section }) {
  const c = section.character;
  return (
    <section className="panel pad-20 stack gap-14" aria-labelledby="pins-h">
      <div className="row gap-10 pins-head">
        <h2 className="eyebrow flex-fill" id="pins-h">Pinned statistics</h2>
        <span className="muted xsmall">for <Link scope={c.version} to={`/c/${encodeURIComponent(c.slug)}`}>{c.name} {c.surname}</Link>{c.ruleset ? ` · ${c.ruleset}` : ''}</span>
      </div>
      <div className="grid-auto col-sm gap-14">
        {section.cards.map((p) => (
          <Link key={p.id} className="panel statcard" to={`/leaderboards/${c.rulesetId}/${p.id}`}>
            <span className="eyebrow ellipsis" title={displayName(p.name) ?? undefined}>{displayName(p.name) ?? 'Statistic no longer available'}</span>
            <span className="big">{p.text ? <span className="small muted">{p.text} · </span> : null}{formatNumber(p.value)}</span>
            {/* 0.9.2: the change since last week only when there is one to show (no stray "—"), on the rank's line. */}
            <span className="small pin-rank-line">
              {p.rank !== null ? <span className="t2"><b className="strong-text">#{formatNumber(p.rank)}</b> of {formatNumber(p.withAny)} with any</span> : <span className="muted">Not ranked</span>}
              {p.move !== null && <span className={p.move > 0 ? 'up' : p.move < 0 ? 'down' : 'muted'} title="Change in rank since a week ago">{p.move > 0 ? `▲ ${p.move}` : p.move < 0 ? `▼ ${-p.move}` : '± 0'}</span>}
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
      {/* 0.9.2: the details sit in the middle of the render's height, not at its top with empty space below. */}
      <div className="grid-auto col-lg gap-18 featured-grid">
        {c.renderPaused
          ? <RenderFrame><span className="render-crest disp" aria-hidden="true">{(c.name?.[0] ?? '') + (c.surname?.[0] ?? '')}</span><span className="small t2 render-paused-note" role="note">{c.renderPaused}</span></RenderFrame>
          : c.renderHidden
          ? <RenderFrame><span className="h3">Render hidden by its owner</span></RenderFrame>
          : <RenderFrame src={c.render} alt={`${c.name} ${c.surname}, as Blizzard renders them`} pending={!c.render} />}
        <div className="stack gap-8 fit-name-box">
          {/* 0.11.1: the name never breaks inside a word. It is sized from its LONGEST word (--name-len, through the
              CSSOM) against this column's width, so a 12-letter name shrinks to fit one line; a name and surname may
              still wrap between the two words. (At 1568 px a 12-letter name used to break mid-word.) */}
          <Link className="h-display char-name fit-name" style={{ '--name-len': Math.max(4, ...`${c.name ?? ''} ${c.surname ?? ''}`.split(/\s+/).map((w) => w.length)) }} scope={c.version} to={`/c/${encodeURIComponent(c.slug)}`}>{c.name} <span className="surname">{c.surname}</span></Link>
          <span className="t2">{[c.level ? `Level ${c.level}` : null, c.race, c.class, c.realm, c.ruleset?.name].filter(Boolean).join(' · ')}</span>
          <TierBrief brief={c.tierBrief} slug={c.slug} scope={c.version} />
          <Link className="btn sm self-start" scope={c.version} to={`/c/${encodeURIComponent(c.slug)}`}>Character page</Link>
          <Provenance source="Blizzard Entertainment’s game data API" fetchedAt={c.fetchedAt} />
        </div>
        <FeaturedExtras c={c} />
      </div>
    </section>
  );
}

/**
 * 0.10.4: the featured card's third column (it sat empty beside the details): the owner's pinned badge and the
 * character's best overall placements, as the server ranks them (stats/boards.js, the character page's own ranks).
 * Nothing to show → the column says so plainly, never a made-up placement.
 */
function FeaturedExtras({ c }) {
  const places = c.placements ?? [];
  return (
    <div className="stack gap-12 featured-extras">
      {c.badge && (
        <div className="stack gap-6">
          <span className="eyebrow">Pinned badge</span>
          <span className="self-start"><BadgePill badge={c.badge} /></span>
        </div>
      )}
      <div className="stack gap-6">
        <span className="eyebrow">Best placements</span>
        {places.length ? (
          <ol className="plain featured-places">
            {places.map((p) => (
              <li key={p.id}>
                <span className={`rk${p.rank <= 3 ? ` r${p.rank}` : ''}`}>#{formatNumber(p.rank)}</span>
                <span className="stack gap-2 grow-col">
                  <Link to={c.ruleset ? `/leaderboards/${c.ruleset.id}/${p.id}` : '/leaderboards'}>{displayName(p.name)}</Link>
                  <span className="muted xsmall">of {formatNumber(p.withAny)} with any{c.ruleset ? ` on ${c.ruleset.name}` : ''} · {formatNumber(p.value)}</span>
                </span>
              </li>
            ))}
          </ol>
        ) : <span className="muted small">Not on a leaderboard yet: a placement shows once this character has more of a statistic than someone else tracked.</span>}
      </div>
    </div>
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
              <b className="ellipsis"><Link scope={c.version} to={`/c/${encodeURIComponent(c.slug)}`}>{c.name} <span className="surname">{c.surname}</span></Link></b>
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
              <b><Link scope={g.version} to={`/g/${encodeURIComponent(g.slug)}`}>{g.name}</Link></b>
              <span className="muted xsmall">{[g.ruleset, g.characters.join(', ')].filter(Boolean).join(' · ')}</span>
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}
