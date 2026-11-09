/**
 * What a player is told about a moderation action (0.8.2), in plain player terms: what happened and why. Built from the
 * moderation_actions row (reason, optional message, detail). Never says who did it: always "Everstats".
 */
export const FIELD_LABELS = Object.freeze({
  display_name: 'display name',
  bio: 'bio',
  social: 'social handle',
  'guild.description': 'guild description',
  'guild.links': 'guild links',
  'guild.discord': 'guild Discord invite',
});

export function fieldWords(detail) {
  if (detail.field === 'social') return `${detail.platformLabel ?? 'social'} handle${detail.handle ? ` (${detail.handle})` : ''}`;
  if (detail.field?.startsWith('guild.')) return `${FIELD_LABELS[detail.field]} for ${detail.guildName ?? 'your guild'}`;
  return FIELD_LABELS[detail.field] ?? 'profile field';
}

export function noticeView(a) {
  const d = a.detail ?? {};
  const base = { id: Number(a.id), at: a.at, reason: a.reason ?? null, message: a.message ?? null };
  switch (a.type) {
    case 'warning':
      return { ...base, title: 'A warning from Everstats', text: 'Everstats has warned your account. Nothing else has changed: this is a note so you know.' };
    case 'username_reset':
      return {
        ...base,
        title: 'Your username was reset',
        text: `Everstats removed the username @${d.from ?? '…'} from your account and cleared your display name. Choose a new username: it doesn’t use up a rename.`,
      };
    case 'field_reset':
      return { ...base, title: `Your ${fieldWords(d)} was removed`, text: `Everstats removed your ${fieldWords(d)}. You can set a new one that follows the rules.` };
    case 'unban':
      return { ...base, title: 'Your ban was lifted', text: 'Everstats lifted the ban on your account. Your profile, badges and settings are back as they were.' };
    default:
      return { ...base, title: 'A note from Everstats', text: '' };
  }
}
