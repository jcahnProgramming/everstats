import { createContext, useCallback, useContext, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';

/**
 * The version + region the admin is looking at (0.10.3, design/v5-admin components/version-switcher.md). It lives in the
 * address as ?v=&r=, so a link or a reload keeps it; per-version pages read it with useScope(), global pages ignore it.
 * The switcher only changes what you're LOOKING at: whether a version runs is a Features switch.
 */
const ShellInfo = createContext({ versions: [], regions: [], primary: 'forever' });
export const ShellInfoProvider = ShellInfo.Provider;
export const useShellInfo = () => useContext(ShellInfo);

export function useScope() {
  const info = useShellInfo();
  const [params, setParams] = useSearchParams();
  const fallbackV = info.primary ?? 'forever';
  const v = params.get('v');
  const r = params.get('r');
  const version = info.versions.some((x) => x.id === v) ? v : fallbackV;
  const fallbackR = info.primaryRegion ?? info.regions[0]?.id ?? '';
  const region = info.regions.some((x) => x.id === r) ? r : fallbackR;
  const meta = info.versions.find((x) => x.id === version);
  const setScope = useCallback((next) => {
    setParams((p) => {
      const out = new URLSearchParams(p);
      if (next.version) out.set('v', next.version);
      if (next.region) out.set('r', next.region);
      return out;
    });
  }, [setParams]);
  // The query to carry onto other per-version links: only when it isn't the default, so plain addresses stay plain.
  const query = useMemo(() => {
    const q = new URLSearchParams();
    if (v && version !== fallbackV) q.set('v', version);
    if (r && region !== fallbackR) q.set('r', region);
    return q.toString();
  }, [v, r, version, region, fallbackV, fallbackR]);
  return {
    version, region, setScope, query,
    versionName: meta?.name ?? version,
    enabled: Boolean(meta?.enabled) && Boolean(info.regions.find((x) => x.id === region)?.enabled),
    /** For API calls: "v=forever&r=us". */
    apiQuery: `v=${encodeURIComponent(version)}&r=${encodeURIComponent(region)}`,
  };
}
