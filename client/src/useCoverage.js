import { useEffect, useState } from 'react';
import { api } from './api.js';

/**
 * What Everstats covers right now (/api/coverage): region, whether lookups are built, the rulesets (null until
 * loaded from Blizzard), tracked characters (null: not measured) and the grading minimum. Every empty state reads it.
 */
// 0.11.1: `version` names a game version on a page that belongs to none (home); a version page's own is the default.
export function useCoverage(version) {
  const [coverage, setCoverage] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => {
    let live = true;
    api('/api/coverage', { version }).then((c) => {
      if (live) setCoverage(c);
    }, (err) => {
      if (live) setError(err.message);
    });
    return () => {
      live = false;
    };
  }, [version]);
  return { coverage, error };
}
