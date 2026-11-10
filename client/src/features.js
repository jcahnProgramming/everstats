import { useSession } from './session.jsx';

/**
 * Feature switches (0.10.3, server/features/registry.js). /api/session carries `features`: { id: on } for every switch
 * players can see. A page asks useFeature(id) and shows the feature's declared fallback when it is off.
 *
 * Before the session has loaded (or if it couldn't load) a feature counts as ON: that is what the site did before the
 * switches existed, and the server refuses anything switched off on its own, with a plain message the page shows.
 */
export function useFeature(id) {
  const session = useSession();
  return session?.features?.[id] !== false;
}

/** Plain words for a switched-off feature, shared by every fallback so they read alike. */
export const OFF_WORDS = Object.freeze({
  'share-cards': 'Sharing is switched off for now.',
  collections: 'Collections are switched off for now.',
  gold: 'Gold is switched off for now.',
  'guild-fetch': 'Fetching a whole guild is switched off for now.',
  discord: 'Switched off for now',
  feedback: 'Feedback is closed for now.',
  reports: 'Reporting is switched off for now.',
});

/** A sign-in provider people can use right now: it has keys and its feature switch (if any) is on. */
export const providerUsable = (p) => Boolean(p?.configured) && !p?.switchedOff;

/** An API error that means "this feature is switched off" (server: requireFeature / 503 feature_off). */
export const isFeatureOff = (err) => err?.code === 'feature_off';
