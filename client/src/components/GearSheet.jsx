import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { formatNumber } from '../format.js';
import { Segmented } from './Controls.jsx';

/**
 * The equipment, laid out like the in-game character sheet / Armory (0.4.1): a column of slots each side of the render,
 * weapons along the bottom. Each slot: the item's icon framed in its quality colour, its name in that colour and its
 * item level; empty slots are empty frames. A tooltip like the game's opens on hover (desktop), tap (phone: tap again
 * or anywhere else to close) or keyboard focus (Escape closes), and is kept on screen at every edge.
 *
 * Everything in a tooltip is Blizzard's own text from the equipment response (crawler/parse.js tooltipOf), in the
 * game's order. A line Blizzard didn't send isn't shown; nothing comes from memory or another database.
 *
 * Which column a slot sits in is layout, by Blizzard's slot type; the label is Blizzard's own slot name. The empty-slot
 * labels are ours (Blizzard sends nothing for an empty slot), and only for the slots the Forever era has. A slot type
 * this layout doesn't know is added to the right-hand column, never dropped.
 *
 * Icons come from Blizzard's item media (crawler/items.js), shown from its render host. Until an icon has been fetched
 * the slot shows its frame and name; the page asks again a few times (ICON_POLLS) and then shows our own placeholder.
 * A failed or missing icon shows the placeholder too, and the name and tooltip still work.
 *
 * 0.8.0, Worn gear | Transmog: the switch shows only when at least one slot is transmogged (Blizzard's `transmog` on
 * the equipped item). In the Transmog view a transmogged slot shows the transmog item's icon and name, "Transmog of
 * {worn item}", and its tooltip is still the WORN item's full tooltip under a "Transmogrified to" line; a slot without
 * one shows the worn item marked "not transmogged". Blizzard sends no quality for the transmog item, so its name and
 * frame are neutral, never a guessed colour. Blizzard's render always shows worn gear, and the page says so.
 */
export const hasTransmog = (equipment) => (equipment ?? []).some((i) => i.transmog);

/** One slot as a view shows it: the worn item, or (Transmog view) the transmog item standing in for it. */
function shown(item, view) {
  if (!item || view !== 'transmog') return { item, kind: 'worn' };
  if (!item.transmog) return { item, kind: 'plain' };
  return { item, kind: 'transmog', look: item.transmog };
}
const LEFT = [['HEAD', 'Head'], ['NECK', 'Neck'], ['SHOULDER', 'Shoulders'], ['BACK', 'Back'], ['CHEST', 'Chest'], ['SHIRT', 'Shirt'], ['TABARD', 'Tabard'], ['WRIST', 'Wrist']];
const RIGHT = [['HANDS', 'Hands'], ['WAIST', 'Waist'], ['LEGS', 'Legs'], ['FEET', 'Feet'], ['FINGER_1', 'Finger'], ['FINGER_2', 'Finger'], ['TRINKET_1', 'Trinket'], ['TRINKET_2', 'Trinket']];
const BOTTOM = [['MAIN_HAND', 'Main Hand'], ['OFF_HAND', 'Off Hand'], ['RANGED', 'Ranged']];
const KNOWN = new Set([...LEFT, ...RIGHT, ...BOTTOM].map(([t]) => t));
const ICON_POLLS = 8;
const ICON_POLL_MS = 3000;

export function GearSheet({ equipment, render }) {
  const [items, setItems] = useState(equipment ?? []);
  const [view, setView] = useState('worn');
  const [open, setOpen] = useState(null); // slot type with the tooltip open
  const [pinned, setPinned] = useState(false); // opened by a tap or focus: stays until closed
  const polls = useRef(0);

  useEffect(() => {
    setItems(equipment ?? []);
    polls.current = 0;
  }, [equipment]);

  // Icons that weren't fetched yet (worn items and transmogs): ask again a few times, then give up honestly.
  useEffect(() => {
    const pending = [...new Set(items.flatMap((i) => [
      i.iconState === 'pending' ? i.itemId : null,
      i.transmog?.iconState === 'pending' ? i.transmog.itemId : null,
    ]).filter(Number.isSafeInteger))];
    if (!pending.length) return undefined;
    if (polls.current >= ICON_POLLS) {
      const giveUp = (x) => (x.iconState === 'pending' ? { ...x, iconState: 'unloaded' } : x);
      setItems((list) => list.map((i) => ({ ...giveUp(i), ...(i.transmog ? { transmog: giveUp(i.transmog) } : {}) })));
      return undefined;
    }
    const t = setTimeout(async () => {
      polls.current += 1;
      try {
        const r = await api(`/api/items/media?ids=${pending.join(',')}`);
        const byId = new Map(r.items.map((x) => [Number(x.itemId), x]));
        const fill = (x) => (byId.has(x.itemId) ? { ...x, icon: byId.get(x.itemId).icon, iconState: byId.get(x.itemId).iconState } : x);
        setItems((list) => list.map((i) => ({ ...fill(i), ...(i.transmog ? { transmog: fill(i.transmog) } : {}) })));
      } catch {
        setItems((list) => [...list]);
      }
    }, ICON_POLL_MS);
    return () => {
      clearTimeout(t);
    };
  }, [items]);

  // A tap or click anywhere else closes a pinned tooltip; Escape closes any.
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (!e.target.closest?.('[data-gear-slot]')) setOpen(null);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') setOpen(null);
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const bySlot = new Map(items.map((i) => [i.slot, i]));
  const extra = items.filter((i) => !KNOWN.has(i.slot)).map((i) => [i.slot, i.slotName || i.slot]);
  const slot = (side) => ([type, label]) => (
    <GearSlotButton
      key={type}
      type={type}
      label={label}
      item={bySlot.get(type) ?? null}
      view={view}
      side={side}
      open={open === type}
      onOpen={(how) => {
        setOpen(type);
        setPinned(how !== 'hover');
      }}
      onClose={(how) => {
        if (how === 'hover' && pinned) return;
        setOpen((o) => (o === type ? null : o));
      }}
      onToggle={() => {
        setPinned(true);
        setOpen((o) => (o === type ? null : type));
      }}
    />
  );
  const transmogged = items.filter((i) => i.transmog).length;
  return (
    <div className="stack gap-12">
      {transmogged > 0 && (
        <div className="row gap-12 wrap-row gear-view">
          <Segmented label="Gear shown" value={view} onChange={setView} scroll={false} options={[{ id: 'worn', label: 'Worn gear' }, { id: 'transmog', label: 'Transmog' }]} />
          <span className="muted xsmall">{transmogged} transmogged slot{transmogged === 1 ? '' : 's'}. Blizzard’s render shows worn gear.</span>
        </div>
      )}
      <div className={`armory${view === 'transmog' ? ' is-transmog' : ''}`}>
        <div className="armory-col left" aria-label="Equipment, left side">{LEFT.map(slot('left'))}</div>
        <div className="armory-render">{render}</div>
        <div className="armory-col right" aria-label="Equipment, right side">{[...RIGHT, ...extra].map(slot('right'))}</div>
        <div className="armory-bottom" aria-label="Weapons">{BOTTOM.map(slot('bottom'))}</div>
      </div>
    </div>
  );
}

function GearSlotButton({ type, label, item, view, side, open, onOpen, onClose, onToggle }) {
  const tipId = useId();
  const ref = useRef(null);
  // A tap focuses the button before its click: that focus must not open it, or the click would toggle it shut.
  const lastPointer = useRef(null);
  if (!item) {
    return (
      <div className={`slot empty armory-slot ${side}`} data-gear-slot>
        <span className="icon"><EmptySlotArt /></span>
        <span className="txt stack ellipsis"><span className="nm">Empty</span><span className="meta">{label}</span></span>
      </div>
    );
  }
  const s = shown(item, view);
  const meta = s.kind === 'transmog' ? `Transmog of ${item.name}`
    : s.kind === 'plain' ? `${item.slotName || label} · not transmogged`
      : `${item.slotName || label}${Number.isFinite(item.level) ? ` · ilvl ${item.level}` : ''}`;
  return (
    <>
      <button
        ref={ref}
        type="button"
        data-gear-slot={type}
        className={`slot armory-slot ${s.kind === 'transmog' ? 'qc-tmog' : `qc-${item.quality}`}${s.kind === 'plain' ? ' is-plain' : ''} ${side}`}
        aria-describedby={open ? tipId : undefined}
        aria-expanded={open}
        onPointerEnter={(e) => { if (e.pointerType === 'mouse') onOpen('hover'); }}
        onPointerLeave={(e) => { if (e.pointerType === 'mouse') onClose('hover'); }}
        onPointerDown={(e) => { lastPointer.current = e.pointerType; }}
        onFocus={() => {
          if (lastPointer.current !== 'touch') onOpen('focus');
          lastPointer.current = null;
        }}
        onBlur={() => onClose('focus')}
        onClick={(e) => {
          // Touch and keyboard activation toggle it; a mouse click keeps it open (it's already open from hover).
          if (e.detail === 0 || e.nativeEvent.pointerType !== 'mouse') onToggle();
        }}
      >
        <span className="icon"><ItemIcon item={s.kind === 'transmog' ? s.look : item} /></span>
        <span className="txt stack ellipsis">
          <span className={`nm ${s.kind === 'transmog' ? 'q-tmog' : `q-${item.quality}`} ellipsis`}>{s.kind === 'transmog' ? s.look.name : item.name}</span>
          <span className="meta ellipsis">{meta}</span>
        </span>
      </button>
      {open && <ItemTooltip id={tipId} item={item} anchor={ref} side={side} transmog={item.transmog ?? null} />}
    </>
  );
}

function ItemIcon({ item }) {
  const [broken, setBroken] = useState(false);
  if (item.icon && !broken) return <img src={item.icon} alt="" width="56" height="56" onError={() => setBroken(true)} />;
  if (item.iconState === 'pending') return <span className="icon-wait" aria-hidden="true" />;
  return <UnknownIconArt />;
}

/** Our own placeholder for an icon we couldn't get: a question mark in a frame. Not Blizzard art. */
function UnknownIconArt() {
  return (
    <svg className="icon-unknown" viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3.5" y="3.5" width="17" height="17" rx="2.5" />
      <path d="M9.6 9.4a2.5 2.5 0 1 1 3.6 2.2c-.8.4-1.2.9-1.2 1.7v.6M12 16.6h.01" />
    </svg>
  );
}
function EmptySlotArt() {
  return <svg className="icon-empty" viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="5" width="14" height="14" rx="2" /></svg>;
}

/**
 * The tooltip: position: fixed beside its slot (right of the left column, left of the right column, above the
 * weapons), then nudged to stay inside the window at every edge. Positioned through the CSSOM (style prop), which the
 * CSP allows; no inline style attribute is written by hand.
 */
function ItemTooltip({ id, item, anchor, side, transmog = null }) {
  const box = useRef(null);
  const [pos, setPos] = useState({ left: -9999, top: 0 });
  const place = useCallback(() => {
    const a = anchor.current?.getBoundingClientRect();
    const t = box.current?.getBoundingClientRect();
    if (!a || !t) return;
    const m = 8;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let left;
    let top;
    if (side === 'bottom') {
      left = a.left + a.width / 2 - t.width / 2;
      top = a.top - t.height - m;
      if (top < m) top = a.bottom + m;
    } else {
      left = side === 'left' ? a.right + m : a.left - t.width - m;
      if (left < m || left + t.width > vw - m) left = side === 'left' ? a.left - t.width - m : a.right + m; // the other side
      if (left < m || left + t.width > vw - m) {
        // Not enough room either side (a phone): under the slot, or above it.
        left = a.left;
        top = a.bottom + m;
        if (top + t.height > vh - m) top = a.top - t.height - m;
      } else {
        top = a.top;
      }
    }
    left = Math.min(Math.max(m, left), Math.max(m, vw - t.width - m));
    top = Math.min(Math.max(m, top), Math.max(m, vh - t.height - m));
    setPos({ left: Math.round(left), top: Math.round(top) });
  }, [anchor, side]);
  useLayoutEffect(() => {
    place();
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [place]);

  const t = item.tooltip ?? {};
  const white = (t.stats ?? []).filter((s) => !s.green);
  const green = (t.stats ?? []).filter((s) => s.green);
  return (
    <div ref={box} id={id} role="tooltip" className="item-tip" style={{ left: pos.left, top: pos.top }}>
      <b className={`tip-name q-${item.quality}`}>{item.name}</b>
      {transmog && <span className="tip-tmog">Transmogrified to: {transmog.name}</span>}
      {Number.isFinite(item.level) && <span className="tip-level">Item Level {item.level}</span>}
      {t.binding && <span>{t.binding}</span>}
      {t.unique && <span>{t.unique}</span>}
      {(t.inventoryType || t.subclass) && <span className="tip-pair"><span>{t.inventoryType}</span><span>{t.subclass}</span></span>}
      {t.weapon?.damage && <span className="tip-pair"><span>{t.weapon.damage}</span><span>{t.weapon.speed}</span></span>}
      {t.weapon?.dps && <span>{t.weapon.dps}</span>}
      {t.armor && <span>{t.armor}</span>}
      {white.map((s) => <span key={s.text}>{s.text}</span>)}
      {t.enchantments?.map((e) => <span key={e} className="tip-green">{e}</span>)}
      {t.sockets?.map((s) => <span key={s}>{s}</span>)}
      {t.durability && <span>{t.durability}</span>}
      {t.requirements?.classes && <span>{t.requirements.classes}</span>}
      {t.requirements?.level && <span>{t.requirements.level}</span>}
      {green.map((s) => <span key={s.text} className="tip-green">{s.text}</span>)}
      {t.spells?.map((s) => <span key={s} className="tip-green">{s}</span>)}
      {t.set && (
        <span className="tip-set stack">
          <span className="tip-set-name">{t.set.name}</span>
          {t.set.items.map((x) => <span key={x.name} className={x.equipped ? 'tip-set-on' : 'tip-muted'}>{x.name}</span>)}
          {t.set.effects.map((x) => <span key={x.text} className={x.active ? 'tip-green' : 'tip-muted'}>{x.text}</span>)}
        </span>
      )}
      {t.sellPrice && (
        <span className="tip-sell">
          Sell Price:{' '}
          {t.sellPrice.gold > 0 && <span className="coin gold">{formatNumber(t.sellPrice.gold)}g</span>}
          {(t.sellPrice.silver > 0 || t.sellPrice.gold > 0) && <span className="coin silver">{t.sellPrice.silver}s</span>}
          <span className="coin copper">{t.sellPrice.copper}c</span>
        </span>
      )}
      <span className="tip-source">Source: Blizzard</span>
    </div>
  );
}
