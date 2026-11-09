import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { Icon } from '../chrome/Icon.jsx';
import { Segmented } from '../components/Controls.jsx';
import { formatNumber } from '../format.js';
import { AccountMarker, CompletionBar, Glyph, Legend, SectionFresh, SectionState, Tile, WowheadLink, pct } from './parts.jsx';

/**
 * The transmog tracker (design/v4-collections pages/transmog, with the catalog module). Slot picker (Blizzard's own
 * slots, grouped Armour / Weapons by what Blizzard's catalog says the slot's appearances are), per-slot and overall
 * completion, collected and missing tiles, filters (collected/missing, armour type, quality: segmented buttons, never a
 * native select), and a detail pane listing every item that grants the appearance. Forever has no "drops from" data
 * (Blizzard's journal indexes are empty), so every item gets the Wowhead text link instead of a source line, and there
 * is no Source filter. Quality comes from Blizzard's item search; where it isn't known the filter says so.
 */
const QUALITY_ORDER = ['legendary', 'epic', 'rare', 'uncommon', 'common', 'poor'];
const groupLabel = (g) => (g === 'Weapon' ? 'Weapons' : g === 'Armor' ? 'Armour' : g ?? 'Other');
const PAGE = 60;

export function TransmogTracker({ slug, count, ruleset, refreshing, onRetry }) {
  const [slot, setSlot] = useState(null);
  const [sec, setSec] = useState(null);
  const [error, setError] = useState(null);
  const [show, setShow] = useState('all');
  const [armour, setArmour] = useState('any');
  const [quality, setQuality] = useState('any');
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(null);
  const [limit, setLimit] = useState(PAGE);

  useEffect(() => {
    let live = true;
    api(`/api/characters/${encodeURIComponent(slug)}/collections/transmog${slot ? `?slot=${encodeURIComponent(slot)}` : ''}`)
      .then((r) => { if (live) { setSec(r.section); setError(null); } }, (err) => { if (live) setError(err); });
    return () => {
      live = false;
    };
  }, [slug, slot]);
  useEffect(() => {
    setSel(null);
    setLimit(PAGE);
    setArmour('any');
    setQuality('any');
  }, [slot]);

  const tiles = sec?.tiles ?? [];
  const armours = useMemo(() => [...new Set(tiles.map((t) => t.armour).filter(Boolean))].sort(), [tiles]);
  const qualities = useMemo(() => QUALITY_ORDER.filter((x) => tiles.some((t) => t.quality === x)), [tiles]);
  if (error) return <div className="note warn" role="alert"><Icon name="warning" /><span>{error.message}</span></div>;
  if (!sec) return <div className="cgrid" aria-busy="true">{Array.from({ length: 12 }, (_, i) => <span key={i} className="ctile skel-tile static"><span className="ic" /><span className="nm" /></span>)}</div>;

  const head = (
    <div className="row gap-12 wrap-row">
      <Glyph name="transmog" className="cg lg gold" />
      <h2 className="h1">Transmog</h2>
      <span className="t2 small">Appearances by slot</span>
      <span className="spacer" />
      {count?.rank && ruleset ? <Link className="rankpill" to={`/leaderboards/${ruleset}/${count.id}`}><b>#{formatNumber(count.rank)}</b> on board</Link> : null}
    </div>
  );
  if (sec.state !== 'ok') return <section className="stack gap-16">{head}<SectionState section={sec} glyph="transmog" what="appearances" onRetry={onRetry} /></section>;

  const needle = q.trim().toLowerCase();
  const list = tiles.filter((t) => (show === 'all' || (show === 'collected') === t.collected)
    && (armour === 'any' || t.armour === armour) && (quality === 'any' || t.quality === quality)
    && (!needle || (t.name ?? '').toLowerCase().includes(needle) || t.items.some((i) => (i.name ?? '').toLowerCase().includes(needle))));
  const groups = new Map(['Armour', 'Weapons'].map((g) => [g, []]));
  for (const s of sec.slots) {
    const g = groupLabel(s.group);
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(s);
  }
  const current = sec.slots.find((s) => s.type === sec.slot);
  const chips = [armour !== 'any' && { label: `Armour: ${armour}`, clear: () => setArmour('any') }, quality !== 'any' && { label: `Quality: ${quality}`, clear: () => setQuality('any') }, show !== 'all' && { label: show === 'missing' ? 'Missing' : 'Collected', clear: () => setShow('all') }].filter(Boolean);
  return (
    <section className="stack gap-16" aria-label="Transmog tracker">
      {head}
      <div className="panel row gap-24 wrap-row pad-16">
        <div className="cbig"><b>{formatNumber(sec.have)}{sec.total ? ` / ${formatNumber(sec.total)}` : ''}</b><span>{sec.total ? `appearances · ${pct(sec.have, sec.total)}%` : 'appearances collected'}</span></div>
        <AccountMarker shared={count?.shared} tagged />
        {sec.total ? <div className="tm-allslots"><CompletionBar label="All slots" have={sec.have} total={sec.total} large /></div> : null}
      </div>
      {!sec.catalog && <div className="note small"><Icon name="info" /><span>Blizzard’s full appearance list isn’t available right now, so this shows collected appearances only: no missing tiles, no percentages.</span></div>}
      <div className={`tracker${sel ? '' : ' no-detail'}`}>
        <nav className="panel picker slotpick" aria-label="Slots">
          {[...groups.entries()].filter(([, l]) => l.length).map(([g, list2]) => (
            <div key={g} className="stack gap-2 slot-group">
              <span className="grp">{g}</span>
              {list2.map((s) => (
                <button key={s.type} type="button" className={`spi${s.total && s.have >= s.total ? ' done' : ''}`} aria-current={s.type === sec.slot ? 'true' : undefined} onClick={() => setSlot(s.type)}>
                  <Glyph name={`slot:${s.type}`} />
                  <span className="n">{s.name}{sec.slots.filter((x) => x.name === s.name).length > 1 ? <span className="muted"> · {s.type.toLowerCase()}</span> : null}</span>
                  <span className="c">{formatNumber(s.have)}{s.total ? ` / ${formatNumber(s.total)}` : ''}</span>
                  {s.total ? <span className="bar" aria-hidden="true"><span style={{ width: `${pct(s.have, s.total)}%` }} /></span> : null}
                </button>
              ))}
            </div>
          ))}
        </nav>
        <div className="center">
          <div className="fbar">
            <label className="search"><Icon name="search" size="sm" /><input className="inp" type="search" placeholder="Search appearances" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search appearances or items" data-edit-guard="off" /></label>
            <Segmented label="Show" value={show} onChange={setShow} scroll={false} options={[{ id: 'all', label: 'All' }, { id: 'collected', label: 'Collected' }, ...(sec.catalog ? [{ id: 'missing', label: 'Missing' }] : [])]} />
          </div>
          {armours.length > 1 && <div className="row gap-8 wrap-row"><span className="eyebrow">Armour type</span><Segmented label="Armour type" value={armour} onChange={setArmour} options={[{ id: 'any', label: 'Any' }, ...armours.map((a) => ({ id: a, label: a }))]} /></div>}
          {sec.qualityKnown && qualities.length > 1 && <div className="row gap-8 wrap-row"><span className="eyebrow">Quality</span><Segmented label="Quality" value={quality} onChange={setQuality} options={[{ id: 'any', label: 'Any' }, ...qualities.map((x) => ({ id: x, label: x[0].toUpperCase() + x.slice(1) }))]} /></div>}
          {chips.length > 0 && (
            <div className="fchips"><span className="muted xsmall">Filters:</span>
              {chips.map((c) => <span key={c.label} className="fchip">{c.label}<button type="button" aria-label={`Remove ${c.label}`} onClick={c.clear}><Icon name="close" size="sm" /></button></span>)}
              <button type="button" className="linklike small" onClick={() => { setArmour('any'); setQuality('any'); setShow('all'); }}>Clear all</button>
            </div>
          )}
          <div className="panel stack gap-14 pad-16">
            {current && <CompletionBar label={current.name} have={current.have} total={current.total} />}
            <Legend />
            {list.length ? (
              <div className="cgrid" role="list">
                {list.slice(0, limit).map((t) => <Tile key={t.id} item={t} glyph={`slot:${sec.slot}`} onSelect={setSel} selected={sel?.id === t.id} />)}
              </div>
            ) : <span className="muted small">Nothing in this slot matches.</span>}
            {list.length > limit && (
              <div className="row gap-12"><span className="muted small">Showing {formatNumber(limit)} of {formatNumber(list.length)}</span><span className="spacer" /><button type="button" className="btn sm" onClick={() => setLimit(limit + PAGE)}>Show more</button></div>
            )}
          </div>
          <WornTransmog worn={sec.worn} />
          {sec.sets.length > 0 && (
            <section className="panel stack gap-10 pad-16" aria-labelledby="sets-h">
              <h3 className="h3" id="sets-h">Appearance sets</h3>
              {sec.sets.map((s) => <CompletionBar key={s.id} label={s.name} have={s.have} total={s.total} />)}
            </section>
          )}
          <SectionFresh section={sec} refreshing={refreshing} />
        </div>
        {sel && <Detail tile={sel} slotName={current?.name} onClose={() => setSel(null)} />}
      </div>
    </section>
  );
}

function Detail({ tile, slotName, onClose }) {
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);
  return (
    <aside className="panel cdetail" aria-label={`${tile.name ?? 'Appearance'} details`}>
      <span className="grab" aria-hidden="true" />
      <div className="top">
        <Tile item={tile} glyph="transmog" size="lg" />
        <div className="stack gap-6">
          <span className="h3">{tile.name ?? `Appearance ${tile.id}`}</span>
          <div className="row gap-6 wrap-row">
            <span className={`status ${tile.collected ? 'got' : 'miss'}`}>{tile.collected ? 'Collected' : 'Missing'}</span>
            {slotName && <span className="tag">{slotName}</span>}
            {tile.armour && <span className="tag">{tile.armour}</span>}
          </div>
        </div>
      </div>
      {tile.items.length ? (
        <>
          <span className="eyebrow">Granted by {tile.items.length} item{tile.items.length === 1 ? '' : 's'}</span>
          <div className="items">
            {tile.items.map((i) => (
              <div key={i.id} className="item">
                <span className={`nm${i.quality ? ` q-${i.quality}` : ''}`}>{i.name ?? `Item ${i.id}`}</span>
                <span className="muted xsmall">{[i.quality ? i.quality[0].toUpperCase() + i.quality.slice(1) : null, tile.armour, slotName].filter(Boolean).join(' · ')}</span>
                {!tile.collected && <><span className="small t2">No source from Blizzard for this item.</span><WowheadLink itemId={i.id} /></>}
              </div>
            ))}
          </div>
          <span className="muted xsmall">{tile.collected ? 'Collected: any one of these items unlocked it.' : 'Getting any one of these items unlocks the appearance.'}</span>
        </>
      ) : <span className="small t2">Blizzard’s catalog doesn’t name an item for this appearance.</span>}
      <button type="button" className="btn ghost sm self-start" onClick={onClose}>Close</button>
    </aside>
  );
}

/** Blizzard's render shows worn gear, not transmog: this list fills the gap (equipment's `transmog`, 0.8.0). */
function WornTransmog({ worn }) {
  if (!worn?.length) return null;
  return (
    <section className="panel stack gap-8 pad-16" aria-labelledby="worn-h">
      <h3 className="h3" id="worn-h">Currently worn transmog</h3>
      <span className="muted xsmall">Per equipped item. Blizzard’s render shows worn gear, not transmog.</span>
      <div className="qlist">
        {worn.map((w) => (
          <div key={w.slot} className="qrow">
            <span className="nm row gap-8"><Glyph name={`slot:${w.slot}`} className="cg sm-glyph" />{w.slotName || w.slot}</span>
            <span className="t2 small">{w.transmog === undefined ? 'Not known until the next full refresh' : w.transmog ? w.transmog : 'Not transmogged'}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
