import { useEffect, useId, useRef } from 'react';
import { Icon } from '../chrome/Icon.jsx';

/**
 * Controls from design v1 (buttons.md, inputs.md, toggles.md, tabs.md, modals.md). Buttons are plain classes
 * (`btn`, `btn gold`, `btn ghost`, `btn danger`, sizes `sm`/`lg`, `block`, `icon`); <Button> only adds the loading
 * state. No native <select> anywhere: its popup ignores the theme (CLAUDE.md).
 */

/** A button with the design's loading state: label hidden, spinner centred, width kept, aria-busy. */
export function Button({ loading = false, className = '', children, type = 'button', disabled, ...rest }) {
  return (
    <button type={type} className={`btn ${className}${loading ? ' is-loading' : ''}`} aria-busy={loading || undefined} disabled={disabled} {...rest}>
      {children}
    </button>
  );
}

/** Label + input + help/error line (inputs.md). Pass input props through; `error` marks it and replaces the help. */
export function Field({ label, help = null, error = null, className = '', inputClassName = '', id: given, ...input }) {
  const auto = useId();
  const id = given ?? auto;
  const note = error ?? help;
  return (
    <div className={`field ${className}`}>
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        className={`inp ${inputClassName}${error ? ' is-error' : ''}`}
        aria-invalid={error ? 'true' : undefined}
        aria-describedby={note ? `${id}-note` : undefined}
        {...input}
      />
      {note && <span id={`${id}-note`} className={`help${error ? ' err' : ''}`} role={error ? 'alert' : undefined}>{note}</span>}
    </div>
  );
}

/** Switch (toggles.md). A real checkbox under the track, so keyboard and screen readers get a checkbox. */
export function Toggle({ checked, onChange, disabled = false, children }) {
  return (
    <label className={`toggle${disabled ? ' is-disabled' : ''}`}>
      <input type="checkbox" role="switch" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="track" aria-hidden="true" />
      {children}
    </label>
  );
}

/** Segmented control (the .seg pattern: view toggles, ranges, sort orders). options: [{ id, label, disabled }] */
export function Segmented({ options, value, onChange, label, large = false, scroll = true }) {
  return (
    <div className={`seg${large ? ' lg' : ''}${scroll ? ' phone-scroll' : ''}`} role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.id} type="button" aria-pressed={o.id === value} disabled={o.disabled} onClick={() => onChange(o.id)}>{o.label}</button>
      ))}
    </div>
  );
}

/** Underline tabs (tabs.md) with arrow-key movement. tabs: [{ id, label, count, disabled }] */
export function Tabs({ tabs, value, onChange, label, idPrefix }) {
  const onKey = (e) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const live = tabs.filter((t) => !t.disabled);
    const i = live.findIndex((t) => t.id === value);
    const next = live[(i + (e.key === 'ArrowRight' ? 1 : live.length - 1)) % live.length];
    onChange(next.id);
    e.currentTarget.querySelector(`[data-tab="${next.id}"]`)?.focus();
    e.preventDefault();
  };
  return (
    <div className="tabs" role="tablist" aria-label={label} onKeyDown={onKey}>
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          data-tab={t.id}
          id={`${idPrefix}-tab-${t.id}`}
          aria-controls={`${idPrefix}-panel-${t.id}`}
          aria-selected={t.id === value}
          tabIndex={t.id === value ? 0 : -1}
          disabled={t.disabled}
          onClick={() => onChange(t.id)}
        >
          {t.label}{Number.isFinite(t.count) && <span className="count">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

/**
 * Confirmation dialog (modals.md). Focus goes to the first control and is trapped inside; Esc and Cancel close it
 * (not while `busy`); focus returns to whatever opened it. Destructive confirmations pass `danger`.
 */
export function Modal({ title, children, onClose, actions, busy = false }) {
  const box = useRef(null);
  const titleId = useId();
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const busyRef = useRef(busy);
  busyRef.current = busy;

  useEffect(() => {
    const opener = document.activeElement;
    const focusables = () => [...box.current.querySelectorAll('button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])')];
    (focusables()[1] ?? focusables()[0])?.focus(); // [0] is the close button; start on the first real control
    const onKey = (e) => {
      if (e.key === 'Escape' && !busyRef.current) {
        e.preventDefault();
        closeRef.current();
      }
      if (e.key !== 'Tab') return;
      const list = focusables();
      if (!list.length) return;
      const first = list[0];
      const last = list[list.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        last.focus();
        e.preventDefault();
      } else if (!e.shiftKey && document.activeElement === last) {
        first.focus();
        e.preventDefault();
      }
    };
    document.addEventListener('keydown', onKey);
    const { overflow } = document.body.style;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
      if (opener instanceof HTMLElement) opener.focus();
    };
  }, []);

  return (
    <div className="scrim" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div ref={box} className="modal sheet" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="hd">
          <h3 className="h3 grow" id={titleId}>{title}</h3>
          <button type="button" className="btn ghost sm icon" aria-label="Close" onClick={onClose} disabled={busy}>
            <Icon name="close" size="sm" />
          </button>
        </div>
        {children}
        <div className="actions">{actions}</div>
      </div>
    </div>
  );
}
