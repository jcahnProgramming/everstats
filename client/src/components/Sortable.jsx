import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Icon } from '../chrome/Icon.jsx';

/**
 * ONE drag-and-drop list (0.8.1), used everywhere an order is chosen: Settings → Badges (featured), Manage guild →
 * Badges, the share-card maker's statistics, the dashboard's pinned statistics.
 *
 * How it feels
 *   - Grab the WHOLE item (or its grip). It lifts and follows the pointer; the others slide out of its way as it moves
 *     (a short transform transition, none under prefers-reduced-motion), and a dashed gap marks where it will land.
 *   - Mouse: a drag starts after 5 px of movement, so a click is still a click (a link item still navigates).
 *     Touch: a long-press (LONG_PRESS_MS) on the item picks it up, and the page doesn't scroll while it is held; the grip
 *     picks up at once. A finger that moves before the long-press ends is a scroll, as usual.
 *   - Keyboard (the grip is a button): Space picks up, arrow keys move, Space drops, Escape cancels; every step is
 *     announced in a live region.
 *   - Drop → onReorder(ids) (may return a promise) → "Saved" with Undo for UNDO_MS.
 *   - Locked items (staff and partner badges) lead the list: no grip but a lock with its note, can't be picked up,
 *     and nothing can be dropped above them.
 *
 * CLAUDE.md "Bugs that cost us": the node that holds the pointer never moves in the DOM during a drag (it follows by
 * transform; the DOM order changes once, on drop); end-of-drag listeners live on window; interactive controls inside an
 * item (toggles, radios, checkboxes) keep working and never start a drag.
 */
export const LONG_PRESS_MS = 320;
export const UNDO_MS = 6000;
const MOUSE_SLOP = 5;
const TOUCH_SLOP = 8;
// Form controls inside an item keep their own pointer behaviour. Buttons and links don't: a drag that starts on one
// (a badge pill's popover, a stat card's link) is a drag once the pointer moves, and the click after it is swallowed.
const CONTROLS = 'input, select, textarea, label, [role="switch"], [role="radio"], [role="checkbox"], [data-no-drag]';

const moved = (list, from, to) => {
  const next = [...list];
  const [x] = next.splice(from, 1);
  next.splice(to, 0, x);
  return next;
};

export function Sortable({
  items, idOf = (x) => x.id, labelOf, lockedOf = () => false, lockedNote = 'Always first', onReorder, renderItem,
  className = '', itemClassName = '', ariaLabel, disabled = false, doneText = 'Saved', undoText = 'Order restored',
  // 0.9.2: (slot index, count) → a style for that SLOT (a .fillgrid span), whichever item sits in it.
  slotStyle = null,
}) {
  const ids = items.map(idOf);
  const byId = new Map(items.map((x) => [idOf(x), x]));
  const idsKey = ids.join('|');
  const [order, setOrder] = useState(ids);
  const [drag, setDragState] = useState(null);
  const [said, setSaid] = useState('');
  const [status, setStatus] = useState(null); // { text, prev } after a save
  const live = useRef(null);
  const els = useRef(new Map());
  const box = useRef(null);
  const statusTimer = useRef(null);
  const setDrag = (v) => {
    live.current = v;
    setDragState(v);
  };

  // follow the parent's order whenever nothing is being moved
  useEffect(() => {
    if (!live.current) setOrder(idsKey ? idsKey.split('|').map((k) => ids.find((x) => String(x) === k)) : []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey]);
  useEffect(() => () => {
    clearTimeout(statusTimer.current);
  }, []);

  const shown = order.filter((id) => byId.has(id));
  const lockedCount = shown.filter((id) => lockedOf(byId.get(id))).length;
  const label = (id) => labelOf?.(byId.get(id)) ?? String(id);

  const save = useCallback(async (next, prev, { undo = true } = {}) => {
    clearTimeout(statusTimer.current);
    setStatus({ text: 'Saving…', prev: null });
    try {
      await onReorder(next);
      setStatus({ text: undo ? doneText : undoText, prev: undo ? prev : null });
      statusTimer.current = setTimeout(() => setStatus(null), UNDO_MS);
    } catch {
      setOrder(prev);
      setStatus(null);
    }
  }, [onReorder, doneText, undoText]);

  const finish = (d, to) => {
    const next = moved(d.origin, d.from, to);
    setDrag(null);
    document.body.classList.remove('is-sorting');
    setOrder(next);
    if (to !== d.from) {
      setSaid(`Dropped ${label(d.id)} at position ${to + 1} of ${next.length}.`);
      save(next, d.origin);
    }
  };

  // ---------------------------------------------------------------- pointer
  const startPointer = (e, id, fromGrip) => {
    if (disabled || live.current || lockedOf(byId.get(id))) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const control = e.target.closest(CONTROLS);
    if (control && control !== e.currentTarget) return;
    const touch = e.pointerType !== 'mouse';
    const press = { id, x: e.clientX, y: e.clientY, pointerId: e.pointerId, active: false, timer: null };

    const activate = (x, y) => {
      if (press.active) return;
      press.active = true;
      const origin = shown;
      const rects = origin.map((k) => els.current.get(k)?.getBoundingClientRect() ?? null);
      if (rects.some((r) => !r)) return;
      const from = origin.indexOf(id);
      document.body.classList.add('is-sorting');
      setDrag({ mode: 'pointer', id, from, to: from, origin, rects, x0: press.x, y0: press.y, dx: x - press.x, dy: y - press.y });
      setSaid(`Picked up ${label(id)}.`);
    };
    const target = (d, dx, dy) => {
      const r = d.rects[d.from];
      const cx = r.left + r.width / 2 + dx;
      const cy = r.top + r.height / 2 + dy;
      let best = d.from;
      let bestD = Infinity;
      d.rects.forEach((s, i) => {
        if (i < lockedCount) return;
        const dist = (s.left + s.width / 2 - cx) ** 2 + (s.top + s.height / 2 - cy) ** 2;
        if (dist < bestD) { bestD = dist; best = i; }
      });
      return best;
    };
    const onMove = (ev) => {
      if (ev.pointerId !== press.pointerId) return;
      const dx = ev.clientX - press.x;
      const dy = ev.clientY - press.y;
      if (!press.active) {
        const far = Math.hypot(dx, dy);
        if (!touch || fromGrip) { if (far > MOUSE_SLOP) activate(ev.clientX, ev.clientY); } else if (far > TOUCH_SLOP) end(false);
        return;
      }
      const d = live.current;
      if (!d) return;
      const to = target(d, dx, dy);
      if (to !== d.to) setSaid(`${label(d.id)}, position ${to + 1} of ${d.origin.length}.`);
      setDrag({ ...d, dx, dy, to });
    };
    const end = (drop) => {
      clearTimeout(press.timer);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      const d = live.current;
      if (!press.active || !d) return;
      // the click that follows a drag must not open a link inside the item
      const stop = (ev) => { ev.preventDefault(); ev.stopPropagation(); };
      window.addEventListener('click', stop, { capture: true, once: true });
      setTimeout(() => window.removeEventListener('click', stop, { capture: true }), 0);
      if (drop) finish(d, d.to);
      else {
        setDrag(null);
        document.body.classList.remove('is-sorting');
        setSaid('Cancelled. The order is as it was.');
      }
    };
    const onUp = (ev) => { if (ev.pointerId === press.pointerId) end(true); };
    const onCancel = (ev) => { if (ev.pointerId === press.pointerId) end(false); };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    if (touch && fromGrip) activate(e.clientX, e.clientY);
    else if (touch) press.timer = setTimeout(() => activate(press.x, press.y), LONG_PRESS_MS);
  };

  // no page scroll while an item is held (the listener must exist before the touch starts, and be non-passive)
  useEffect(() => {
    const el = box.current;
    if (!el) return undefined;
    const block = (ev) => {
      if (live.current?.mode === 'pointer') ev.preventDefault();
    };
    el.addEventListener('touchmove', block, { passive: false });
    return () => {
      el.removeEventListener('touchmove', block);
    };
  }, []);
  useEffect(() => () => {
    document.body.classList.remove('is-sorting');
  }, []);

  // ---------------------------------------------------------------- keyboard (on the grip)
  const refocus = (id) => requestAnimationFrame(() => els.current.get(id)?.querySelector('[data-sort-grip]')?.focus());
  const onKey = (e, id) => {
    const d = live.current;
    if (e.key === ' ' || e.key === 'Spacebar') {
      e.preventDefault();
      if (disabled) return;
      if (!d) {
        const from = shown.indexOf(id);
        setDrag({ mode: 'keyboard', id, from, to: from, origin: shown });
        setSaid(`Picked up ${label(id)}, position ${from + 1} of ${shown.length}. Arrow keys move it, Space drops it, Escape cancels.`);
      } else if (d.mode === 'keyboard') {
        finish(d, d.to);
        refocus(id);
      }
      return;
    }
    if (e.key === 'Escape' && d?.mode === 'keyboard') {
      e.preventDefault();
      setDrag(null);
      setOrder(d.origin);
      setSaid('Cancelled. The order is as it was.');
      refocus(id);
      return;
    }
    const step = { ArrowUp: -1, ArrowLeft: -1, ArrowDown: 1, ArrowRight: 1 }[e.key];
    if (!step || d?.mode !== 'keyboard') return;
    e.preventDefault();
    const to = Math.max(lockedCount, Math.min(d.origin.length - 1, d.to + step));
    if (to === d.to) return;
    setDrag({ ...d, to });
    setOrder(moved(d.origin, d.from, to));
    setSaid(`${label(d.id)}, position ${to + 1} of ${d.origin.length}.`);
    refocus(id);
  };

  // ---------------------------------------------------------------- render
  const pointer = drag?.mode === 'pointer' ? drag : null;
  const virtual = pointer ? moved(pointer.origin, pointer.from, pointer.to) : null;
  const [gap, setGap] = useState(null);
  useLayoutEffect(() => {
    if (!pointer || !box.current) {
      setGap(null);
      return;
    }
    const b = box.current.getBoundingClientRect();
    const r = pointer.rects[pointer.to];
    setGap({ left: r.left - b.left, top: r.top - b.top, width: r.width, height: r.height });
  }, [pointer?.to, Boolean(pointer)]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="sortable-wrap">
      <div ref={box} className={`sortable ${className}${pointer ? ' is-dragging' : ''}`} role="list" aria-label={ariaLabel}>
        {gap && <div className="sort-gap" aria-hidden="true" style={gap} />}
        {shown.map((id, i) => {
          const item = byId.get(id);
          const locked = lockedOf(item);
          const lifted = drag?.id === id;
          let style;
          if (pointer && lifted) style = { transform: `translate(${pointer.dx}px, ${pointer.dy}px)` };
          else if (pointer) {
            const n = virtual.indexOf(id);
            const from = pointer.rects[i];
            const to = pointer.rects[n];
            if (n !== i && from && to) style = { transform: `translate(${to.left - from.left}px, ${to.top - from.top}px)` };
          }
          const grip = locked ? (
            <span className="sort-lock" title={lockedNote}><Icon name="lock" size="sm" /><span className="sort-lock-note">{lockedNote}</span></span>
          ) : (
            <button type="button" className="sort-grip" data-sort-grip="" disabled={disabled} title="Drag to reorder"
              aria-label={`Reorder ${label(id)}, position ${i + 1} of ${shown.length}`} aria-pressed={lifted && drag?.mode === 'keyboard' ? 'true' : undefined}
              onPointerDown={(e) => { e.stopPropagation(); startPointer(e, id, true); }} onKeyDown={(e) => onKey(e, id)}>
              <svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="5" cy="3" r="1.4" /><circle cx="11" cy="3" r="1.4" /><circle cx="5" cy="8" r="1.4" /><circle cx="11" cy="8" r="1.4" /><circle cx="5" cy="13" r="1.4" /><circle cx="11" cy="13" r="1.4" /></svg>
            </button>
          );
          const cls = ['sort-item', itemClassName, locked ? 'is-locked' : 'is-movable', lifted ? 'is-lifted' : ''].filter(Boolean).join(' ');
          return (
            <div key={id} role="listitem" className={cls} style={slotStyle ? { ...slotStyle(i, shown.length), ...style } : style}
              ref={(el) => { if (el) els.current.set(id, el); else els.current.delete(id); }}
              onPointerDown={(e) => startPointer(e, id, false)}
              onDragStart={(e) => e.preventDefault()}
              onContextMenu={(e) => { if (live.current) e.preventDefault(); }}>
              {renderItem(item, { grip, index: i, lifted, locked })}
            </div>
          );
        })}
      </div>
      <div className="sort-foot">
        {/* 0.10.4: nothing to reorder below two movable items (one guild on the dashboard said "Drag to reorder"). */}
        {shown.length - lockedCount >= 2 && <span className="muted xsmall sort-hint"><span aria-hidden="true">⠿</span> Drag to reorder{lockedCount ? ` · ${lockedNote.toLowerCase()}` : ''}</span>}
        {status && (
          <span className="sort-status small" role="status">
            {status.text === 'Saving…' ? status.text : <><Icon name="check" size="sm" />{status.text}</>}
            {status.prev && (
              <button type="button" className="btn ghost sm" onClick={() => {
                const back = status.prev;
                const now = shown;
                setOrder(back);
                setSaid('Undone. The order is as it was.');
                save(back, now, { undo: false });
              }}>Undo</button>
            )}
          </span>
        )}
      </div>
      <span className="sr-only" aria-live="assertive">{said}</span>
    </div>
  );
}
