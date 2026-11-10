/** What each ?error= code from the OAuth callback (server/auth/routes.js) means, in plain words. */
export const AUTH_ERRORS = {
  cancelled: 'Sign-in was cancelled at the provider. Nothing changed.',
  expired: 'That sign-in took too long or was started in another browser. Try again.',
  state_mismatch: "That sign-in didn't come back the way it left, so it was stopped. Try again.",
  provider_failed: "The provider didn't confirm who you are. Try again in a moment.",
  not_configured: "That sign-in method isn't set up yet.",
  switched_off: 'That sign-in method is switched off for now, so nothing changed. Every other way to sign in still works.',
  unknown_provider: "That sign-in method doesn't exist.",
  linked_elsewhere: 'That login already belongs to a different Everstats account. To combine them, sign in to this account and use "Merge into another account" below.',
  merge_no_account: "No Everstats account uses that login, so there's nothing to merge into. (Nothing was created.)",
  same_account: "That's the account you're signed in to already.",
  banned_identity: 'That login belongs to a banned Everstats account, so it can’t be linked to another one while the ban lasts.',
  merge_banned: 'One of these accounts is banned, so they can’t be merged while the ban lasts.',
  characters_other_account: "That Battle.net login isn't the one linked to this Everstats account, so its characters weren't read. Sign in to Battle.net as the linked account and try again.",
};

export const authError = (code) => (code ? AUTH_ERRORS[code] ?? 'Something went wrong. Try again.' : null);
