import { Icon } from '../chrome/Icon.jsx';

/**
 * 0.10.3: what a page shows where a feature the admin switched off would be (server/features/registry.js "whenOff").
 * A plain note, not one of the four empty states: the feature is built and has data; it is paused on purpose.
 */
export function SwitchedOff({ children, compact = false }) {
  return (
    <div className={`note${compact ? ' small' : ''}`} role="status">
      <Icon name="pause" />
      <span>{children}</span>
    </div>
  );
}
