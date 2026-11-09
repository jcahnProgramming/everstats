import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { parseSlug } from '../../../server/stats/slug.js';
import { api } from '../api.js';
import { Icon } from '../chrome/Icon.jsx';
import { EmptyState, Fresh, Provenance } from '../components/EmptyState.jsx';
import { CharacterLoading, CharacterNotFound, ServiceUnavailable } from '../components/States.jsx';
import { RankPill, RenderFrame } from '../components/Stats.jsx';
import { GearSheet } from '../components/GearSheet.jsx';
import { groupCoreStats } from '../coreStats.js';
import { TierBadge } from '../components/Tier.jsx';
import { OverallTier, WhyThisTier } from '../components/TierBreakdown.jsx';
import { useToasts } from '../components/Toasts.jsx';
import { NameWithBadge } from '../badges/Badges.jsx';
import { formatDate, formatDateTime, formatNumber, timeAgo } from '../format.js';
import { useSession } from '../session.jsx';

/**
 * The character page (design/v1/pages/character): the gilt character sheet, then every statistic.
 *
 * GET /api/characters/:slug refreshes the character from Blizzard straight away (unless it was fetched in the last
 * ten minutes) and answers one of: ok · not_found (with what an account list told us, if anything) · hidden (by its
 * owner; the owner still sees it) · unavailable (Blizzard didn't answer, or keys aren't set).
 *
 * Different from the mockup, on purpose:
 *   - 0.6.0: the overall tier (or Unranked, with the reason in words) and "Why this tier" (components/TierBreakdown.jsx):
 *     every letter comes with what fed it. Statistics sections are full width and start collapsed (the mockup's
 *     multi-column cards left gaps); each collapsed header still says the category's letter, size and best rank.
 *   - No Progress chart or Share button yet; the Refresh button is the page reload (a lookup refreshes).
 *   - Gear slots are split in two columns as Blizzard lists them (no fixed slot list: whatever the API returns).
 */
export function CharacterPage() {
  const { slug } = useParams();
  const parsed = parseSlug(slug);
  const [result, setResult] = useState(null); // null = waiting · body · { error }

  const load = useCallback(async () => {
    if (!parsed) return;
    setResult(null);
    try {
      setResult(await api(`/api/characters/${encodeURIComponent(parsed.slug)}`));
    } catch (err) {
      setResult({ error: err });
    }
  }, [parsed?.slug]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    load();
  }, [load]);

  if (!parsed) {
    return (
      <div className="wrap page-pad stack gap-24">
        <h1 className="h1">That isn't a character address</h1>
        <EmptyState kind="nocoverage" title="Characters are looked up by name and surname">
          <span>A character's address is <span className="mono">/c/name-surname</span>, and this one doesn't have that shape. Use the search at the top of the page, or <Link to="/">the one on the home page</Link>.</span>
        </EmptyState>
      </div>
    );
  }

  let body;
  if (result === null) {
    body = <CharacterLoading name={parsed.name} surname={parsed.surname} />;
  } else if (result.error) {
    const e = result.error;
    body = e.status === 429 ? (
      <ServiceUnavailable title="Too many look-ups from your network" onRetry={load} detail="Look-ups that ask Blizzard are limited to 30 every 15 minutes per network.">
        Wait a few minutes and try again. Characters someone looked up in the last ten minutes still open.
      </ServiceUnavailable>
    ) : (
      <ServiceUnavailable title="Can't reach Everstats" onRetry={load}>{e.message}</ServiceUnavailable>
    );
  } else if (result.status === 'not_found') {
    body = (
      <CharacterNotFound name={parsed.name} surname={parsed.surname} known={result.known}>
        <Link className="btn gold self-start" to="/">Search again</Link>
      </CharacterNotFound>
    );
  } else if (result.status === 'hidden') {
    body = (
      <div className="stack gap-16 narrow-panel">
        <h1 className="h2">{parsed.name} {parsed.surname}</h1>
        <EmptyState kind="hidden" title="This character is hidden by its owner">
          <span>Its owner asked Everstats not to show it: it has no public page and is on no leaderboard.</span>
        </EmptyState>
      </div>
    );
  } else if (result.status === 'missing') {
    body = (
      <section className="stack gap-16 narrow-panel">
        <h1 className="h2">{result.name} {result.surname}</h1>
        <EmptyState kind="couldnt" title={`Blizzard hasn’t returned this character since ${formatDate(result.since)}`}>
          <span>It may have been deleted, renamed, transferred or made private. Everstats keeps checking on the usual schedule; until Blizzard returns it, none of its old numbers are shown or ranked.</span>
          <span>Blizzard’s rules let Everstats keep its data for at most 30 days, so if it doesn’t come back by then, everything Everstats had about it is deleted.</span>
        </EmptyState>
      </section>
    );
  } else if (result.status === 'unavailable') {
    body = (
      <section className="stack gap-16 narrow-panel">
        <h1 className="h2">{parsed.name} {parsed.surname}</h1>
        <EmptyState kind="couldnt" title={result.reason === 'not_configured' ? 'Look-ups aren’t switched on yet' : 'We couldn’t check Blizzard just now'} action={result.reason === 'not_configured' ? null : <button type="button" className="btn sm self-start" onClick={load}><Icon name="refresh" size="sm" />Try again</button>}>
          <span>{result.reason === 'not_configured'
            ? 'Everstats can’t ask Blizzard for characters until its keys are set. This says nothing about whether the character exists.'
            : 'Blizzard didn’t answer in time. This says nothing about whether the character exists: try again in a minute.'}</span>
        </EmptyState>
      </section>
    );
  } else {
    body = <CharacterSheet data={result} onReload={load} />;
  }
  return <div className="wrap page-pad stack gap-40">{body}</div>;
}

const NOTICES = {
  rate_limited: 'You’ve looked up a lot of characters from this network, so this is what Everstats already had, not a fresh fetch.',
  slow: 'Blizzard was slow to answer, so this is what Everstats already had.',
  unavailable: 'Blizzard didn’t answer just now, so this is what Everstats already had.',
  not_configured: 'Look-ups are switched off, so this is what Everstats already had.',
};

function CharacterSheet({ data, onReload }) {
  const c = data.character;
  const stats = data.statistics;
  const line = [c.level !== null ? `Level ${c.level}` : null, c.race, c.class].filter(Boolean).join(' · ');
  const statCount = stats.categories.reduce((n, cat) => n + cat.statistics.length, 0);
  return (
    <>
      {data.notice && <div className="note warn small" role="status"><Icon name="warning" /><span className="grow">{NOTICES[data.notice]} Data as of {formatDateTime(c.fetchedAt)}.</span></div>}
      {c.hidden && <EmptyState kind="hidden" compact title="Hidden: only you can see this page"><span>It's on no leaderboard and has no public page. Show it again in <Link to="/settings#characters">Settings</Link>.</span></EmptyState>}
      <section className="sheet stack gap-24 sheet-pad" aria-label="Character sheet">
        <div className="row gap-24 sheet-top">
          <div className="stack gap-10 char-ident">
            <div className="row gap-8">
              {c.ruleset && <Link className="tag" to={`/leaderboards?ruleset=${c.ruleset.id}`}>{c.ruleset.name}</Link>}
              {c.faction && <span className="tag">{c.faction}</span>}
              {c.guild && <Link className="tag gold" to={`/g/${encodeURIComponent(c.guild.slug)}`}>{c.guild.name}</Link>}
              {c.mine && <span className="tag you">Yours</span>}
            </div>
            <h1 className="h-display char-name">{c.name} <span className="surname">{c.surname}</span></h1>
            {c.claimedBy && <span className="claimed">Claimed by <NameWithBadge username={c.claimedBy.username} badge={c.claimedBy.badge} /></span>}
            <span className="t2 char-line">{line}{c.guild ? <> · <Link className="guild-inline" to={`/g/${encodeURIComponent(c.guild.slug)}`}>&lt;{c.guild.name}&gt;</Link></> : null}</span>
            <div className="row gap-14 small">
              <span className="t2">Last seen in game: <b className="strong-text">{c.lastLoginAt ? timeAgo(c.lastLoginAt) : 'not reported'}</b></span>
              <Fresh at={c.fetchedAt} prefix="Data as of " />
              <button type="button" className="btn ghost sm" onClick={onReload}><Icon name="refresh" size="sm" />Refresh</button>
            </div>
          </div>
          <OverallTier tiers={data.tiers} />
        </div>
        <div className="stack gap-20 sheet-body">
          <GearSheet
            equipment={c.equipment}
            render={<RenderFrame src={c.media.state === 'ok' ? c.media.render : null} alt={`${c.name} ${c.surname}, as Blizzard renders them`} pending={c.media.state !== 'ok'} />}
          />
          {!c.equipment?.length && <span className="muted xsmall">No equipment on the last fetch.</span>}
          <CoreStats attributes={c.attributes} equipment={c.equipment} />
        </div>
        <Provenance source="Blizzard Entertainment’s game data API: profile, equipment, statistics" fetchedAt={c.fetchedAt}>
          <span className="muted">Render: {c.media.state === 'ok' ? <>fetched {timeAgo(c.media.fetchedAt)} (renders lag the profile by hours)</> : 'not ready yet at Blizzard'}</span>
        </Provenance>
      </section>

      <WhyThisTier tiers={data.tiers} name={c.name} />

      <Statistics stats={stats} character={c} count={statCount} tiers={data.tiers} />

      <section className="panel chart" aria-labelledby="progress-h">
        <div className="row gap-16"><h2 className="h2" id="progress-h">Progress</h2></div>
        <EmptyState kind="soon" compact title="Charts from the daily snapshots">
          <span>Everstats keeps a snapshot of {c.name}'s statistics every day, forever (tracked since {formatDateTime(c.trackedSince)}). The charts that draw them come in a later build.</span>
        </EmptyState>
      </section>
    </>
  );
}

/**
 * Core stats grouped like the in-game character sheet (coreStats.js), as cards in a grid that fills the sheet's width:
 * as many columns as fit, down to one on a phone. Only what Blizzard returned; an empty group isn't drawn.
 */
function CoreStats({ attributes, equipment }) {
  const groups = groupCoreStats(attributes, equipment);
  if (!groups.length) return <span className="muted xsmall">Blizzard didn't send core stats on the last fetch.</span>;
  return (
    <section className="stack gap-10 core-section" aria-labelledby="core-h">
      <h2 className="eyebrow" id="core-h">Core stats</h2>
      <div className="core-grid">
        {groups.map((g) => (
          <div key={g.id} className="well core-card">
            <h3 className="eyebrow core-card-title">{g.label}</h3>
            {g.rows.map((r) => <div key={r.key} className="kv core-kv"><span className="t2 core-label" title={r.label}>{r.label}</span><span className="num strong core-value" title={r.exact ?? undefined}>{r.value}</span></div>)}
          </div>
        ))}
      </div>
    </section>
  );
}

/**
 * One category's line when collapsed (0.6.0): its letter, its size and the character's best rank in it, e.g.
 * "B · 11 statistics · Best: #3 Total deaths", so the collapsed page still tells the story.
 *   tier: the category's tier entry (graded ruleset), undefined (graded ruleset, nothing in it counts), null (no tiers)
 */
function categorySummary(cat, tier) {
  let head;
  if (tier) head = tier.letter ?? 'Unranked';
  else if (tier === undefined) head = 'No graded stats yet';
  else head = cat.graded ? 'No letter' : 'Not graded';
  const ranked = cat.statistics.filter((s) => s.rank !== null).sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name));
  const best = ranked[0] ? `Best: #${formatNumber(ranked[0].rank)} ${ranked[0].name}` : 'No ranks yet';
  return `${head} · ${cat.statistics.length} statistic${cat.statistics.length === 1 ? '' : 's'} · ${best}`;
}

/**
 * Every statistic, one full-width section per category (0.6.0). Each header is a real button (aria-expanded; Enter
 * and Space work because it IS a button) that opens and closes its own section; all start collapsed, and nothing is
 * remembered, so a reload starts collapsed again. "All boards" sits beside the button, never inside it, so it
 * navigates without toggling.
 */
function Statistics({ stats, character: c, count, tiers }) {
  const session = useSession();
  const toast = useToasts();
  const [open, setOpen] = useState(() => new Set());
  const [pins, setPins] = useState(null);
  useEffect(() => {
    if (!session.signedIn) return undefined;
    let live = true;
    api('/api/account/pins').then((r) => { if (live) setPins(r.pinIds); }, () => {});
    return () => {
      live = false;
    };
  }, [session.signedIn]);
  const togglePin = async (id, name) => {
    const next = pins.includes(id) ? pins.filter((x) => x !== id) : [...pins, id];
    try {
      setPins((await api('/api/account/pins', { method: 'PUT', body: { statisticIds: next } })).pinIds);
      toast.ok(next.includes(id) ? 'Pinned to your dashboard' : 'Unpinned', name);
    } catch (err) {
      toast.err("Couldn't change your pins", err.message);
    }
  };
  const toggle = (key) => setOpen((o) => {
    const n = new Set(o);
    if (n.has(key)) n.delete(key);
    else n.add(key);
    return n;
  });
  const graded = tiers?.status === 'graded';
  const tierBy = new Map((graded ? tiers.categories : []).map((t) => [t.key, t]));
  const rulesetName = c.ruleset?.name ?? 'its ruleset';
  return (
    <section id="stats" className="stack gap-18" aria-labelledby="stats-h">
      <div className="row gap-16">
        <h2 className="h1 stats-title" id="stats-h">Statistics</h2>
        <span className="muted">{formatNumber(count)} statistics · {stats.categories.length} categories</span>
        <span className="spacer" />
        {stats.ranked && <span className="t2 small"><b className="strong-text">{formatNumber(stats.population)}</b> tracked on {rulesetName}</span>}
      </div>
      <p className="t2 small">Blizzard lists only what a character has done, so anything missing here is a zero, and a zero isn't ranked. “#1 of 3 with any” means three tracked characters have done it at all. Open a category to see every statistic in it.</p>
      <div className="stack gap-8">
        {stats.categories.map((cat) => {
          const isOpen = open.has(cat.key);
          const t = graded ? tierBy.get(cat.key) : null;
          return (
            <div key={cat.key} className="panel clip" id={`cat-${cat.key}`}>
              <div className={`cathead cat-toggle${isOpen ? '' : ' is-collapsed'}`}>
                <button type="button" className="cat-toggle-btn" aria-expanded={isOpen} aria-controls={`cat-body-${cat.key}`} onClick={() => toggle(cat.key)}>
                  <TierBadge letter={t?.letter ?? null} size="md" label={t?.letter ? `${cat.label}: tier ${t.letter}` : `${cat.label}: no letter`} />
                  <span className="title">
                    <h3>{cat.label}</h3>
                    <span className="muted xsmall">{categorySummary(cat, t)}</span>
                  </span>
                  <span className="spacer" />
                  <Icon name={isOpen ? 'chevron-up' : 'chevron-down'} size="sm" />
                </button>
                <Link className="xsmall cat-boards" to={`/leaderboards?ruleset=${c.ruleset?.id ?? ''}#${cat.key}`}>All boards</Link>
              </div>
              {isOpen && (
                <div id={`cat-body-${cat.key}`}>
                  <div className="statrow head" aria-hidden="true"><span className="eyebrow">Statistic</span><span className="eyebrow r">Value</span><span className="eyebrow">Rank</span><span className="eyebrow">Data</span></div>
                  {cat.statistics.map((s) => (
                    <div key={s.id} className="statrow">
                      <span className="nm">
                        {s.name}
                        {s.tierRole !== 'counted' && <span className="ng" title={s.tierRole === 'undecided' ? 'Not reviewed yet, so it doesn’t count toward a tier' : 'Leaderboard only: never counts toward a tier'}>{s.tierRole === 'undecided' ? 'not graded yet' : 'not graded'}</span>}
                        {pins && (
                          <button type="button" className={`pin-btn${pins.includes(s.id) ? ' is-pinned' : ''}`} aria-pressed={pins.includes(s.id)} aria-label={`${pins.includes(s.id) ? 'Unpin' : 'Pin'} ${s.name}`} title={pins.includes(s.id) ? 'Pinned to your dashboard' : 'Pin to your dashboard'} onClick={() => togglePin(s.id, s.name)}>
                            <Icon name={pins.includes(s.id) ? 'check' : 'plus'} size="sm" />
                          </button>
                        )}
                      </span>
                      <span className="v">{s.text && <span className="named muted">{s.text} · </span>}{formatNumber(s.value)}</span>
                      {!stats.ranked ? <span className="rankpill pending">hidden: not ranked</span>
                        : <RankPill rank={s.rank} of={s.withAny} to={`/leaderboards/${c.ruleset.id}/${s.id}`} />}
                      <Fresh at={c.statsFetchedAt} />
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
      {stats.categories.length === 0 && <EmptyState kind="nodata" title="No statistics yet"><span>Blizzard sent no statistics for this character on the last fetch.</span></EmptyState>}
    </section>
  );
}
