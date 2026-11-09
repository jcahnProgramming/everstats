import { Link } from 'react-router-dom';
import { Icon } from '../chrome/Icon.jsx';

/**
 * Share buttons (0.8.0, design/v3-share-cards/components/share-button.md). Kept apart from the card maker so any page
 * can show one without importing the maker.
 *   <ShareButton>     the gold "Share" on the character sheet and "Share guild card" on the guild header (they replace
 *                     v1's ghost Share button: sharing is the growth loop); "Share tier" on the tier panel (not gold)
 *   <ShareRowButton>  a board row's icon-only button, whose aria-label names the placement ("Share #1 Times camped")
 * A hidden character's page never renders one.
 */
export function ShareButton({ to, label = 'Share', gold = true }) {
  return <Link className={`btn sm${gold ? ' gold' : ''}`} to={to}><Icon name="share" size="sm" />{label}</Link>;
}

export function ShareRowButton({ to, label }) {
  return <Link className="btn ghost sm icon share-row" to={to} aria-label={label} title={label}><Icon name="share" size="sm" /></Link>;
}
