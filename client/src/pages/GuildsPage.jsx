import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { parseGuildSlug } from '../../../server/stats/slug.js';
import { api } from '../api.js';
import { Icon } from '../chrome/Icon.jsx';
import { EmptyState } from '../components/EmptyState.jsx';
import { ServiceUnavailable } from '../components/States.jsx';
import { RulesetSwitcher } from '../components/Stats.jsx';
import { formatNumber, timeAgo } from '../format.js';
import { GuildCrest } from './GuildPage.jsx';

/**
 * /guilds (0.5.0): guild search, and the largest guilds by tracked members on each ruleset. The design has no guild
 * index page; this is built from the leaderboards index's parts. Search reads only what Everstats already knows; a
 * guild it has never seen can still be opened by its address (/g/{guild-name-with-hyphens}), which looks it up once.
 */
export function GuildsPage() {
  const [params, setParams] = useSearchParams();
  const asked = params.get('ruleset');
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => {
    let live = true;
    setError(null);
    api(`/api/guilds${asked ? `?ruleset=${encodeURIComponent(asked)}` : ''}`).then((d) => { if (live) setData(d); }, (err) => { if (live) setError(err.message); });
    return () => {
      live = false;
    };
  }, [asked]);
  const rs = data?.ruleset ?? null;
  return (
    <div className="wrap page-pad stack gap-24">
      <div className="row gap-20">
        <GuildCrest />
        <div className="stack gap-8 grow">
          <h1 className="h1">Guilds</h1>
          <p className="lead">Every guild Everstats tracks members of: its roster, its totals, and where it stands against other guilds.</p>
        </div>
      </div>
      <GuildSearch />
      {error && <ServiceUnavailable inline title="Couldn't load the guilds">{error}</ServiceUnavailable>}
      {data && data.rulesets.length > 0 && (
        <div className="row gap-16">
          <RulesetSwitcher rulesets={data.rulesets} value={rs?.id} onChange={(id) => setParams({ ruleset: String(id) })} large />
          {rs && <Link className="small" to={`/leaderboards?view=guilds&ruleset=${rs.id}`}>Guild boards on {rs.name} →</Link>}
        </div>
      )}
      {data && !rs && (
        <EmptyState kind="nodata" title="No guilds yet">
          <span>Guilds appear as soon as Everstats fetches a character who is in one. Look someone up to start.</span>
        </EmptyState>
      )}
      {data && rs && (
        <section className="panel clip" aria-labelledby="largest-h">
          <div className="row board-head">
            <h2 className="h3" id="largest-h">Largest guilds on {rs.name}, by tracked members</h2>
            <span className="muted xsmall">{formatNumber(data.known)} known</span>
          </div>
          {data.guilds.length === 0 ? (
            <div className="pad-16"><EmptyState kind="nodata" compact title="No guild here has a tracked member yet" /></div>
          ) : (
            <div className="tblbox">
              <table className="tbl">
                <thead>
                  <tr><th scope="col">#</th><th scope="col">Guild</th><th scope="col">Faction</th><th scope="col" className="r">Tracked</th><th scope="col" className="r">On Blizzard’s roster</th><th scope="col">Guild boards</th></tr>
                </thead>
                <tbody>
                  {data.guilds.map((g, i) => (
                    <tr key={g.slug}>
                      <td className="t2">{i + 1}</td>
                      <td><Link to={`/g/${encodeURIComponent(g.slug)}`}>{g.name}</Link></td>
                      <td className="t2">{g.faction ?? '—'}</td>
                      <td className="r strong">{formatNumber(g.tracked)}</td>
                      <td className="r t2">{g.rosterMembers === null ? 'not fetched yet' : formatNumber(g.rosterMembers)}</td>
                      <td className="t2">{g.ranked ? 'Ranked' : `Not ranked yet (needs ${data.minMembers})`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="pad-16"><span className="muted xsmall">Tracked = members Everstats has fetched (level 10 and up, not hidden).{data.computedAt ? ` Counts as of ${timeAgo(data.computedAt)}.` : ''}</span></div>
        </section>
      )}
    </div>
  );
}

/** Find a guild by name among those Everstats knows; Enter on a name nobody matched opens it by address. */
function GuildSearch() {
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [res, setRes] = useState(null);
  useEffect(() => {
    const text = q.trim();
    if (text.length < 2) {
      setRes(null);
      return undefined;
    }
    let live = true;
    const t = setTimeout(() => {
      api(`/api/search?q=${encodeURIComponent(text)}`).then((r) => { if (live) setRes(r); }, () => { if (live) setRes({ guilds: [], failed: true }); });
    }, 200);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [q]);
  const submit = (e) => {
    e.preventDefault();
    if (res?.guilds?.length) return navigate(`/g/${encodeURIComponent(res.guilds[0].slug)}`);
    const slug = parseGuildSlug(q.trim().replace(/\s+/g, '-'));
    if (slug) navigate(`/g/${encodeURIComponent(slug)}`);
  };
  return (
    <section className="stack gap-10" aria-labelledby="guild-search-h">
      <h2 className="h3" id="guild-search-h">Find a guild</h2>
      <form role="search" className="search guild-search" onSubmit={submit}>
        <Icon name="search" size="sm" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Guild name" aria-label="Search guilds by name" autoComplete="off" spellCheck="false" maxLength={60} enterKeyHint="search" />
      </form>
      {res && (
        <div className="listbox" role="list" aria-label="Guilds found">
          {res.guilds.length === 0 ? (
            <div className="listrow"><span className="t2 small">{res.failed ? 'Search isn’t answering right now.' : <>No guild Everstats knows is called that. Press Enter to look “{q.trim()}” up at Blizzard.</>}</span></div>
          ) : res.guilds.map((g) => (
            <Link key={g.slug} role="listitem" className="listrow linkrow" to={`/g/${encodeURIComponent(g.slug)}`}>
              <span className="stack grow-col"><b>{g.name}</b><span className="muted xsmall">{[g.ruleset, g.faction, `${formatNumber(g.tracked)} tracked`].filter(Boolean).join(' · ')}</span></span>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
