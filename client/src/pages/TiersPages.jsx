import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import { Segmented } from '../components/Controls.jsx';
import { EmptyState, Provenance, UnrankedNote } from '../components/EmptyState.jsx';
import { ServiceUnavailable } from '../components/States.jsx';
import { RankedTable, RulesetSwitcher } from '../components/Stats.jsx';
import { TierLegend } from '../components/Tier.jsx';
import { formatNumber, timeAgo } from '../format.js';

/**
 * Tiers (0.6.0): "How tiers work" (/tiers/how) and the tier boards (/tiers).
 *
 * Everything here is read live from the API: the shares and minimums are the admin's current settings, and "what
 * counts" is the owner's current Discovery decisions (server/tiers/counting.js), never a list in this file. The design
 * has no page for either; both are built from its parts (panel, orn heading, tier badge, ranked table, empty states).
 */
export function HowTiersPage() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => {
    let live = true;
    api('/api/tiers/how').then((d) => { if (live) setData(d); }, (err) => { if (live) setError(err.message); });
    return () => {
      live = false;
    };
  }, []);
  if (error) return <div className="wrap page-pad"><ServiceUnavailable inline title="Couldn't load how tiers work">{error}</ServiceUnavailable></div>;
  const s = data?.settings;
  const counted = data ? data.categories.filter((c) => c.counted.length) : [];
  const ungraded = data ? data.categories.filter((c) => !c.counted.length) : [];
  return (
    <div className="wrap page-pad stack gap-32 how-tiers">
      <div className="stack gap-14">
        <h1 className="h1">How tiers work</h1>
        <p className="lead">Every tracked character gets one overall letter, S to D, from their whole career: how they compare with everyone else on the <b>same ruleset</b>. Each category gets its own letter too.</p>
        <span className="row gap-12 small"><Link to="/tiers">Tier boards</Link><Link to="/leaderboards">Leaderboards</Link></span>
      </div>

      <section className="panel pad-24 stack gap-14" aria-labelledby="letters-h">
        <h2 className="h2 h2-panel" id="letters-h">The letters</h2>
        {s ? <TierLegend shares={s.shares} minPopulation={s.minPopulation} /> : <span className="t2 small" role="status">Loading…</span>}
        <span className="muted xsmall">The same shares apply to every category letter and to the overall letter. They’re Everstats’ settings and can change; this page always shows the current ones.</span>
      </section>

      <section className="stack gap-14" aria-labelledby="steps-h">
        <div className="orn"><span className="gem" /><h2 className="h2" id="steps-h">How a letter is worked out</h2><span className="rule" /></div>
        <ol className="stack gap-12 how-steps">
          <li><b className="strong-text">A percentile for every graded statistic.</b> Your value is compared with every tier-eligible character on your ruleset: the share below you, plus half of those level with you. Ties get the same percentile. A statistic Blizzard doesn’t list for you counts as 0.</li>
          <li><b className="strong-text">A score for each category:</b> the average of your percentiles in that category’s graded statistics (0 to 100).</li>
          <li><b className="strong-text">A letter for each category,</b> from where that score places among everyone’s score in the same category on your ruleset{s ? ` (top ${s.shares.S}% S, and so on)` : ''}. It needs a value above zero in at least {s ? `${s.categoryHalf}%` : 'half'} of the category’s graded statistics, so one lucky statistic can’t earn an S.</li>
          <li><b className="strong-text">An overall score:</b> the average of your category scores, over the categories that count toward the overall tier. Each category weighs the same, however many statistics it has. A category you have no letter in still counts its score, so skipping one never helps.</li>
          <li><b className="strong-text">An overall letter,</b> from where that score places on your ruleset. It needs a letter in at least {s ? `${s.overallHalf}%` : 'half'} of the categories that count toward it.</li>
        </ol>
        <p className="t2 small">Everyone is graded again every few hours, after the daily refresh, and whenever what counts changes. A character you look up is graded straight after its fetch, against the ruleset’s last full grading, so other characters’ letters only move at the next full grading. Every character page has a “Why this tier” breakdown with each percentile behind its letters.</p>
      </section>

      <section className="stack gap-14" aria-labelledby="unranked-h">
        <div className="orn"><span className="gem" /><h2 className="h2" id="unranked-h">Why someone might be Unranked</h2><span className="rule" /></div>
        <ul className="stack gap-8 t2 small how-list">
          <li>Their ruleset has fewer than {s ? formatNumber(s.minPopulation) : 'the minimum of'} tier-eligible characters: percentiles mean little in a small crowd. Everyone there is Unranked until it fills up; leaderboards still work.</li>
          <li>They’re below level 10 or haven’t been fully fetched yet. Blizzard only shows characters from level 10.</li>
          <li>For a category letter: they have a value above zero in fewer than {s ? `${s.categoryHalf}%` : 'half'} of its graded statistics.</li>
          <li>For the overall letter: they have a letter in fewer than {s ? `${s.overallHalf}%` : 'half'} of the categories that count toward it.</li>
          <li>Hidden characters aren’t graded and aren’t on any board.</li>
        </ul>
        {data && data.rulesets.length > 0 && (
          <div className="listbox">
            {data.rulesets.map((r) => (
              <div key={r.id} className="listrow">
                <b>{r.name}</b>
                <span className="t2 small">{formatNumber(r.population)} tier-eligible characters</span>
                <span className="spacer" />
                {r.population >= s.minPopulation
                  ? <span className="tag ok">Graded{r.gradedAt ? ` · ${timeAgo(r.gradedAt)}` : ''}</span>
                  : <span className="tag warn">Opens at {formatNumber(s.minPopulation)}</span>}
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="stack gap-14" aria-labelledby="counts-h">
        <div className="orn"><span className="gem" /><h2 className="h2" id="counts-h">What counts</h2><span className="rule" /></div>
        <p className="t2 small">Every statistic gets a leaderboard, but only approved ones count toward a tier. “Bad” statistics (deaths and similar) never do. Farmable categories, which anyone can raise at will, get their own letter but don’t count toward the overall tier. Where two statistics count the same thing, only one is graded. A statistic not yet reviewed counts as nothing until it is.</p>
        {!data && <span className="t2 small" role="status">Loading…</span>}
        {data && counted.length === 0 && (
          <EmptyState kind="nodata" title="Nothing counts toward a tier yet">
            <span>No statistic has been approved for grading so far, so every character is Unranked. Leaderboards still work.</span>
          </EmptyState>
        )}
        <div className="stack gap-12">
          {counted.map((c) => (
            <div key={c.key} className="panel pad-20 stack gap-10">
              <div className="row gap-10">
                <h3 className="h3">{c.label}</h3>
                {c.inOverall ? <span className="tag gold">Counts toward overall</span> : c.farmable ? <span className="tag">Farmable: own letter only</span> : <span className="tag">Own letter only</span>}
                <span className="muted xsmall">{c.counted.length} graded statistic{c.counted.length === 1 ? '' : 's'}</span>
              </div>
              <p className="t2 small how-names">{c.counted.map((x) => x.name + (c.inOverall && !x.overall ? ' (category only)' : '')).join(' · ')}</p>
              <ExtraLists c={c} />
            </div>
          ))}
        </div>
        {ungraded.length > 0 && (
          <div className="panel pad-20 stack gap-10">
            <h3 className="h3">No graded stats yet</h3>
            {ungraded.map((c) => (
              <div key={c.key} className="stack gap-4">
                <b className="small">{c.label}</b>
                <ExtraLists c={c} />
              </div>
            ))}
          </div>
        )}
      </section>
      {data && <Provenance source="Everstats’ grading of Blizzard statistics" fetchedAt={data.lastGrading}><span className="muted">Last full grading</span></Provenance>}
    </div>
  );
}

function ExtraLists({ c }) {
  return (
    <>
      {c.bad.length > 0 && <span className="muted xsmall">Leaderboard only (bad): {c.bad.map((x) => x.name).join(' · ')}</span>}
      {c.named.length > 0 && <span className="muted xsmall">Leaderboard only (name + number): {c.named.map((x) => x.name).join(' · ')}</span>}
      {c.duplicate.length > 0 && <span className="muted xsmall">Graded once, through its twin: {c.duplicate.map((x) => `${x.name} (as ${x.ofName ?? 'another statistic'})`).join(' · ')}</span>}
      {c.undecided > 0 && <span className="muted xsmall">{c.undecided} statistic{c.undecided === 1 ? '' : 's'} not reviewed yet, so not counted.</span>}
    </>
  );
}

/**
 * Tier boards: a ruleset's characters by overall score with their letter, or by one category's score. Same rules as
 * the other boards: ties share a rank, hidden characters are on none, Unranked characters are counted but aren't
 * rows, and the page says how fresh the grading is.
 */
export function TierBoardPage() {
  const [params, setParams] = useSearchParams();
  const [data, setData] = useState(null);
  const [more, setMore] = useState({ rows: [], next: null, busy: false });
  const [error, setError] = useState(null);
  const asked = params.get('ruleset');
  const scope = params.get('scope') ?? 'overall';
  useEffect(() => {
    let live = true;
    setData(null);
    setError(null);
    setMore({ rows: [], next: null, busy: false });
    const q = new URLSearchParams({ ...(asked ? { ruleset: asked } : {}), scope });
    api(`/api/tiers/boards?${q}`).then((d) => { if (live) setData(d); }, (err) => { if (live) setError(err.message); });
    return () => {
      live = false;
    };
  }, [asked, scope]);
  const rs = data?.ruleset ?? null;
  const go = (next) => setParams(Object.fromEntries(Object.entries({ ruleset: rs?.id ? String(rs.id) : asked, scope, ...next }).filter(([k, v]) => v && !(k === 'scope' && v === 'overall'))));
  const loadMore = async () => {
    const cursor = more.next ?? data.next;
    setMore((m) => ({ ...m, busy: true }));
    try {
      const d = await api(`/api/tiers/boards?${new URLSearchParams({ ruleset: String(rs.id), scope, cursor })}`);
      setMore((m) => ({ rows: [...m.rows, ...d.rows], next: d.next, busy: false }));
    } catch (err) {
      setError(err.message);
      setMore((m) => ({ ...m, busy: false }));
    }
  };
  const rows = data ? [...data.rows, ...more.rows] : [];
  const next = more.rows.length ? more.next : data?.next;
  const label = scope === 'overall' ? 'Overall' : data?.categories?.find((c) => c.key === scope)?.label ?? scope;
  return (
    <div className="wrap page-pad stack gap-24">
      <div className="stack gap-14">
        <div className="row gap-12"><h1 className="h1">Tier boards</h1><span className="tag gold">Beta</span></div>
        <p className="lead">Characters ranked by their tier score on each ruleset: overall, or one category at a time. <Link to="/tiers/how">How tiers work</Link></p>
        {error && <ServiceUnavailable inline title="Couldn't load the tier board">{error}</ServiceUnavailable>}
        {data && data.rulesets.length > 0 && <RulesetSwitcher rulesets={data.rulesets} value={rs?.id} onChange={(id) => go({ ruleset: String(id) })} large />}
        {data?.graded && data.categories?.length > 0 && (
          <Segmented label="Board" options={[{ id: 'overall', label: 'Overall' }, ...data.categories.map((c) => ({ id: c.key, label: c.label }))]} value={scope} onChange={(id) => go({ scope: id })} />
        )}
      </div>
      {data && !rs && <EmptyState kind="nodata" title="No rulesets yet"><span>Rulesets appear as soon as Everstats tracks a character.</span></EmptyState>}
      {data && rs && !data.graded && (
        <UnrankedNote minPopulation={data.minPopulation} tracked={data.population} ruleset={rs.name} />
      )}
      {data && rs && data.graded && (
        <section className="stack gap-12" aria-label={`${label} tier board`}>
          <div className="row gap-12">
            <h2 className="h2">{label}</h2>
            <span className="t2 small"><b className="strong-text">{formatNumber(data.placed)}</b> graded on {rs.name} · {formatNumber(data.unranked)} Unranked (not listed)</span>
          </div>
          {data.placed === 0 ? (
            <EmptyState kind="nodata" title="Nobody has a letter here yet">
              <span>{scope === 'overall' ? 'No character meets the overall minimums yet.' : 'No character meets this category’s minimum yet.'} <Link to="/tiers/how">Why someone might be Unranked</Link></span>
            </EmptyState>
          ) : (
            <RankedTable
              valueLabel="Score"
              showMove={false}
              rows={rows.map((r) => ({ ...r, value: Math.round(r.score * 10) / 10, detail: [r.level !== null ? `Level ${r.level}` : null, r.class].filter(Boolean).join(' · ') }))}
            />
          )}
          {next && <button type="button" className="btn sm self-start" disabled={more.busy} onClick={loadMore}>Show more</button>}
          <Provenance source="Everstats’ grading of Blizzard statistics" fetchedAt={data.data?.newest ?? data.gradedAt}>
            <span className="muted">Full grading {data.gradedAt ? timeAgo(data.gradedAt) : 'not yet'}; characters looked up since are graded on their own</span>
          </Provenance>
        </section>
      )}
    </div>
  );
}
