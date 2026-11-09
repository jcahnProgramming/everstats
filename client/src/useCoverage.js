import { useEffect, useState } from 'react';
import { api } from './api.js';

/**
 * What Everstats covers right now (/api/coverage): region, whether lookups are built, the rulesets (null until
 * loaded from Blizzard), tracked characters (null: not measured) and the grading minimum. Every empty state reads it.
 */
export function useCoverage() {
  const [coverage, setCoverage] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => {
    let live = true;
    api('/api/coverage').then((c) => {
      if (live) setCoverage(c);
    }, (err) => {
      if (live) setError(err.message);
    });
    return () => {
      live = false;
    };
  }, []);
  return { coverage, error };
}
