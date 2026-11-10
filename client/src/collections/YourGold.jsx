import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { formatDate } from '../format.js';
import { formatMoney } from './parts.jsx';

/**
 * The dashboard's "Your gold" (0.9.0): private to the owner. Read from Blizzard at each Battle.net sign-in (only the
 * owner's token can), kept at most 30 days. Each character links to its Collections tab, where the owner can choose
 * to show it publicly. Nothing at all is drawn when Everstats has no gold for any of the account's characters.
 */
export function YourGold() {
  const [data, setData] = useState(null);
  useEffect(() => {
    let live = true;
    api('/api/account/gold').then((d) => { if (live) setData(d); }, () => {});
    return () => {
      live = false;
    };
  }, []);
  if (!data?.characters?.length) return null;
  return (
    <section className="panel clip" aria-labelledby="gold-h">
      <div className="row gap-12 wrap-row pad-16"><h2 className="h3" id="gold-h">Your gold</h2><span className="tag">Only you can see this</span><span className="spacer" /><span className="muted xsmall">Updates when you sign in with Battle.net</span></div>
      <div className="tblbox gold-table">
        <table className="tbl">
          <thead><tr><th scope="col">Character</th><th scope="col" className="r">On hand</th><th scope="col" className="r">Gained</th><th scope="col" className="r">Lost</th><th scope="col" className="r">Item value</th><th scope="col">Shown</th></tr></thead>
          <tbody>
            {data.characters.map((c) => (
              <tr key={c.id}>
                <td><Link to={`/c/${encodeURIComponent(c.slug)}/collections`}>{c.name} <span className="surname">{c.surname}</span></Link><span className="muted xsmall"> · {formatDate(c.fetchedAt)}</span></td>
                <td className="r strong">{formatMoney(c.fields.money)}</td>
                <td className="r">{formatMoney(c.fields.gained)}</td>
                <td className="r">{formatMoney(c.fields.lost)}</td>
                <td className="r">{formatMoney(c.fields.items)}</td>
                <td>{c.public ? 'Public' : 'Private'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
