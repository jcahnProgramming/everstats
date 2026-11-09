import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api.js';
import { Icon } from '../chrome/Icon.jsx';
import { EmptyState } from '../components/EmptyState.jsx';
import { ServiceUnavailable } from '../components/States.jsx';
import { formatDate, formatNumber } from '../format.js';
import { GuildBadgeIcon, guildBadgeName } from './GuildBadges.jsx';

/**
 * Guild badge pages (0.7.1): the index of every guild badge (/guild-badges) and one badge's detail
 * (design/v2-guild-badges/pages/guild-badge-detail): hero, "Your guild" progress (when the viewer belongs to a tracked
 * guild), the levels ladder (art, threshold, how many guilds hold each level, "Your guild"), and the guilds holding it.
 * Every count is real; a guild whose totals aren't added up yet shows no progress rather than an invented 0.
 */
export function GuildBadgesIndexPage() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => {
    api('/api/guild-badges').then(setData, (err) => setError(err.message));
  }, []);
  return (
    <div className="wrap page-pad stack gap-28">
      <nav className="crumbs small" aria-label="Breadcrumb"><Link to="/guilds">Guilds</Link><span aria-hidden="true"> / </span><span>Guild badges</span></nav>
      <div className="stack gap-8">
        <h1 className="h1">Guild badges</h1>
        <p className="t2">Guilds unlock badges together: tracked members, combined statistics, board standing and when they joined. Every guild badge is automatic or granted by Everstats staff; nobody can award one to their own guild.</p>
      </div>
      {error && <ServiceUnavailable inline title="Couldn’t load the guild badges">{error}</ServiceUnavailable>}
      {!data && !error && <span className="t2 small" role="status">Loading…</span>}
      {data?.families.map((f) => (
        <section key={f.id} className="stack gap-12" aria-labelledby={`fam-${f.id}`}>
          <div className="orn"><span className="gem" /><h2 className="h2" id={`fam-${f.id}`}>{f.label}</h2><span className="rule" /></div>
          <div className="gb-index">
            {f.badges.map((b) => (
              <Link key={b.id} to={`/guild-badges/${b.id}`} className="panel gb-card">
                <GuildBadgeIcon badge={b} size="std" />
                <span className="stack gap-2 grow-col">
                  <b>{b.name}</b>
                  <span className="muted xsmall">{b.how}</span>
                  <span className="muted xsmall">{b.levelled ? 'Levels I–V · ' : ''}Held by {formatNumber(b.heldBy)} guild{b.heldBy === 1 ? '' : 's'}</span>
                </span>
              </Link>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

export function GuildBadgePage() {
  const { id } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const load = useCallback(async () => {
    setError(null);
    try {
      setData(await api(`/api/guild-badges/${encodeURIComponent(id)}`));
    } catch (err) {
      setError(err);
    }
  }, [id]);
  useEffect(() => {
    load();
  }, [load]);
  if (error?.status === 404) {
    return (
      <div className="wrap page-pad stack gap-24 narrow-wrap">
        <h1 className="h1">No such guild badge</h1>
        <EmptyState kind="nocoverage" title="Everstats has no guild badge at this address"><span>See <Link to="/guild-badges">every guild badge</Link>.</span></EmptyState>
      </div>
    );
  }
  if (error) return <div className="wrap page-pad"><ServiceUnavailable title="Couldn’t load this guild badge" onRetry={load}>{error.message}</ServiceUnavailable></div>;
  if (!data) return <div className="wrap page-pad"><span className="t2 small" role="status">Loading…</span></div>;
  const b = data.badge;
  const y = data.yours;
  const closed = data.window && ((data.window.beta && !data.window.open) || data.window.closed);
  return (
    <div className="wrap page-pad stack gap-28">
      <nav className="crumbs small" aria-label="Breadcrumb">
        <Link to="/guilds">Guilds</Link><span aria-hidden="true"> / </span><Link to="/guild-badges">Guild badges</Link><span aria-hidden="true"> / </span><span>{b.name}</span>
      </nav>
      <section className="sheet sheet-pad" aria-labelledby="gbadge-h">
        <div className="badge-hero">
          <div className="badge-hero-art">
            <GuildBadgeIcon badge={b} size="xl" state={y && b.keptWhileHeld ? (y.state === 'held' ? 'held' : y.state === 'lost' ? 'lost' : null) : null} />
            <span className="eyebrow">Hanging standard</span>
          </div>
          <div className="stack gap-14">
            <span className="eyebrow">{['Guild badge', b.familyLabel, b.award === 'automatic' ? 'Automatic' : 'Granted by staff', b.levelled ? 'Levelled' : null, b.keptWhileHeld ? 'Kept while held' : null, b.timeLimited ? 'Permanent' : null].filter(Boolean).join(' · ')}</span>
            <h1 className="h-display" id="gbadge-h">{b.name}</h1>
            <p className="t2">{b.description}</p>
            {closed && (
              <div className="note warn small"><Icon name="clock" /><span><b>No longer available.</b> {data.window.beta ? 'Founding Guild was for guilds tracked during the open beta, which has closed.' : `Early Guild was for guilds first tracked ${data.window.start} – ${data.window.end} (UTC).`} Guilds that have it keep it.</span></div>
            )}
            <div className="panel pad-16">
              <div className="kv"><span className="t2">How it’s unlocked</span><span className="right-text">{b.how}</span></div>
              {data.window && !data.window.beta && <div className="kv"><span className="t2">Window</span><span>{data.window.start} – {data.window.end} (UTC){data.window.closed ? ' · closed' : ''}</span></div>}
              <div className="kv"><span className="t2">Guilds holding it</span><span>{formatNumber(data.heldBy)}</span></div>
            </div>
            <YourGuild data={data} />
          </div>
        </div>
      </section>

      {data.levels && (
        <section className="stack gap-12" aria-labelledby="levels-h">
          <div className="orn"><span className="gem" /><h2 className="h2" id="levels-h">Levels</h2><span className="rule" /><span className="muted xsmall">Iron · Bronze · Silver · Gold · Forever. Gems on the rod and the numeral plate say the level.</span></div>
          <div className="gb-ladder">
            {data.levels.map((l) => {
              const mine = y?.level === l.level;
              return (
                <div key={l.level} className={`panel gb-level${mine ? ' is-yours' : ''}`}>
                  <GuildBadgeIcon badge={l} size="lg" state={y && y.level < l.level ? 'progress' : null} />
                  <b className="gb-level-name">{l.numeral} · {l.metal}</b>
                  <span className="small">{formatNumber(l.threshold)} {b.measure}</span>
                  <span className="muted xsmall">{formatNumber(l.guilds)} guild{l.guilds === 1 ? '' : 's'}</span>
                  {mine && <span className="tag gold">Your guild</span>}
                </div>
              );
            })}
          </div>
        </section>
      )}

      <section className="panel clip" aria-labelledby="top-h">
        <div className="pad-20"><h2 className="h3" id="top-h">{b.levelled ? 'Guilds at the highest levels' : 'Guilds holding it'}</h2></div>
        {data.top.length === 0 ? (
          <div className="pad-20"><EmptyState kind="nodata" compact title="No guild holds it yet"><span>{b.how}</span></EmptyState></div>
        ) : (
          <ol className="plain gb-top">
            {data.top.map((g, i) => (
              <li key={g.slug} className="kv">
                <span className="row gap-10"><span className="rk">{i + 1}</span><Link to={`/g/${encodeURIComponent(g.slug)}`}>{g.name}</Link>{g.level ? <span className="lvl-num">{['I', 'II', 'III', 'IV', 'V'][g.level - 1]}</span> : null}</span>
                <span className="muted xsmall">{g.heldSince ? `held since ${formatDate(g.heldSince)}` : `since ${formatDate(g.levelAt)}`}</span>
              </li>
            ))}
          </ol>
        )}
      </section>

      {data.siblings.length > 0 && (
        <section className="stack gap-12" aria-labelledby="sibs-h">
          <h2 className="h2" id="sibs-h">Other {b.familyLabel.toLowerCase()} badges</h2>
          <div className="badge-sibs">
            {data.siblings.map((s) => (
              <Link key={s.id} className="gpill" to={`/guild-badges/${s.id}`}><GuildBadgeIcon badge={s} size="pill-ico" labelled={false} /><span>{s.name}</span></Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function YourGuild({ data }) {
  const b = data.badge;
  const y = data.yours;
  if (!data.signedIn) return <div className="note small"><Icon name="info" /><span><Link to="/sign-in">Sign in</Link> with Battle.net to see your guild’s progress.</span></div>;
  if (!y) return <div className="note small"><Icon name="info" /><span>None of your tracked characters is in a guild Everstats tracks.</span></div>;
  const g = <Link to={`/g/${encodeURIComponent(y.guild.slug)}`}>{y.guild.name}</Link>;
  if (b.levelled) {
    const at = y.level ? `${b.name} ${['I', 'II', 'III', 'IV', 'V'][y.level - 1]}` : 'Not started';
    return (
      <div className="panel pad-16 stack gap-8 ucard-like">
        <span><b>Your guild · {g}</b></span>
        <span className="muted xsmall">{y.level === 5 ? `At ${at} · the top level` : `${at}${y.progress ? ` · next ${y.progress.numeral}` : ''}`}{y.level > 0 && (y.levelAt ?? y.firstAt) ? ` · unlocked ${formatDate(y.levelAt ?? y.firstAt)}` : ''}</span>
        {y.progress ? (
          <>
            <div className="gprog"><span style={{ width: `${(y.progress.pct * 100).toFixed(1)}%` }} /></div>
            <div className="nums"><span><b>{formatNumber(y.progress.value)}</b> / {formatNumber(y.progress.threshold)} {b.measure}</span><span>{formatNumber(y.progress.toGo)} to go</span></div>
          </>
        ) : y.level !== 5 && <span className="muted xsmall">Progress appears once {y.guild.name}’s totals are added up.</span>}
      </div>
    );
  }
  if (y.state === 'held') {
    return <div className="note ok small"><Icon name="check" /><span><b>{y.guild.name} has it</b>{b.keptWhileHeld ? ` · held since ${formatDate(y.heldSince)} · kept while held` : ` · since ${formatDate(y.firstAt)}`}.</span></div>;
  }
  if (y.state === 'lost') return <div className="note warn small"><Icon name="hourglass" /><span><b>{y.guild.name} lost it {formatDate(y.lostAt)}</b> (held {formatDate(y.heldSince)} – {formatDate(y.lostAt)}). It returns automatically if regained.</span></div>;
  return <div className="note small"><Icon name="lock" /><span><b>{guildBadgeName(b)} · {y.guild.name}</b>: {y.reason ?? (b.award === 'manual' ? 'granted by Everstats staff, never earned.' : b.how)}</span></div>;
}
