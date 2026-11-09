import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { parseSlug } from '../../../server/stats/slug.js';
import { api } from '../api.js';
import { Icon } from '../chrome/Icon.jsx';
import { EmptyState, Fresh, Provenance } from '../components/EmptyState.jsx';
import { CharacterLoading, CharacterNotFound, ServiceUnavailable } from '../components/States.jsx';
import { GearSlot, RankPill, RenderFrame } from '../components/Stats.jsx';
import { TierLegend } from '../components/Tier.jsx';
import { useToasts } from '../components/Toasts.jsx';
import { formatDateTime, formatNumber, timeAgo } from '../format.js';
import { useSession } from '../session.jsx';

/**
 * The character page (design/v1/pages/character): the gilt character sheet, then every statistic.
 *
 * GET /api/characters/:slug refreshes the character from Blizzard straight away (unless it was fetched in the last
 * ten minutes) and answers one of: ok · not_found (with what an account list told us, if anything) · hidden (by its
 * owner; the owner still sees it) · unavailable (Blizzard didn't answer, or keys aren't set).
 *
 * Different from the mockup, on purpose:
 *   - Tiers are the next build: the tier area says so ("Tiers coming soon") instead of a letter. No grade is faked,
 *     and the category headers show the "–" shield with the category's grading rule instead of a letter.
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
  const half = Math.ceil((c.equipment?.length ?? 0) / 2);
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
              {c.guild && <span className="tag gold">{c.guild.name}</span>}
              {c.mine && <span className="tag you">Yours</span>}
            </div>
            <h1 className="h-display char-name">{c.name} <span className="surname">{c.surname}</span></h1>
            <span className="t2 char-line">{line}{c.guild ? <> · <span className="guild-inline">&lt;{c.guild.name}&gt;</span></> : null}</span>
            <div className="row gap-14 small">
              <span className="t2">Last seen in game: <b className="strong-text">{c.lastLoginAt ? timeAgo(c.lastLoginAt) : 'not reported'}</b></span>
              <Fresh at={c.fetchedAt} prefix="Data as of " />
              <button type="button" className="btn ghost sm" onClick={onReload}><Icon name="refresh" size="sm" />Refresh</button>
            </div>
          </div>
          <div className="row gap-18 char-tier">
            <div className="stack gap-4 char-tier-text">
              <span className="eyebrow">Overall tier</span>
              <span className="h3">Tiers coming soon</span>
              <a className="xsmall" href="#how-graded">How it will be graded</a>
            </div>
            <span className="tier lg blank" role="img" aria-label="No tier yet: tiers are the next build"><b aria-hidden="true" /></span>
          </div>
        </div>
        <div className="grid-auto col-base gap-20 sheet-body">
          <Gear items={(c.equipment ?? []).slice(0, half)} label="Equipment" />
          <RenderFrame src={c.media.state === 'ok' ? c.media.render : null} alt={`${c.name} ${c.surname}, as Blizzard renders them`} pending={c.media.state !== 'ok'} />
          <Gear items={(c.equipment ?? []).slice(half)} side="right" label={c.equipment ? '' : null} />
          <div className="well stack core-stats">
            <span className="eyebrow">Core stats</span>
            {c.attributes?.length ? c.attributes.map((a) => (
              <div key={a.key} className="kv"><span className="t2">{a.label}</span><span className="num strong">{formatNumber(a.value)}{a.percent ? '%' : ''}</span></div>
            )) : <span className="muted xsmall">Blizzard didn't send core stats on the last fetch.</span>}
          </div>
        </div>
        <Provenance source="Blizzard: profile, equipment, statistics" fetchedAt={c.fetchedAt}>
          <span className="muted">Render: {c.media.state === 'ok' ? <>fetched {timeAgo(c.media.fetchedAt)} (renders lag the profile by hours)</> : 'not ready yet at Blizzard'}</span>
        </Provenance>
      </section>

      <Statistics stats={stats} character={c} count={statCount} />

      <section className="panel chart" aria-labelledby="progress-h">
        <div className="row gap-16"><h2 className="h2" id="progress-h">Progress</h2></div>
        <EmptyState kind="soon" compact title="Charts from the daily snapshots">
          <span>Everstats keeps a snapshot of {c.name}'s statistics every day, forever (tracked since {formatDateTime(c.trackedSince)}). The charts that draw them come in a later build.</span>
        </EmptyState>
      </section>

      <section id="how-graded" className="panel pad-24 stack gap-16" aria-labelledby="how-h">
        <h2 className="h2" id="how-h">How tiers will be graded</h2>
        <p className="t2">One letter per character, by percentile within their own ruleset only. Statistics roll up into category letters, and categories into the overall tier. Deaths and similar statistics get leaderboards but never count toward a tier. Tiers are the next build.</p>
        <TierLegend />
      </section>
    </>
  );
}

function Gear({ items, side = 'left', label }) {
  if (!items.length) {
    return (
      <div className="gear">
        {label !== null && <span className="eyebrow">{label}</span>}
        {label === 'Equipment' && <span className="muted xsmall">No equipment on the last fetch.</span>}
      </div>
    );
  }
  return (
    <div className="gear">
      <span className={`eyebrow${side === 'right' ? ' right-text' : ''}`}>{label || ' '}</span>
      {items.map((it) => <GearSlot key={`${it.slot}-${it.name}`} slot={it.slotName || it.slot} item={it} side={side} />)}
    </div>
  );
}

const PREVIEW = 6;

function Statistics({ stats, character: c, count }) {
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
  const rulesetName = c.ruleset?.name ?? 'its ruleset';
  return (
    <section id="stats" className="stack gap-18" aria-labelledby="stats-h">
      <div className="row gap-16">
        <h2 className="h1 stats-title" id="stats-h">Statistics</h2>
        <span className="muted">{formatNumber(count)} statistics · {stats.categories.length} categories</span>
        <span className="spacer" />
        {stats.ranked && <span className="t2 small">Ranked against <b className="strong-text">{formatNumber(stats.population)}</b> tracked on {rulesetName}</span>}
      </div>
      <p className="t2 small">Blizzard lists only what a character has done, so anything missing here is a zero. Beta: boards fill up as players join, so a rank today is out of everyone tracked so far.</p>
      <div className="grid-auto col-2xl gap-18 align-start-grid">
        {stats.categories.map((cat) => {
          const all = open.has(cat.key);
          const shown = all ? cat.statistics : cat.statistics.slice(0, PREVIEW);
          const rule = !cat.graded ? 'Not graded · leaderboards only' : cat.farmable ? 'Its own tier only, never the overall tier' : 'Counts toward the overall tier';
          return (
            <div key={cat.key} className="panel clip" id={`cat-${cat.key}`}>
              <div className="cathead">
                <span className="tier md u" role="img" aria-label="No tier yet"><b aria-hidden="true">–</b></span>
                <div className="title"><h3>{cat.label}</h3><span className="muted xsmall">{rule} · {cat.statistics.length} statistic{cat.statistics.length === 1 ? '' : 's'}</span></div>
                <span className="spacer" />
                <Link className="xsmall" to={`/leaderboards?ruleset=${c.ruleset?.id ?? ''}#${cat.key}`}>All boards</Link>
              </div>
              <div className="statrow head" aria-hidden="true"><span className="eyebrow">Statistic</span><span className="eyebrow r">Value</span><span className="eyebrow">Rank</span><span className="eyebrow">Data</span></div>
              {shown.map((s) => (
                <div key={s.id} className="statrow">
                  <span className="nm">
                    {s.name}
                    {s.grading === 'none' && <span className="ng">not graded</span>}
                    {pins && (
                      <button type="button" className={`pin-btn${pins.includes(s.id) ? ' is-pinned' : ''}`} aria-pressed={pins.includes(s.id)} aria-label={`${pins.includes(s.id) ? 'Unpin' : 'Pin'} ${s.name}`} title={pins.includes(s.id) ? 'Pinned to your dashboard' : 'Pin to your dashboard'} onClick={() => togglePin(s.id, s.name)}>
                        <Icon name={pins.includes(s.id) ? 'check' : 'plus'} size="sm" />
                      </button>
                    )}
                  </span>
                  <span className="v">{s.text && <span className="named muted">{s.text} · </span>}{formatNumber(s.value)}</span>
                  {!stats.ranked ? <span className="rankpill pending">hidden: not ranked</span>
                    : s.tied ? <Link className="rankpill pending" to={`/leaderboards/${c.ruleset.id}/${s.id}`}>everyone tied</Link>
                      : <RankPill rank={s.rank} of={stats.population} to={`/leaderboards/${c.ruleset.id}/${s.id}`} />}
                  <Fresh at={c.statsFetchedAt} />
                </div>
              ))}
              {cat.statistics.length > PREVIEW && (
                <button type="button" className="showall showall-btn" aria-expanded={all} onClick={() => setOpen((o) => {
                  const n = new Set(o);
                  if (n.has(cat.key)) n.delete(cat.key);
                  else n.add(cat.key);
                  return n;
                })}>{all ? 'Show fewer' : `Show all ${cat.statistics.length} →`}</button>
              )}
            </div>
          );
        })}
      </div>
      {stats.categories.length === 0 && <EmptyState kind="nodata" title="No statistics yet"><span>Blizzard sent no statistics for this character on the last fetch.</span></EmptyState>}
    </section>
  );
}
