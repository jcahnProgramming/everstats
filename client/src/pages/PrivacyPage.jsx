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
          <li>Your username, display name, bio and social handles (just the handles: Everstats builds the links), your theme, your pinned statistics and featured character, which characters are yours and whether you've hidden them.</li>
          <li>When the account was made, and whether that was during the beta.</li>
          <li>A log of what happened to the account (signed in, linked, 2FA turned on…). Never a password, a code or a token.</li>
          <li>A sign-in cookie. There are no tracking or advertising cookies, and no third-party scripts. The one thing your browser loads from elsewhere is a character's render picture, straight from Blizzard's render server.</li>
        </ul>
      </section>

      <section className="panel pad-24 stack gap-10" aria-labelledby="chars-h">
        <h2 className="h2 h2-panel" id="chars-h">Where character data comes from</h2>
        <p className="t2">Every character, statistic, piece of gear and render comes from Blizzard's public API, which shows any character of level 10 or more to anyone who asks. Everstats looks characters up when someone searches, refreshes them daily, and keeps a daily snapshot of their statistics.</p>
        <p className="t2">Guild pages come from the same API: Blizzard's public guild profile and roster, read once a day. A guild page lists only the members Everstats tracks; anyone on the roster it doesn't track (under level 10, or not fetched yet) is counted, never named. A character hidden by its owner appears on no guild page and counts toward no guild total or guild board.</p>
        <p className="t2"><b className="strong-text">Everstats keeps Blizzard's data for at most 30 days</b>, because Blizzard's API terms require it. In practice the site keeps 29 days, with one day of slack, so nothing from Blizzard is ever older than 30 days. Backups hold none of Blizzard's data at all: only Everstats' own (accounts, usernames, settings, pins, which characters are yours or hidden). That means history only goes back about four weeks: progress, rank movement and the “Last 29 days” boards cover that stretch and no further, for characters and guilds alike. A character Blizzard stops returning (deleted, renamed or private) disappears from Everstats once 30 days pass without Blizzard returning it.</p>
        <p className="t2">What you write yourself (your username, display name, bio, social handles, pins, hidden characters) is Everstats' own data and stays until you change it or delete your account.</p>
        <p className="t2">When you sign in with Battle.net, Everstats uses that sign-in once to read the list of Forever characters on your Battle.net account, so it can add them and mark them as yours. The permission is then thrown away: it isn't stored, and it can't be used again.</p>
      </section>

      <section className="panel pad-24 stack gap-10" aria-labelledby="coll-h">
        <h2 className="h2 h2-panel" id="coll-h">Collections and gold</h2>
        <p className="t2">A character's collections (mounts, pets, toys, titles, achievements, reputations, professions, dungeon and raid kills, quests, PvP summary and transmog appearances) come from Blizzard's public API like everything else, refresh about weekly, and follow the same 30-day limit. “Shared across this account” only appears when Blizzard says so, or when every character on the owner's Everstats account has the identical collection.</p>
        <p className="t2"><b className="strong-text">Gold is private.</b> Blizzard shares a character's gold only with its owner, so Everstats reads it only when you sign in with Battle.net, using that sign-in. It keeps four numbers (gold on hand, total gold gained, total gold lost, item value gained) for at most 30 days, and shows them only to you, unless you turn on “Show my gold stats publicly” for that character. Turning it off takes the character off the gold leaderboards at once. Blizzard's answer also carries the character's location and your WoW account number: <b className="strong-text">Everstats never stores, shows or logs either</b>; they're dropped the moment the answer arrives.</p>
      </section>

      <section className="panel pad-24 stack gap-10" aria-labelledby="hide-h">
        <h2 className="h2 h2-panel" id="hide-h">Hiding a character</h2>
        <p className="t2">In <Link to="/settings#characters">Settings</Link> you can hide any character that's yours. A hidden character has no public page and is on no leaderboard; you still see its page when signed in. Blizzard's own API still shows it to anyone who asks Blizzard directly: hiding only covers Everstats.</p>
      </section>

      <section className="panel pad-24 stack gap-10" aria-labelledby="render-h">
        <h2 className="h2 h2-panel" id="render-h">Hiding a render</h2>
        <p className="t2">Blizzard's render server sometimes draws a character wrong. The owner of a character can hide its render and avatar on Everstats (Settings → Characters, or on the character's own page); everyone, the owner included, then sees a plain frame that says the render was hidden. Everstats remembers only which character and when, until the owner shows it again. Anyone can use “Report a wrong render” under a render: it opens the feedback form.</p>
      </section>

      <section className="panel pad-24 stack gap-10" aria-labelledby="cards-h">
        <h2 className="h2 h2-panel" id="cards-h">Share cards and link previews</h2>
        <p className="t2">Share cards are pictures Everstats draws on its own server from the same public data as the pages, so they hold Blizzard data too: a drawn card is kept for a few hours at most, never past Blizzard's 30-day limit, and never in a backup. A hidden character has no card and no link preview, and hiding one deletes every drawn card that shows it at once. A render its owner hid is never drawn.</p>
        <p className="t2">If you own a character (or run a guild page) and press “Save as my default”, Everstats keeps your card choices (layout, theme, colour and which statistics) and who saved them, until you change them or delete your account. Anyone else's choices in the card maker are never stored.</p>
      </section>

      <section className="panel pad-24 stack gap-10" aria-labelledby="feedback-h">
        <h2 className="h2 h2-panel" id="feedback-h">Feedback</h2>
        <p className="t2">When you send <Link to="/feedback">feedback</Link>, Everstats keeps what you wrote, the kind of message, the Everstats page it was about and, if you gave one, your Discord username. Signed in, it's also linked to your account so replies can reach you in Your feedback. Nothing else is recorded with it: not your address, browser or device. A draft you haven't sent stays only in your own browser.</p>
        <p className="t2">Feedback is kept until Everstats deletes it, or until you delete your account (your messages and their replies go with it). A message sent signed out has no account to delete it with: ask on Discord, or send another message, if you'd like it removed.</p>
      </section>

      <section className="panel pad-24 stack gap-10" aria-labelledby="counts-h">
        <h2 className="h2 h2-panel" id="counts-h">Counting visits</h2>
        <p className="t2">To know whether people use it, Everstats counts a few kinds of event per hour: character searches and look-ups, guild searches and guild page views. Only the kind and a number are stored, never who: no IP address, no browser details, no visitor id, no cookie, and no third-party analytics. Traffic from a network already blocked for making too many look-ups isn't counted.</p>
      </section>

      <section className="panel pad-24 stack gap-10" aria-labelledby="delete-h">
        <h2 className="h2 h2-panel" id="delete-h">Deleting your account</h2>
        <p className="t2">In <Link to="/settings#delete">Settings → Delete account</Link>. It removes the account, its sign-in links, passkeys, two-factor settings, pins, badges, feedback, saved share cards, your characters' gold stats and your choices about showing them, and its claim on your characters, and signs you out. Your characters stay tracked as the public data they are; any you had hidden stay hidden. It can't be undone.</p>
      </section>
    </div>
  );
}
