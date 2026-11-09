import express from 'express';
import { HttpError, route } from '../core/errors.js';
import { limitBy } from '../core/rateLimit.js';
import { peekFlow, startFlow, takeFlow, updateFlowData } from '../auth/flows.js';
import { registrationOptions, verifyRegistration } from '../auth/passkeys.js';
import { getProvider } from '../auth/providers.js';
import { providerStatus, secondFactorAttempt } from '../auth/routes.js';
import { logAccountEvent, requireAccount, startSession } from '../auth/sessions.js';
import { beginSetup, checkCode, issueRecoveryCodes, recoveryCodesLeft, totpState } from '../auth/totp.js';
import { MERGE_STEPS, mergeAccounts } from './merge.js';
import { betaState } from '../beta.js';
import { clearCookie, COOKIE } from '../auth/cookies.js';
import { MIN_TRACKED_LEVEL } from '../crawler/fetch.js';
import { setHidden } from '../crawler/store.js';
import { SOURCES } from '../sources/registry.js';
import { loadCatalog } from '../stats/catalog.js';
import { MAX_PINS, pinCards, pinsOf, setPins } from '../stats/pins.js';
import { PLATFORMS, checkBio, checkHandle, linkFor } from '../accounts/socials.js';
import { checkDisplayName, reservedSet } from '../accounts/names.js';
import { availability, changeUsername, holdName } from '../accounts/usernames.js';
import { inlineBadges } from '../badges/store.js';
import { CREATOR_PLATFORMS, creatorState, handlesChanged, shownHandle } from '../badges/creators.js';
import { activeBan, banNotice } from '../moderation/bans.js';

/** The three themes. Logged-out visitors always get Forever; a signed-in account's choice is stored on it. */
export const THEMES = ['forever', 'alliance', 'horde'];

const MAX_PASSKEYS = 20;

async function accountView(db, accountId) {
  const account = await db.one('SELECT id, created_at, theme, beta_member, beta_since, username, username_claimed, display_name, rename_allowance, profile_bio, profile_show_pins FROM accounts WHERE id = $1', [accountId]);
  const links = await db.query('SELECT platform, handle FROM account_social_links WHERE account_id = $1 ORDER BY platform LIMIT 50', [accountId]);
  if (!account) throw new HttpError(401, 'Sign in first.', 'signed_out');
  const identities = await db.query(
    'SELECT id, provider, display_name, linked_at, last_used_at FROM account_identities WHERE account_id = $1 ORDER BY linked_at LIMIT 20',
    [accountId],
  );
  const passkeys = await db.query(
    'SELECT id, name, created_at, last_used_at FROM passkeys WHERE account_id = $1 ORDER BY created_at LIMIT $2',
    [accountId, MAX_PASSKEYS],
  );
  const totp = await totpState(db, accountId);
  // 0.8.1: creator verification, as the player sees it: the code while it matters, and which handles carry a Verified
  // mark right now (only ones still exactly on the profile). Admin notes and alerts are never sent here.
  const creator = await creatorState(db, accountId);
  const current = new Map(links.map((l) => [l.platform, l.handle]));
  return {
    id: account.id,
    createdAt: account.created_at,
    theme: account.theme,
    // The username is the account's identity and URL; until it is claimed it's a placeholder, shown only to its owner.
    username: account.username,
    usernameClaimed: account.username_claimed,
    displayName: account.display_name ?? (account.username_claimed ? account.username : null),
    displayNameSet: account.display_name !== null,
    renamesLeft: account.rename_allowance,
    // The public profile's own fields (0.4.2): Everstats' data, written by the player.
    profile: {
      bio: account.profile_bio,
      showPins: account.profile_show_pins,
      links: Object.fromEntries(links.map((l) => [l.platform, l.handle])),
      platforms: PLATFORMS.map((p) => ({ id: p.id, label: p.label, help: p.help, example: linkFor(p.id, 'yourname') })),
      creator: creator && creator.state !== 'revoked' ? {
        state: creator.state,
        code: creator.code,
        platforms: CREATOR_PLATFORMS.map((p) => PLATFORMS.find((x) => x.id === p)?.label ?? p),
        verified: creator.state === 'verified'
          ? creator.handles.filter((h) => current.get(h.platform) === h.handle).map((h) => ({ platform: h.platform, label: h.label, handle: shownHandle(h.platform, h.handle) }))
          : [],
      } : null,
    },
    identities: identities.map((i) => ({
      id: i.id,
      provider: i.provider,
      label: getProvider(i.provider)?.label ?? i.provider,
      displayName: i.display_name,
      linkedAt: i.linked_at,
      lastUsedAt: i.last_used_at,
    })),
    passkeys: passkeys.map((p) => ({ id: p.id, name: p.name, createdAt: p.created_at, lastUsedAt: p.last_used_at })),
    twoFactor: {
      state: totp.state === 'enabled' ? 'on' : 'off',
      enabledAt: totp.enabledAt,
      recoveryCodesLeft: totp.state === 'enabled' ? await recoveryCodesLeft(db, accountId) : 0,
    },
    // Recorded once, at creation, by the beta window (schema.js 009_beta). Read-only everywhere.
    beta: { member: account.beta_member, since: account.beta_since },
    characters: (await ownedCharacters(db, accountId)).map(characterState),
    // Providers whose sign-in can bring characters in (a data source names them as its userProvider).
    characterProviders: SOURCES.map((x) => x.userProvider).filter(Boolean),
  };
}

/** The characters an account owns (brought in from its Battle.net account list), highest level first. */
async function ownedCharacters(db, accountId) {
  return db.query(
    `SELECT c.*, r.name AS ruleset_name,
            EXISTS (SELECT 1 FROM crawl_queue q WHERE q.kind = 'character' AND q.key = c.slug AND q.state IN ('queued', 'running')) AS queued,
            EXISTS (SELECT 1 FROM character_render_hidden h WHERE h.character_id = c.id) AS render_hidden
       FROM characters c LEFT JOIN rulesets r ON r.id = c.ruleset_id
      WHERE c.owner_account_id = $1 AND c.profile_state <> 'purged' ORDER BY c.level DESC NULLS LAST, c.id LIMIT 50`,
    [accountId],
  );
}

/**
 * The honest state of an owned character:
 *   tracked      fetched: on the boards (unless hidden)
 *   fetching     queued for a fetch right now
 *   under_10     the account list says it's below level 10: Blizzard lists characters from level 10
 *   not_visible  level 10+, but the profile answers 404: not logged out since reaching 10, or Blizzard hasn't caught
 *                up yet (the account list can run 20–40 minutes ahead of the profile)
 *   missing      0.4.2: Blizzard returned it before and doesn't now. Still retried; "since" is the last success. Past the
 *                retention window its Blizzard data is purged and it leaves the list until a sign-in finds it again.
 */
function characterState(c) {
  const level = c.level ?? c.account_level;
  let state;
  if (c.profile_state === 'ok' && c.missing_since) state = 'missing';
  else if (c.profile_state === 'ok' && c.stats_fetched_at) state = 'tracked';
  else if (c.queued) state = 'fetching';
  else if (Number.isInteger(level) && level < MIN_TRACKED_LEVEL) state = 'under_10';
  else state = 'not_visible';
  return {
    id: c.id, slug: c.slug, name: c.name, surname: c.surname, level, class: c.class, race: c.race, faction: c.faction,
    ruleset: c.ruleset_id !== null ? { id: c.ruleset_id, name: c.ruleset_name } : null,
    hidden: c.hidden, renderHidden: c.render_hidden, state, checkedAt: c.last_checked_at, fetchedAt: c.last_fetched_at, since: state === 'missing' ? c.data_fetched_at : null,
  };
}

/** How many ways the account has to sign in: providers + passkeys. Removing the last one is refused. */
async function signInMethods(q, accountId) {
  const row = await q.one(
    `SELECT (SELECT count(*) FROM account_identities WHERE account_id = $1)::int
          + (SELECT count(*) FROM passkeys WHERE account_id = $1)::int AS n`,
    [accountId],
  );
  return row.n;
}

export function createAccountRouter({ db, limits, networkOf }) {
  const r = express.Router();
  const writes = limitBy(limits.writes, networkOf);
  const starts = limitBy(limits.authStarts, networkOf);

  // Public: who this browser is signed in as (if anyone), its theme, and which providers can sign in.
  r.get('/session', route(async (req, res) => {
    const providers = await providerStatus(db);
    const beta = await betaState(db);
    if (!req.session) return res.json({ signedIn: false, stage: null, theme: 'forever', providers, beta });
    // 0.8.2: a banned sign-in sees only its ban notice and the appeal form. A full session whose account was banned
    // since (a sign-in racing the ban) becomes a banned one. A banned session whose ban has ended is signed out.
    const ban = req.session.stage === 'second_factor' ? null : await activeBan(db, req.session.accountId);
    if (req.session.stage === 'banned' || ban) {
      if (!ban) {
        await db.query('DELETE FROM sessions WHERE id_hash = $1', [req.session.idHash]);
        clearCookie(res, COOKIE.session);
        return res.json({ signedIn: false, stage: null, theme: 'forever', providers, beta, banEnded: true });
      }
      if (req.session.stage !== 'banned') await db.query("UPDATE sessions SET stage = 'banned' WHERE id_hash = $1", [req.session.idHash]);
      return res.json({ signedIn: false, stage: 'banned', theme: 'forever', providers, beta, ban: banNotice(ban) });
    }
    if (req.session.stage !== 'full') return res.json({ signedIn: false, stage: req.session.stage, theme: 'forever', providers, beta });
    const account = await db.one('SELECT theme, username, username_claimed, display_name FROM accounts WHERE id = $1', [req.session.accountId]);
    const dismissed = (await db.one('SELECT username_prompt_dismissed AS d FROM sessions WHERE id_hash = $1', [req.session.idHash]))?.d ?? false;
    // 0.7.0: the one inline badge next to the name in the header, and how many badge toasts are waiting.
    const badge = (await inlineBadges(db, [req.session.accountId])).get(Number(req.session.accountId)) ?? null;
    const toasts = (await db.one('SELECT count(*)::int AS n FROM badge_awards WHERE account_id = $1 AND toast IS NOT NULL', [req.session.accountId])).n;
    // 0.7.1: threads Everstats replied to that the player hasn't opened yet (the unread dot on the account button).
    const feedbackUnread = (await db.one('SELECT count(*)::int AS n FROM feedback_threads WHERE account_id = $1 AND player_unread', [req.session.accountId])).n;
    // 0.8.2: warnings and other moderation notes the player hasn't acknowledged (shown once, moderation/player.js).
    const notices = (await db.one('SELECT count(*)::int AS n FROM moderation_actions WHERE account_id = $1 AND notice AND acknowledged_at IS NULL', [req.session.accountId])).n;
    return res.json({
      badgeToasts: toasts,
      feedbackUnread,
      notices,
      signedIn: true, stage: 'full', theme: account?.theme ?? 'forever', providers, beta,
      user: {
        username: account.username,
        claimed: account.username_claimed,
        displayName: account.display_name ?? (account.username_claimed ? account.username : null),
        // Every sign-in until a name is claimed; "Not now" lasts for this sign-in only.
        promptUsername: !account.username_claimed && !dismissed,
        badge: account.username_claimed ? badge : null,
      },
    });
  }));

  r.use('/account', requireAccount);

  r.get('/account', route(async (req, res) => res.json({ account: await accountView(db, req.session.accountId) })));

  r.put('/account/theme', writes, route(async (req, res) => {
    const theme = req.body?.theme;
    if (!THEMES.includes(theme)) throw new HttpError(400, 'Unknown theme', 'invalid');
    await db.query('UPDATE accounts SET theme = $2 WHERE id = $1', [req.session.accountId, theme]);
    res.json({ theme });
  }));

  r.delete('/account/identities/:id', writes, route(async (req, res) => {
    const id = Number(req.params.id);
    await db.tx(async (q) => {
      await q.query('SELECT id FROM accounts WHERE id = $1 FOR UPDATE', [req.session.accountId]);
      const row = await q.one('SELECT provider FROM account_identities WHERE id = $1 AND account_id = $2', [id, req.session.accountId]);
      if (!row) throw new HttpError(404, 'That sign-in method is not on this account.');
      if ((await signInMethods(q, req.session.accountId)) <= 1) {
        throw new HttpError(409, "That's the only way into this account. Link another provider or add a passkey first.", 'last_method');
      }
      await q.query('DELETE FROM account_identities WHERE id = $1', [id]);
      await logAccountEvent(q, req.session.accountId, 'identity.unlinked', { provider: row.provider });
    });
    res.json({ account: await accountView(db, req.session.accountId) });
  }));

  // ---- Username and display name ----
  // Availability while typing. Signed in only, and limited per network AND per account (rateLimit.js), so it can't be
  // used to walk the namespace or the reserved list; a reserved name says only "That name is reserved".
  r.get('/account/username/check', route(async (req, res) => {
    const net = limits.usernameChecksByNetwork.take(networkOf(req));
    const acct = net && limits.usernameChecksByAccount.take(`account:${req.session.accountId}`);
    if (!net || !acct) {
      limits.usernameChecksByNetwork.refund(net);
      throw new HttpError(429, 'You’ve checked a lot of names. Wait a few minutes and try again.', 'rate_limited');
    }
    const name = typeof req.query.name === 'string' ? req.query.name.slice(0, 40) : '';
    const a = await availability(db, name, req.session.accountId, await reservedSet(db));
    res.json(a.ok ? { ok: true, name: a.name } : { ok: false, reason: a.reason, message: a.message });
  }));

  r.put('/account/username', writes, route(async (req, res) => {
    await changeUsername(db, req.session.accountId, req.body?.username, await reservedSet(db));
    res.json({ account: await accountView(db, req.session.accountId) });
  }));

  r.put('/account/display-name', writes, route(async (req, res) => {
    const acct = await db.one('SELECT username_claimed FROM accounts WHERE id = $1', [req.session.accountId]);
    if (!acct.username_claimed) throw new HttpError(409, 'Claim a username first: your display name starts as your username.', 'not_claimed');
    let value = null;
    if (req.body?.displayName !== null) {
      const d = checkDisplayName(req.body?.displayName, await reservedSet(db, { forDisplay: true }));
      if (!d.ok) throw new HttpError(400, d.message, d.reason);
      value = d.value;
    }
    await db.tx(async (q) => {
      await q.query('UPDATE accounts SET display_name = $2 WHERE id = $1', [req.session.accountId, value]);
      await logAccountEvent(q, req.session.accountId, 'display_name.changed', {});
    });
    res.json({ account: await accountView(db, req.session.accountId) });
  }));

  // The public profile's fields: bio, social handles (never URLs), whether pinned stats show. Each field is checked and
  // refused with a plain reason; nothing is saved unless all of it is valid.
  r.put('/account/profile', writes, route(async (req, res) => {
    const accountId = req.session.accountId;
    const body = req.body ?? {};
    const bio = checkBio(body.bio);
    if (!bio.ok) throw new HttpError(400, bio.message, 'invalid');
    const links = [];
    for (const [platform, raw] of Object.entries(body.links ?? {}).slice(0, 20)) {
      if (raw === null || String(raw).trim() === '') continue;
      const h = checkHandle(platform, raw);
      if (!h.ok) throw new HttpError(400, h.message, 'invalid');
      links.push([platform, h.handle]);
    }
    await db.tx(async (q) => {
      await q.query('UPDATE accounts SET profile_bio = $2, profile_show_pins = $3 WHERE id = $1', [accountId, bio.value, body.showPins !== false]);
      await q.query('DELETE FROM account_social_links WHERE account_id = $1', [accountId]);
      for (const [platform, handle] of links) await q.query('INSERT INTO account_social_links (account_id, platform, handle) VALUES ($1, $2, $3)', [accountId, platform, handle]);
      // 0.8.1: a verified creator handle that changed (or went) loses its Verified mark now; the admin is told.
      await handlesChanged(q, accountId, new Map(links));
      await logAccountEvent(q, accountId, 'profile.changed', {});
    });
    res.json({ account: await accountView(db, accountId) });
  }));

  r.post('/account/username/prompt-dismiss', route(async (req, res) => {
    await db.query('UPDATE sessions SET username_prompt_dismissed = true WHERE id_hash = $1', [req.session.idHash]);
    res.json({ ok: true });
  }));

  // ---- The signed-in dashboard: featured character, pinned statistics, every owned character's state ----
  r.get('/dashboard', requireAccount, route(async (req, res) => {
    const accountId = req.session.accountId;
    const acct = await db.one('SELECT featured_character_id FROM accounts WHERE id = $1', [accountId]);
    const owned = await ownedCharacters(db, accountId);
    const characters = owned.map(characterState);
    const tracked = owned.filter((c) => c.profile_state === 'ok' && c.stats_fetched_at && c.ruleset_id !== null && !c.missing_since);
    const featuredRow = tracked.find((c) => c.id === acct.featured_character_id)
      ?? [...tracked].sort((a, b) => (b.level ?? 0) - (a.level ?? 0) || a.id - b.id)[0] ?? null;
    const identities = await db.query('SELECT provider FROM account_identities WHERE account_id = $1 LIMIT 20', [accountId]);
    const check = await db.one('SELECT provider, checked_at, outcome, characters FROM account_character_checks WHERE account_id = $1 ORDER BY checked_at DESC LIMIT 1', [accountId]);
    const { ids, isDefault } = await pinsOf(db, accountId);
    const pins = featuredRow ? await pinCards(db, ids, featuredRow) : [];
    const { lettersFor } = await import('../tiers/store.js');
    const { tierBrief } = await import('../tiers/view.js');
    const letters = await lettersFor(db, owned.filter((c) => !c.hidden).map((c) => c.id));
    res.json({
      characters: characters.map((c) => ({ ...c, tier: c.hidden ? null : letters.get(Number(c.id)) ?? null })),
      featured: featuredRow ? { ...characters.find((c) => c.id === featuredRow.id), fetchedAt: featuredRow.last_fetched_at, tier: await tierBrief(db, featuredRow) } : null,
      featuredChosen: Boolean(featuredRow && featuredRow.id === acct.featured_character_id),
      pins,
      pinIds: ids,
      pinsAreDefault: isDefault,
      characterProviders: SOURCES.map((x) => x.userProvider).filter(Boolean),
      linked: identities.map((i) => i.provider),
      lastCheck: check ? { provider: check.provider, at: check.checked_at, outcome: check.outcome, characters: check.characters } : null,
    });
  }));

  r.put('/account/featured', writes, route(async (req, res) => {
    const id = req.body?.characterId;
    if (!Number.isSafeInteger(id)) throw new HttpError(400, 'Choose one of your characters.', 'invalid');
    const own = await db.one("SELECT 1 AS x FROM characters WHERE id = $1 AND owner_account_id = $2 AND profile_state = 'ok'", [id, req.session.accountId]);
    if (!own) throw new HttpError(404, 'That isn’t one of your tracked characters.');
    await db.query('UPDATE accounts SET featured_character_id = $2 WHERE id = $1', [req.session.accountId, id]);
    res.json({ ok: true });
  }));

  r.get('/account/pins', route(async (req, res) => {
    const { ids, isDefault } = await pinsOf(db, req.session.accountId);
    res.json({ pinIds: ids, isDefault });
  }));

  r.put('/account/pins', writes, route(async (req, res) => {
    const ids = req.body?.statisticIds;
    if (!Array.isArray(ids) || ids.length > MAX_PINS || !ids.every(Number.isSafeInteger)) throw new HttpError(400, `Pin up to ${MAX_PINS} statistics.`, 'invalid');
    const { statistics } = await loadCatalog(db);
    const clean = [...new Set(ids)].filter((id) => statistics.has(id));
    await db.tx((q) => setPins(q, req.session.accountId, clean));
    res.json({ pinIds: clean });
  }));

  r.put('/account/characters/:id/hidden', writes, route(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || typeof req.body?.hidden !== 'boolean') throw new HttpError(400, 'Say whether to hide it.', 'invalid');
    await db.tx(async (q) => {
      const own = await q.one('SELECT id FROM characters WHERE id = $1 AND owner_account_id = $2 FOR UPDATE', [id, req.session.accountId]);
      if (!own) throw new HttpError(404, 'That isn’t one of your characters.');
      await setHidden(q, id, req.body.hidden);
      await logAccountEvent(q, req.session.accountId, req.body.hidden ? 'character.hidden' : 'character.shown', { character: id });
    });
    res.json({ account: await accountView(db, req.session.accountId) });
  }));

  // 0.7.1: "Hide my render" (Settings → Characters, and the owner's own character page). The owner's choice; Blizzard's
  // render server sometimes draws a character wrong. Showing it again deletes the row (the owner asked; logged).
  r.put('/account/characters/:id/render', writes, route(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || typeof req.body?.hidden !== 'boolean') throw new HttpError(400, 'Say whether to hide the render.', 'invalid');
    await db.tx(async (q) => {
      const own = await q.one('SELECT id FROM characters WHERE id = $1 AND owner_account_id = $2 FOR UPDATE', [id, req.session.accountId]);
      if (!own) throw new HttpError(404, 'That isn’t one of your characters.');
      if (req.body.hidden) {
        await q.query('INSERT INTO character_render_hidden (character_id, account_id) VALUES ($1, $2) ON CONFLICT (character_id) DO UPDATE SET account_id = EXCLUDED.account_id', [id, req.session.accountId]);
        // 0.8.0: no cached share card keeps showing the render.
        const { forgetCharacter } = await import('../cards/store.js');
        await forgetCharacter(q, id);
      } else {
        await q.query('DELETE FROM character_render_hidden WHERE character_id = $1', [id]);
      }
      await logAccountEvent(q, req.session.accountId, req.body.hidden ? 'character.render_hidden' : 'character.render_shown', { character: id });
    });
    res.json({ account: await accountView(db, req.session.accountId) });
  }));

  // Deleting the account (a named deletion exception in CLAUDE.md). With 2FA on, a current code is needed too.
  // Its characters stay tracked as public data; a hidden one stays hidden.
  r.delete('/account', writes, route(async (req, res) => {
    const accountId = req.session.accountId;
    if (req.body?.confirm !== 'delete') throw new HttpError(400, 'Confirm that you want to delete the account.', 'invalid');
    if ((await totpState(db, accountId)).state === 'enabled') {
      if (!(await secondFactorAttempt({ db, limits, networkOf, req, accountId, code: req.body?.code }))) {
        throw new HttpError(401, "That code isn't right.", 'wrong_code');
      }
    }
    await db.tx(async (q) => {
      // A claimed username is held for 30 days after the account is deleted, so nobody can step into its profile
      // address straight away (it redirects nowhere).
      const named = await q.one('SELECT username FROM accounts WHERE id = $1 AND username_claimed', [accountId]);
      if (named) await holdName(q, named.username, null, 'renamed');
      await q.query('UPDATE characters SET owner_account_id = NULL, owned_since = NULL WHERE owner_account_id = $1', [accountId]);
      await q.query('DELETE FROM accounts WHERE id = $1', [accountId]);
      await q.query("INSERT INTO admin_events (type, detail) VALUES ('account.deleted', $1::jsonb)", [JSON.stringify({ account: accountId })]);
    });
    clearCookie(res, COOKIE.session);
    res.json({ ok: true });
  }));

  // ---- Passkeys (added only here, while signed in) ----
  r.post('/account/passkeys/options', starts, route(async (req, res) => {
    const existing = await db.query('SELECT credential_id, transports FROM passkeys WHERE account_id = $1 LIMIT $2', [req.session.accountId, MAX_PASSKEYS]);
    if (existing.length >= MAX_PASSKEYS) throw new HttpError(409, `An account can have up to ${MAX_PASSKEYS} passkeys.`, 'too_many');
    const options = await registrationOptions({
      userId: `account:${req.session.accountId}`,
      userName: `Everstats account ${req.session.accountId}`,
      existing,
    });
    await startFlow(db, res, 'passkey_register', { accountId: req.session.accountId, data: { challenge: options.challenge } });
    res.json({ options });
  }));

  r.post('/account/passkeys/verify', writes, route(async (req, res) => {
    const flow = await takeFlow(db, req, res, ['passkey_register']);
    if (!flow || flow.accountId !== req.session.accountId) throw new HttpError(400, 'That took too long. Try again.', 'expired');
    const reg = await verifyRegistration(req.body?.response, flow.data.challenge);
    if (!reg) throw new HttpError(400, "The passkey didn't verify. Try again.", 'passkey_failed');
    const name = typeof req.body?.name === 'string' && req.body.name.trim() ? req.body.name.trim().slice(0, 60) : 'Passkey';
    await db.tx(async (q) => {
      const taken = await q.one('SELECT 1 AS x FROM passkeys WHERE credential_id = $1', [reg.credentialId]);
      if (taken) throw new HttpError(409, 'That passkey is already registered.', 'duplicate');
      await q.query(
        'INSERT INTO passkeys (account_id, credential_id, public_key, sign_count, transports, name) VALUES ($1, $2, $3, $4, $5, $6)',
        [req.session.accountId, reg.credentialId, reg.publicKey, reg.counter, reg.transports, name],
      );
      await logAccountEvent(q, req.session.accountId, 'passkey.added', {});
    });
    res.json({ account: await accountView(db, req.session.accountId) });
  }));

  r.delete('/account/passkeys/:id', writes, route(async (req, res) => {
    const id = Number(req.params.id);
    await db.tx(async (q) => {
      await q.query('SELECT id FROM accounts WHERE id = $1 FOR UPDATE', [req.session.accountId]);
      const row = await q.one('SELECT 1 AS x FROM passkeys WHERE id = $1 AND account_id = $2', [id, req.session.accountId]);
      if (!row) throw new HttpError(404, 'That passkey is not on this account.');
      if ((await signInMethods(q, req.session.accountId)) <= 1) {
        throw new HttpError(409, "That's the only way into this account. Link a provider first.", 'last_method');
      }
      await q.query('DELETE FROM passkeys WHERE id = $1', [id]);
      await logAccountEvent(q, req.session.accountId, 'passkey.removed', {});
    });
    res.json({ account: await accountView(db, req.session.accountId) });
  }));

  // ---- 2FA ----
  r.post('/account/2fa/setup', writes, route(async (req, res) => {
    const setup = await db.tx((q) => beginSetup(q, req.session.accountId));
    res.json({ setup });
  }));

  // Confirms setup with a first code. Answers the recovery codes: the ONLY time they are ever shown.
  r.post('/account/2fa/enable', writes, route(async (req, res) => {
    const accountId = req.session.accountId;
    const codes = await db.tx(async (q) => {
      if (!(await checkCode(q, accountId, req.body?.code, { wantState: 'pending' }))) return null;
      await q.query("UPDATE account_totp SET state = 'enabled', enabled_at = now() WHERE account_id = $1", [accountId]);
      await logAccountEvent(q, accountId, 'two_factor.enabled', {});
      return issueRecoveryCodes(q, accountId);
    });
    if (!codes) throw new HttpError(400, "That code isn't right. Check your authenticator app and try the newest code.", 'wrong_code');
    res.json({ recoveryCodes: codes, account: await accountView(db, accountId) });
  }));

  r.post('/account/2fa/disable', writes, route(async (req, res) => {
    const accountId = req.session.accountId;
    if (!(await secondFactorAttempt({ db, limits, networkOf, req, accountId, code: req.body?.code }))) {
      throw new HttpError(401, "That code isn't right.", 'wrong_code');
    }
    await db.tx(async (q) => {
      await q.query('DELETE FROM account_totp WHERE account_id = $1', [accountId]);
      await q.query('DELETE FROM recovery_codes WHERE account_id = $1', [accountId]);
      await logAccountEvent(q, accountId, 'two_factor.disabled', {});
    });
    res.json({ account: await accountView(db, accountId) });
  }));

  r.post('/account/2fa/recovery-codes', writes, route(async (req, res) => {
    const accountId = req.session.accountId;
    if ((await totpState(db, accountId)).state !== 'enabled') throw new HttpError(409, '2FA is off.', 'not_enabled');
    if (!(await secondFactorAttempt({ db, limits, networkOf, req, accountId, code: req.body?.code }))) {
      throw new HttpError(401, "That code isn't right.", 'wrong_code');
    }
    const codes = await db.tx(async (q) => {
      await logAccountEvent(q, accountId, 'recovery_codes.regenerated', {});
      return issueRecoveryCodes(q, accountId);
    });
    res.json({ recoveryCodes: codes, account: await accountView(db, accountId) });
  }));

  // ---- Merge this account into another ----
  const mergeFlow = async (req) => {
    const flow = await peekFlow(db, req, ['merge']);
    return flow && flow.accountId === req.session.accountId ? flow : null;
  };

  r.get('/account/merge', route(async (req, res) => {
    const flow = await mergeFlow(req);
    if (!flow) return res.json({ merge: null, steps: MERGE_STEPS.map((s) => s.describe) });
    const target = await accountView(db, flow.data.target);
    return res.json({
      merge: {
        via: flow.data.via,
        needsCode: flow.data.needsCode,
        target: { id: target.id, createdAt: target.createdAt, identities: target.identities.map((i) => ({ label: i.label, displayName: i.displayName })), passkeys: target.passkeys.length },
      },
      steps: MERGE_STEPS.map((s) => s.describe),
    });
  }));

  r.post('/account/merge/code', route(async (req, res) => {
    const flow = await mergeFlow(req);
    if (!flow) throw new HttpError(400, 'That merge expired. Start again.', 'expired');
    if (!flow.data.needsCode) return res.json({ ok: true });
    if (!(await secondFactorAttempt({ db, limits, networkOf, req, accountId: flow.data.target, code: req.body?.code }))) {
      throw new HttpError(401, "That code isn't right for the other account.", 'wrong_code');
    }
    await updateFlowData(db, flow.idHash, { ...flow.data, needsCode: false });
    res.json({ ok: true });
  }));

  r.post('/account/merge/confirm', writes, route(async (req, res) => {
    const flow = await mergeFlow(req);
    if (!flow) throw new HttpError(400, 'That merge expired. Start again.', 'expired');
    if (flow.data.needsCode) throw new HttpError(401, "Enter the other account's 2FA code first.", 'needs_code');
    await takeFlow(db, req, res, ['merge']);
    const source = req.session.accountId;
    const target = flow.data.target;
    await db.tx(async (q) => {
      await mergeAccounts(q, source, target);
      await startSession(q, res, target, { stage: 'full', method: flow.data.via });
    });
    res.json({ ok: true, account: await accountView(db, target) });
  }));

  r.delete('/account/merge', route(async (req, res) => {
    if (await mergeFlow(req)) await takeFlow(db, req, res, ['merge']);
    res.json({ ok: true });
  }));

  return r;
}

