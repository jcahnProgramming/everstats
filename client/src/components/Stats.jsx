import { Link } from 'react-router-dom';
import { CompassRing } from '../chrome/BrandMark.jsx';
import { Icon } from '../chrome/Icon.jsx';
import { formatNumber } from '../format.js';
import { Fresh } from './EmptyState.jsx';
import { TierBadge } from './Tier.jsx';

/**
 * The data components of design v1 (design/v1/components/*.md). Every one of them renders only what it is given:
 * there is no default value, sample row or placeholder number anywhere in this file. Until the discovery pass,
 * pages render their empty states instead of these.
 */

/** Rank pill: "#22 of 9,999", or the dashed "board opens at N" while the board isn't open. */
export function RankPill({ rank = null, of = null, to = null, opensAt = null }) {
  if (rank === null) {
    return <span className="rankpill pending">– board opens at {formatNumber(opensAt)}</span>;
  }
  const body = <><b>#{formatNumber(rank)}</b> of {formatNumber(of)}</>;
  return to ? <Link className="rankpill" to={to}>{body}</Link> : <span className="rankpill">{body}</span>;
}

/** Stat row (stat-row.md): name (+ "not graded" chip), value, rank pill, freshness. */
export function StatRow({ name, value, graded = true, rank = null, of = null, to = null, opensAt = null, fetchedAt = null }) {
  return (
    <div className="statrow">
      <span className="nm">{name}{!graded && <span className="ng">not graded</span>}</span>
      <span className="v">{formatNumber(value)}</span>
      <RankPill rank={rank} of={of} to={to} opensAt={opensAt} />
      <Fresh at={fetchedAt} />
    </div>
  );
}

export function StatRowHead() {
  return (
    <div className="statrow head eyebrow" aria-hidden="true">
      <span>Statistic</span><span className="r">Value</span><span>Rank</span><span>Data</span>
    </div>
  );
}

/** Stat card (stat-card.md): eyebrow label, big value, footer. A link when `to` is given. */
export function StatCard({ label, value, to = null, children }) {
  const body = (
    <>
      <span className="eyebrow">{label}</span>
      <span className="big">{typeof value === 'number' ? formatNumber(value) : value}</span>
      {children && <span className="row gap-8">{children}</span>}
    </>
  );
  return to ? <Link className="panel statcard" to={to}>{body}</Link> : <div className="panel statcard">{body}</div>;
}

/**
 * Category header (category-header.md). Expanded: badge, title, summary, "All boards". Collapsed: a full-width
 * button with a chevron. letter null → the Unranked "–"; graded false → "–" too, because bad statistics never tier.
 */
export function CategoryHeader({ title, summary, letter = null, boardsTo = null, collapsed = false, expanded, onToggle }) {
  const inner = (
    <>
      <TierBadge letter={letter} size={collapsed ? 'sm' : 'md'} />
      <span className="title">
        {collapsed ? <span className="h3 cat-title">{title}</span> : <h3>{title}</h3>}
        {summary && <span className="muted xsmall">{summary}</span>}
      </span>
      <span className="spacer" />
      {!collapsed && boardsTo && <Link className="xsmall" to={boardsTo}>All boards</Link>}
      {collapsed && <Icon name={expanded ? 'chevron-up' : 'chevron-down'} size="sm" />}
    </>
  );
  if (collapsed) {
    return <button type="button" className="cathead is-collapsed" aria-expanded={Boolean(expanded)} onClick={onToggle}>{inner}</button>;
  }
  return <div className="cathead">{inner}</div>;
}

/**
 * Ranked table (ranked-table-row.md): a dense table on desktop, the stacked .ranklist on phones. `rows` are real
 * board rows: { rank, slug, name, surname, detail, letter, guild, move, value, valueText, mine }. valueText: the name a
 * name + number statistic shows beside its number. `columns` is the header labels
 * (the last one names the statistic). With no rows it renders the header alone, for the caller to put an empty state
 * under, as design/v1/states/no-data-yet does.
 */
export function RankedTable({ valueLabel = 'Value', rows = [], showTier = true, showGuild = true, showMove = true }) {
  return (
    <div className="tblbox">
      <table className="tbl to-list">
        <thead>
          <tr>
            <th scope="col" aria-sort="ascending">Rank</th>
            <th scope="col">Character</th>
            {showTier && <th scope="col">Tier</th>}
            {showGuild && <th scope="col">Guild</th>}
            {showMove && <th scope="col" className="r">7-day</th>}
            <th scope="col" className="r">{valueLabel}</th>
          </tr>
        </thead>
        {rows.length > 0 && (
          <tbody>
            {rows.map((r) => (
              <tr key={r.slug} className={r.mine ? 'me' : undefined}>
                <td className={`rk${r.rank <= 3 ? ` r${r.rank}` : ''}`}>{formatNumber(r.rank)}</td>
                <td>
                  <div className="who">
                    <span className="stack">
                      <span className="row gap-6"><Link to={`/c/${encodeURIComponent(r.slug)}`}>{r.name} <span className="surname">{r.surname}</span></Link>{r.mine && <span className="tag you">You</span>}</span>
                      {r.detail && <span className="muted xsmall">{r.detail}</span>}
                    </span>
                  </div>
                </td>
                {showTier && <td><TierBadge letter={r.letter ?? null} size="sm" /></td>}
                {showGuild && <td className="t2">{r.guild ?? ''}</td>}
                {showMove && <td className={`r ${r.move > 0 ? 'up' : r.move < 0 ? 'down' : 'muted'}`}>{r.move > 0 ? `▲ ${r.move}` : r.move < 0 ? `▼ ${-r.move}` : '–'}</td>}
                <td className="r strong">{r.valueText && <span className="muted xsmall named">{r.valueText} · </span>}{formatNumber(r.value)}</td>
              </tr>
            ))}
          </tbody>
        )}
      </table>
      {rows.length > 0 && (
        <ol className="ranklist only-phone">
          {rows.map((r) => (
            <li key={r.slug} className={r.mine ? 'me' : undefined}>
              <Link to={`/c/${encodeURIComponent(r.slug)}`}>
                <span className={`rk${r.rank <= 3 ? ` r${r.rank}` : ''}`}>{formatNumber(r.rank)}</span>
                <span className="strong ellipsis">{r.name} {r.surname}</span>
                <span className="strong">{r.valueText && <span className="muted xsmall">{r.valueText} · </span>}{formatNumber(r.value)}</span>
                <span className="muted xsmall ellipsis">{r.detail}</span>
                {showTier && <TierBadge letter={r.letter ?? null} size="sm" />}
              </Link>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

/**
 * Ruleset switcher (ruleset-switcher.md). The rulesets come from Blizzard's own list (/api/coverage), NEVER from
 * this file: a new ruleset (Hardcore) appears by itself. The design's disabled "Hardcore · soon" segment is left
 * out, because it would be a ruleset typed in by hand. null (not loaded yet) renders nothing; the page says why.
 */
export function RulesetSwitcher({ rulesets, value, onChange, large = false, label = 'Ruleset' }) {
  if (!Array.isArray(rulesets) || rulesets.length === 0) return null;
  return (
    <div className={`seg phone-scroll${large ? ' lg' : ''}`} role="group" aria-label={label}>
      {rulesets.map((r) => (
        <button key={r.id} type="button" aria-pressed={r.id === value} onClick={() => onChange(r.id)}>{r.name}</button>
      ))}
    </div>
  );
}

/**
 * Character render frame (character-render-frame.md): hero gradient, compass ring, the render on top.
 *   src        the render's URL (from Blizzard's character-media, at runtime)
 *   pending    render still generating: spinner + "Portrait in progress" (design/v1/states/render-not-ready)
 *   children   anything else centred in the frame (an empty state)
 */
export function RenderFrame({ src = null, alt = '', pending = false, children = null }) {
  return (
    <div className="render" aria-busy={pending || undefined}>
      <CompassRing />
      {src && <img className="figure" src={src} alt={alt} />}
      {src && <span className="fade" />}
      {pending && (
        <div className="center">
          <Spinner size="xl" />
          <span className="h3">Portrait in progress</span>
          <span className="muted xsmall" role="status">Usually under a minute. Everything else on this page is live.</span>
        </div>
      )}
      {!src && !pending && children && <div className="center">{children}</div>}
    </div>
  );
}

/** The design's ring spinner (assets/illustrations/spinner.svg). Stops under prefers-reduced-motion. */
export function Spinner({ size = 'xl' }) {
  return (
    <svg className={`spin spinner ${size}`} viewBox="0 0 64 64" aria-hidden="true">
      <circle cx="32" cy="32" r="28" className="sp-track" />
      <path d="M32 4 A28 28 0 0 1 60 32" className="sp-arc" />
    </svg>
  );
}

/**
 * Gear slot (gear-slot.md). quality: poor | common | uncommon | rare | epic | legendary (from the API). An empty slot
 * (no item) is dashed, muted and not focusable. side 'right' mirrors it for the right-hand column.
 */
export function GearSlot({ slot, item = null, side = 'left' }) {
  if (!item) {
    return (
      <div className={`slot empty${side === 'right' ? ' right' : ''}`}>
        <span className="icon"><Icon name="item-slot" size="sm" /></span>
        <span className="txt stack ellipsis"><span className="nm">Empty</span><span className="meta">{slot}</span></span>
      </div>
    );
  }
  return (
    <div className={`slot qc-${item.quality}${side === 'right' ? ' right' : ''}`}>
      <span className="icon">{item.icon ? <img src={item.icon} alt="" /> : <Icon name="item-slot" size="sm" />}</span>
      <span className="txt stack ellipsis">
        <span className={`nm q-${item.quality} ellipsis`}>{item.name}</span>
        <span className="meta">{slot}{Number.isFinite(item.level) ? ` · ilvl ${item.level}` : ''}</span>
      </span>
    </div>
  );
}

/**
 * Chart container (chart-container.md): KPIs, then a line + area of daily snapshots. Fewer than two points → the
 * design's "Not enough history yet" box instead of a plot (never a line drawn from one value).
 *   points  [{ at: ISO date, value: number }] oldest first
 */
export function ChartContainer({ title, label, points = [], kpis = null, controls = null }) {
  const enough = points.length >= 2;
  let plot = null;
  if (enough) {
    const values = points.map((p) => p.value);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const span = max - min || 1;
    const xy = points.map((p, i) => [(i / (points.length - 1)) * 1000, 236 - ((p.value - min) / span) * 232]);
    const line = xy.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
    plot = (
      <div className="plot">
        <div className="yaxis"><span>{formatNumber(max)}</span><span>{formatNumber(Math.round((max + min) / 2))}</span><span>{formatNumber(min)}</span></div>
        <div className="stack gap-6">
          <svg className="area" viewBox="0 0 1000 240" preserveAspectRatio="none" role="img" aria-label={label}>
            <path className="grid-line" d="M0 0.5H1000M0 120H1000M0 239.5H1000" vectorEffect="non-scaling-stroke" />
            <polygon className="series-fill" points={`0,240 ${line} 1000,240`} />
            <polyline className="series" points={line} vectorEffect="non-scaling-stroke" />
          </svg>
          <div className="xaxis"><span>{points[0].at}</span><span>{points.at(-1).at}</span></div>
        </div>
      </div>
    );
  }
  return (
    <section className="panel chart" aria-label={title}>
      <div className="row gap-16 chart-head">
        <h2 className="h2">{title}</h2>
        {controls}
      </div>
      {kpis && <div className="kpis">{kpis}</div>}
      {plot ?? (
        <div className="empty-box chart-empty">
          <span className="h3">Not enough history yet</span>
          <span className="t2 small">A chart needs at least two daily snapshots. Everstats keeps one a day for every tracked character, forever.</span>
        </div>
      )}
    </section>
  );
}
