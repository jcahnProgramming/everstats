import { Link } from 'react-router-dom';
import { Icon } from '../chrome/Icon.jsx';
import { formatDate, formatNumber, timeAgo } from '../format.js';
import { GLYPHS } from './glyphs.js';

/**
 * Collections building blocks (0.9.0), from design/v4-collections/components/*.md; styles are the design's
 * theme/collections.css (verbatim). Different from the mockups, on purpose:
 *   - No native <select>: the filter bar's selects are segmented buttons (CLAUDE.md).
 *   - No `.anno` tags (mockup-only), no Source filter and no "Drops from" line (Forever has no journal data: every
 *     missing item gets the Wowhead text link instead), no Housing (Blizzard 404s it), Legacy is Legacy POINTS.
 *   - Icons are Blizzard's own images from render.worldofwarcraft.com when the catalog has one, else the design's glyph.
 */
export function Glyph({ name, className = 'cg', title = null }) {
  const inner = GLYPHS[name] ?? GLYPHS.category;
  // Static strings from glyphs.js (the design's own SVG paths): no user data ever reaches this.
  return <svg className={className} viewBox="0 0 24 24" aria-hidden={title ? undefined : 'true'} role={title ? 'img' : undefined} aria-label={title ?? undefined} dangerouslySetInnerHTML={{ __html: inner }} />;
}

export const pct = (have, total) => (total ? Math.floor((have / total) * 100) : 0);

/** Copper → "12g 34s 56c" (WoW money). Negative never happens for Blizzard's fields; null → "—". */
export function formatMoney(copper) {
  if (copper === null || copper === undefined || !Number.isFinite(copper)) return '—';
  const g = Math.floor(copper / 10000);
  const s = Math.floor((copper % 10000) / 100);
  const c = copper % 100;
  return `${g ? `${formatNumber(g)}g ` : ''}${g || s ? `${s}s ` : ''}${c}c`;
}

/** "Shared across this account": the glyph is never shown without its words. */
export function AccountMarker({ shared, short = false, tagged = false }) {
  if (!shared) return null;
  const text = shared.partial ? `${formatNumber(shared.wide)} account-wide` : short ? 'Account' : 'Shared across this account';
  const why = shared.how === 'stated'
    ? (shared.partial ? 'Blizzard marks these achievements as account-wide.' : 'Blizzard says this is shared across the Battle.net account.')
    : 'Every character Everstats has fetched on this account has the identical collection.';
  return (
    <span className={`acct${tagged ? ' tagged' : ''}`} title={why}>
      <svg viewBox="0 0 24 24" aria-hidden="true" dangerouslySetInnerHTML={{ __html: GLYPHS.acct }} />
      <span>{text}</span>
    </span>
  );
}

/** Completion bar (completion-bar.md): only with a catalog; without one, the plain count. */
export function CompletionBar({ label, have, total, large = false }) {
  if (!total) return <div className="cbig"><b>{formatNumber(have)}</b><span>{label}</span></div>;
  const p = pct(have, total);
  return (
    <div className={`cbar${large ? ' lg' : ''}${have >= total ? ' done' : ''}`}>
      <div className="hd"><span className="lbl">{label}</span><span className="num"><b>{formatNumber(have)}</b> / {formatNumber(total)} · {p}%</span></div>
      <div className="bar" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={have} aria-label={`${label}: ${have} of ${total}`}><span style={{ width: `${Math.min(100, (have / total) * 100)}%` }} /></div>
    </div>
  );
}

const QUALITY_CLASS = new Set(['poor', 'common', 'uncommon', 'rare', 'epic', 'legendary']);

/** A collection tile (collection-tile.md): collected vs missing by edge, icon, corner mark AND the word "Missing". */
export function Tile({ item, glyph, onSelect = null, selected = false, size = '', sub = null, bare = false }) {
  const q = QUALITY_CLASS.has(item.quality) ? ` qc-${item.quality}` : '';
  const cls = `ctile${size ? ` ${size}` : ''}${q}${item.collected ? '' : ' is-missing'}${onSelect ? '' : ' static'}`;
  const name = item.name ?? `#${item.id}`;
  const body = (
    <>
      <span className="ic">
        {item.icon ? <img src={item.icon} alt="" loading="lazy" referrerPolicy="no-referrer" /> : <Glyph name={glyph} />}
        {item.level !== undefined && item.level !== null && <span className="lvl" aria-label={`level ${item.level}`}>{item.level}</span>}
        <span className="mk" aria-hidden="true"><svg viewBox="0 0 24 24" dangerouslySetInnerHTML={{ __html: GLYPHS.check }} /></span>
      </span>
      {!bare && <span className="nm">{name}</span>}
      {bare ? null : !item.collected ? <span className="sub">Missing</span> : sub ? <span className="sub">{sub}</span> : null}
    </>
  );
  const label = `${name}, ${item.collected ? 'collected' : 'missing'}`;
  // 0.9.2: the name shows two lines before it's cut; the whole name is in the tooltip and the accessible name.
  if (!onSelect) return <div className={cls} role="listitem" aria-label={label} title={name}>{body}</div>;
  return <button type="button" className={cls} aria-pressed={selected} aria-label={label} title={name} onClick={() => onSelect(item)}>{body}</button>;
}

/** missing: false while there is no complete catalog (no missing tiles can be drawn, so the key leaves them out). */
export function Legend({ missing = true }) {
  return (
    <div className="legend" aria-label="How to read the tiles">
      <span className="ctile static"><span className="ic"><span className="mk" aria-hidden="true"><svg viewBox="0 0 24 24" dangerouslySetInnerHTML={{ __html: GLYPHS.check }} /></span></span><span>Collected: solid edge, full icon, check</span></span>
      {missing && <span className="ctile static is-missing"><span className="ic"><span className="mk" aria-hidden="true" /></span><span>Missing: dashed edge, faded icon, hollow ring</span></span>}
    </div>
  );
}

/** Standing bar (standing-bar.md): 8 steps, Hated → Exalted; colour is never the only cue. */
export const STANDINGS = ['Hated', 'Hostile', 'Unfriendly', 'Neutral', 'Friendly', 'Honored', 'Revered', 'Exalted'];
export function StandingBar({ rep }) {
  const step = Number.isInteger(rep.tier) && rep.tier >= 0 && rep.tier < 8 ? rep.tier : STANDINGS.indexOf(rep.standing);
  const known = step >= 0;
  const exalted = rep.standing === 'Exalted';
  const part = rep.max ? Math.max(0, Math.min(1, (rep.value ?? 0) / rep.max)) : exalted ? 1 : 0;
  const label = `${rep.name}: ${rep.standing ?? 'unknown'}${known ? `, step ${step + 1} of 8` : ''}`;
  return (
    <div className={`standing${known ? ` st-${STANDINGS[step].toLowerCase()}` : ''}`} role="group" aria-label={label}>
      <div className="hd">
        <span className="nm">{rep.name ?? `Faction ${rep.id}`}</span>
        <span className="lv">{exalted && <Icon name="check" size="sm" />}{rep.standing ?? '—'}{known && <i>step {step + 1} of 8</i>}</span>
      </div>
      <div className="track" aria-hidden="true">
        {STANDINGS.map((s, i) => (
          <i key={s} className={known && i < step ? 'on' : known && i === step ? (exalted ? 'on' : 'cur') : ''}>
            {known && i === step && !exalted && <b style={{ width: `${part * 100}%` }} />}
          </i>
        ))}
      </div>
      <div className="ft">
        <span>{rep.max ? `${formatNumber(rep.value)} / ${formatNumber(rep.max)}` : exalted ? 'Maxed' : ''}</span>
        <span>{exalted ? 'Maxed' : known ? `${7 - step} step${7 - step === 1 ? '' : 's'} to Exalted` : ''}</span>
      </div>
    </div>
  );
}

/** Count card (count-card.md): glyph, count, label, pin, board rank and account marker; `.is-off` before any data. */
export function CountCard({ count, glyph, pinned = null, onPin = null, boardTo = null, style = undefined }) {
  const off = count.value === null;
  return (
    <div className={`ccount${pinned ? ' is-pinned' : ''}${off ? ' is-off' : ''}`} style={style}>
      <Glyph name={glyph} />
      <span className="n num">{off ? '—' : formatNumber(count.value)}{!off && count.total ? <small> / {formatNumber(count.total)}</small> : null}</span>
      {onPin && !off && (
        <button type="button" className="pinbtn" aria-pressed={Boolean(pinned)} aria-label={`${pinned ? 'Unpin' : 'Pin'} ${count.name} ${pinned ? 'from' : 'to'} your dashboard`} title={pinned ? 'Pinned to your dashboard' : 'Pin to your dashboard'} onClick={onPin}>
          <svg viewBox="0 0 24 24" aria-hidden="true" dangerouslySetInnerHTML={{ __html: GLYPHS.pin }} />
        </button>
      )}
      <span className="l">{count.name}</span>
      <div className="ft">
        {off ? <span className="muted">Loads on the next refresh</span>
          : count.rank ? <Link className="rankpill" to={boardTo}><b>#{formatNumber(count.rank)}</b> on board</Link>
            : boardTo ? <Link className="rankpill not-ranked" to={boardTo}>{count.value ? 'Board' : 'Not ranked'}</Link> : <span className="rankpill not-ranked">Not ranked</span>}
        <AccountMarker shared={count.shared} short />
      </div>
    </div>
  );
}

/** "No mounts yet": honest zero, with when it was last checked. */
export function CollectionEmpty({ glyph, what, checkedAt }) {
  return (
    <div className="cempty">
      <Glyph name={glyph} className="cg lg" />
      <span className="h3">No {what} yet</span>
      <span className="small t2">Blizzard returned an empty list{checkedAt ? ` when Everstats last checked (${timeAgo(checkedAt)})` : ''}.</span>
    </div>
  );
}

/** "Blizzard didn't return this", with the last good copy's date and the status code. */
export function NotReturned({ status, fetchedAt, onRetry = null }) {
  return (
    <div className="cunavail" role="status">
      <svg className="ico" width="32" height="32" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" dangerouslySetInnerHTML={{ __html: GLYPHS.unavailable }} />
      <div className="stack gap-6">
        <b>Blizzard didn’t return this</b>
        <span className="small">
          {status ? `It answered ${status === 404 ? '404 (not found)' : `HTTP ${status}`} on the last refresh. ` : 'It didn’t answer on the last refresh. '}
          {fetchedAt ? `Showing the last copy Everstats has, from ${formatDate(fetchedAt)}.` : 'Everstats has no earlier copy to show.'}
        </span>
        {onRetry && <button type="button" className="btn sm self-start" onClick={onRetry}><Icon name="refresh" size="sm" />Try again</button>}
      </div>
    </div>
  );
}

/** A section's state before its body: never fetched / not returned / empty. Returns null when there's data to show. */
export function SectionState({ section, glyph, what, onRetry }) {
  if (section.state === 'never') return <div className="note small" role="status"><Icon name="clock" /><span>Collections load on the next refresh.</span></div>;
  if (section.state === 'not_returned') return <NotReturned status={section.status} fetchedAt={section.fetchedAt} onRetry={onRetry} />;
  if (section.state === 'empty') return <CollectionEmpty glyph={glyph} what={what} checkedAt={section.checkedAt} />;
  return null;
}

/** The Wowhead text link (wowhead-link.md): text only, no logo, no tooltip script. */
export function WowheadLink({ itemId }) {
  if (!Number.isSafeInteger(itemId)) return null;
  return (
    <a className="wh" href={`https://www.wowhead.com/item=${itemId}`} target="_blank" rel="noopener noreferrer">
      View item on Wowhead
      <svg viewBox="0 0 24 24" aria-hidden="true" dangerouslySetInnerHTML={{ __html: GLYPHS.external }} />
    </a>
  );
}

/** "From [date] · refreshing" and friends, under a section. */
export function SectionFresh({ section, refreshing }) {
  if (!section?.fetchedAt) return refreshing ? <span className="muted xsmall">Refreshing…</span> : null;
  return <span className="muted xsmall">From {formatDate(section.fetchedAt)}{refreshing ? ' · refreshing' : ''}</span>;
}
