import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { formatNumber, timeAgo } from '../format.js';
import { Icon } from '../chrome/Icon.jsx';
import { TierBadge, letterRange } from './Tier.jsx';

/**
 * The tier parts of the character page (0.6.0), from GET /api/characters/:slug → tiers (server/tiers/view.js):
 *
 *   <OverallTier>   the large shield in the sheet's corner: the letter and where it sits, or Unranked and exactly why
 *   <WhyThisTier>   everything that fed the letters: each category's score and letter, and per counted statistic the
 *                   character's value and percentile, so a player can see how to improve. Never a bare letter.
 *
 * Different from the mockup (design/v1/pages/character): the category grid's cards open their own breakdown below
 * instead of jumping to the statistics, because the statistics sections now start collapsed.
 */
const score = (x) => (Number.isFinite(x) ? x.toFixed(1) : '–');

export function OverallTier({ tiers }) {
  if (!tiers) {
    return (
      <div className="row gap-18 char-tier">
        <div className="stack gap-4 char-tier-text"><span className="eyebrow">Overall tier</span><span className="h3">Not graded</span><span className="muted xsmall">Hidden characters aren't graded.</span></div>
        <TierBadge letter={null} size="lg" />
      </div>
    );
  }
  const o = tiers.overall;
  const letter = o?.letter ?? null;
  return (
    <div className="row gap-18 char-tier">
      <div className="stack gap-4 char-tier-text">
        <span className="eyebrow">Overall tier</span>
        {letter ? (
          <>
            <span className="h3">{letterRange(letter, tiers.settings.shares)}</span>
            <span className="muted xsmall">#{formatNumber(o.rank)} of {formatNumber(o.of)} graded · {tiers.ruleset?.name}</span>
          </>
        ) : (
          <>
            <span className="h3">Unranked</span>
            <span className="muted xsmall tier-reason">{(o?.reason ?? tiers.reason)?.text}</span>
          </>
        )}
        <span className="row gap-10 xsmall">
          {tiers.status === 'graded' && <a href="#why-tier">Why this tier</a>}
          <Link to="/tiers/how">How tiers work</Link>
        </span>
      </div>
      <TierBadge letter={letter} size="lg" label={letter ? `Overall tier ${letter}` : 'Unranked'} />
    </div>
  );
}

export function WhyThisTier({ tiers, name }) {
  const [open, setOpen] = useState(() => new Set());
  // "#why-<category>" opens that category's breakdown (the category cards link there).
  useEffect(() => {
    const fromHash = () => {
      const m = /^#why-(.+)$/.exec(window.location.hash);
      if (m && m[1] !== 'tier') setOpen((s) => new Set(s).add(m[1]));
    };
    fromHash();
    window.addEventListener('hashchange', fromHash);
    return () => {
      window.removeEventListener('hashchange', fromHash);
    };
  }, []);
  if (!tiers) return null;
  const toggle = (key) => setOpen((s) => {
    const n = new Set(s);
    if (n.has(key)) n.delete(key);
    else n.add(key);
    return n;
  });
  const rs = tiers.ruleset?.name ?? 'its ruleset';
  if (tiers.status !== 'graded') {
    return (
      <section id="why-tier" className="panel pad-24 stack gap-14" aria-labelledby="why-h">
        <h2 className="h2" id="why-h">Why this tier</h2>
        <div className="state state-unranked compact" role="status">
          <TierBadge letter={null} size="md" />
          <div className="stack gap-8 state-body">
            <span className="state-kind">Unranked</span>
            <strong className="state-title">{tiers.reason.text}</strong>
            {tiers.reason.code === 'ruleset_small' && tiers.minPopulation > 0 && (
              <div className="stack gap-6">
                <div className="bar warn"><span className="bar-fill" style={{ width: `${Math.min(100, (tiers.population / tiers.minPopulation) * 100)}%` }} /></div>
                <span className="muted xsmall">{formatNumber(tiers.population)} of {formatNumber(tiers.minPopulation)} tier-eligible characters on {rs} · every lookup counts</span>
              </div>
            )}
          </div>
        </div>
        <span className="small"><Link to="/tiers/how">How tiers work</Link></span>
      </section>
    );
  }
  const o = tiers.overall;
  const s = tiers.settings;
  const overallCats = tiers.categories.filter((c) => c.inOverall);
  return (
    <section id="why-tier" className="stack gap-18" aria-labelledby="why-h">
      <div className="orn"><span className="gem" /><h2 className="h2" id="why-h">Why this tier</h2><span className="rule" /><span className="muted xsmall">Graded against {formatNumber(tiers.population)} tier-eligible characters on {rs}</span></div>
      <div className="panel pad-20 stack gap-12">
        <div className="row gap-16 align-start">
          <TierBadge letter={o.letter} size="md" />
          <div className="stack gap-6 grow">
            <span className="strong-text">
              {o.letter ? <>Overall {o.letter} · {letterRange(o.letter, s.shares)} · #{formatNumber(o.rank)} of {formatNumber(o.of)} graded</> : <>Overall: Unranked</>}
            </span>
            <span className="t2 small">
              Overall score <b className="strong-text">{score(o.score)}</b> = the average of {name}'s scores in the {overallCats.length} categor{overallCats.length === 1 ? 'y' : 'ies'} that count toward the overall tier, each weighing the same.
              {' '}{name} has a letter in {o.lettered} of them; an overall letter needs {o.needed} ({s.overallHalf}%).
            </span>
            {o.reason && <span className="small tier-reason"><Icon name="info" size="sm" /> {o.reason.text}</span>}
            <span className="muted xsmall">
              Graded {timeAgo(tiers.computedAt)}{tiers.gradedBy === 'character'
                ? `, on its own right after its last fetch, against ${rs}'s last full grading (${timeAgo(tiers.gradedAt)}): everyone else's letters move at the next full grading`
                : `, with everyone on ${rs}`}. <Link to="/tiers/how">How tiers work</Link>
            </span>
          </div>
        </div>
      </div>

      <div className="grid-auto col-sm gap-10 tier-cards">
        {tiers.categories.map((c) => (
          <a key={c.key} className="panel row gap-12 tier-card" href={`#why-${c.key}`} onClick={() => setOpen((x) => new Set(x).add(c.key))}>
            <TierBadge letter={c.letter} size="md" />
            <span className="stack ellipsis">
              <span className="tier-card-title">{c.label}</span>
              <span className="muted xsmall">{c.letter ? `Score ${score(c.score)}` : 'Unranked'}{!c.inOverall ? ' · own tier' : ''}</span>
            </span>
          </a>
        ))}
      </div>

      <div className="stack gap-8">
        {tiers.categories.map((c) => {
          const isOpen = open.has(c.key);
          return (
            <div key={c.key} id={`why-${c.key}`} className="panel clip">
              <button type="button" className="cathead is-collapsed why-head" aria-expanded={isOpen} aria-controls={`why-body-${c.key}`} onClick={() => toggle(c.key)}>
                <TierBadge letter={c.letter} size="sm" />
                <span className="title">
                  <span className="h3 cat-title">{c.label}</span>
                  <span className="muted xsmall">
                    Score {score(c.score)} = the average percentile of {c.counted} statistic{c.counted === 1 ? '' : 's'} · {c.nonzero} above zero (a letter needs {c.needed ?? '–'}, {s.categoryHalf}%)
                    {c.letter ? ` · #${formatNumber(c.rank)} of ${formatNumber(c.of)}` : ''}{c.inOverall ? ' · counts toward the overall tier' : c.farmable ? ' · farmable: its own tier only' : ' · its own tier only'}
                  </span>
                </span>
                <span className="spacer" />
                <Icon name={isOpen ? 'chevron-up' : 'chevron-down'} size="sm" />
              </button>
              {isOpen && (
                <div id={`why-body-${c.key}`}>
                  {c.reason && <div className="pad-x-18 why-reason"><span className="small tier-reason"><Icon name="info" size="sm" /> {c.reason.text}</span></div>}
                  <div className="statrow head why-row" aria-hidden="true"><span className="eyebrow">Statistic</span><span className="eyebrow r">Value</span><span className="eyebrow r">Percentile</span><span className="eyebrow">Counts toward</span></div>
                  {c.statistics.map((st) => (
                    <div key={st.id} className="statrow why-row">
                      <span className="nm">{st.name ?? 'No longer available'}</span>
                      <span className="v">{st.text && <span className="named muted">{st.text} · </span>}{formatNumber(st.value)}</span>
                      <span className="v why-pct" title="0–100: the share of the ruleset below this value, plus half of those level with it">{Number.isFinite(st.percentile) ? st.percentile.toFixed(1) : '–'}</span>
                      <span className="muted xsmall">{st.overall ? 'Category + overall' : 'Category only'}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
      {tiers.ungraded.length > 0 && (
        <p className="muted small">No graded stats yet: {tiers.ungraded.map((u) => u.label).join(', ')}. These categories have leaderboards, but nothing in them counts toward a tier, so they're left out of the overall tier.</p>
      )}
    </section>
  );
}
