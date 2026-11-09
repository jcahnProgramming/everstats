import { Link } from 'react-router-dom';

/**
 * /privacy: plainly, what an account stores, where character data comes from, how hiding works, and how to delete an
 * account. Every statement here describes what the code does (server/core/schema.js, account/routes.js); if one
 * changes, this page changes with it.
 */
export function PrivacyPage() {
  return (
    <div className="wrap page-pad stack gap-24 narrow-wrap privacy">
      <h1 className="h1">Privacy</h1>
      <p className="lead">Everstats is a fan site for WoW Forever statistics. You don't need an account to use it.</p>

      <section className="panel pad-24 stack gap-10" aria-labelledby="acct-h">
        <h2 className="h2 h2-panel" id="acct-h">What an Everstats account stores</h2>
        <ul className="t2 stack gap-6">
          <li>Which sign-ins you've linked: the Battle.net or Discord account id, and the name it shows (your BattleTag or Discord name). Everstats never asks for your email.</li>
          <li>Your passkeys' public keys (never anything secret from your device), and, if you turn it on, your two-factor secret, encrypted, plus one-way fingerprints of your recovery codes.</li>
          <li>Your theme, your pinned statistics and featured character, which characters are yours and whether you've hidden them.</li>
          <li>When the account was made, and whether that was during the beta.</li>
          <li>A log of what happened to the account (signed in, linked, 2FA turned on…). Never a password, a code or a token.</li>
          <li>A sign-in cookie. There are no tracking or advertising cookies, and no third-party scripts. The one thing your browser loads from elsewhere is a character's render picture, straight from Blizzard's render server.</li>
        </ul>
      </section>

      <section className="panel pad-24 stack gap-10" aria-labelledby="chars-h">
        <h2 className="h2 h2-panel" id="chars-h">Where character data comes from</h2>
        <p className="t2">Every character, statistic, piece of gear and render comes from Blizzard's public API, which shows any character of level 10 or more to anyone who asks. Everstats looks characters up when someone searches, refreshes them daily, and keeps a daily snapshot of their statistics.</p>
        <p className="t2">When you sign in with Battle.net, Everstats uses that sign-in once to read the list of Forever characters on your Battle.net account, so it can add them and mark them as yours. The permission is then thrown away: it isn't stored, and it can't be used again.</p>
      </section>

      <section className="panel pad-24 stack gap-10" aria-labelledby="hide-h">
        <h2 className="h2 h2-panel" id="hide-h">Hiding a character</h2>
        <p className="t2">In <Link to="/settings#characters">Settings</Link> you can hide any character that's yours. A hidden character has no public page and is on no leaderboard; you still see its page when signed in. Blizzard's own API still shows it to anyone who asks Blizzard directly: hiding only covers Everstats.</p>
      </section>

      <section className="panel pad-24 stack gap-10" aria-labelledby="delete-h">
        <h2 className="h2 h2-panel" id="delete-h">Deleting your account</h2>
        <p className="t2">In <Link to="/settings#delete">Settings → Delete account</Link>. It removes the account, its sign-in links, passkeys, two-factor settings, pins and its claim on your characters, and signs you out. Your characters stay tracked as the public data they are; any you had hidden stay hidden. It can't be undone.</p>
      </section>
    </div>
  );
}
