import { useEffect, useRef, useState } from 'react';
import { Icon } from '../chrome/Icon.jsx';

/**
 * The game-version menu (design/v5-admin components/version-switcher.md): a button that says which version you're
 * looking at and opens a list of the others. ONE component for both places it lives (0.11.1):
 *
 *   the admin's top bar     every version (on or "Off · admin only") plus the region buttons: admin/shell/AdminShell.jsx
 *   the public header       the versions that are switched on, nothing else: chrome/GameVersion.jsx
 *
 * The markup is the admin design's (`.vswitch` button, `.vmenu` panel, `.vopt` options); each place styles it from its
 * own stylesheet (theme/admin.css for the admin, which public pages never load; theme/app.css `.pub-vs` for the site),
 * so the public one wears the visitor's theme.
 *
 *   wrapClass     the wrapper's classes (the popover is positioned against it)
 *   current       { id, name }           sub        a short code beside the name (the admin's region)
 *   versions      [{ id, name, off? }]   onPick(id)
 *   optionState   (version) => node      what an option shows at its right edge (On / Off chips, a tick)
 *   after         (close) => node        anything under the list (the admin's region buttons and note)
 */
export function VersionMenu({ wrapClass, current, sub = null, title, versions, onPick, optionState = null, after = null, groupLabel = 'Game version', idBase = 'vs', label = null }) {
  const [open, setOpen] = useState(false);
  const box = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (!box.current?.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);
  const close = () => setOpen(false);
  return (
    <div className={wrapClass} ref={box}>
      <button type="button" className="vswitch" title={title} aria-label={label ?? undefined} aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <Icon name="globe" /><span className="vname">{current.name}</span>{sub && <span className="reg">{sub}</span>}<Icon name="chevron-down" />
      </button>
      {open && (
        <div className="vmenu panel">
          <span className="grp" id={`${idBase}-versions`}>{groupLabel}</span>
          <div role="listbox" aria-labelledby={`${idBase}-versions`}>
            {versions.map((v) => (
              <button key={v.id} type="button" role="option" aria-selected={v.id === current.id} className={`vopt${v.off ? ' is-off' : ''}`}
                onClick={() => {
                  onPick(v.id);
                  close();
                }}>
                <span>{v.name}</span>
                {optionState ? optionState(v) : null}
              </button>
            ))}
          </div>
          {after ? after(close) : null}
        </div>
      )}
    </div>
  );
}
