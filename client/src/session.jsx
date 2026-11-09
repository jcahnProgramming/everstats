import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api } from './api.js';

/**
 * Who this browser is signed in as, which sign-in providers are set up, and the theme. Loaded once per page load
 * and refreshed after anything that changes it (sign-in, sign-out, theme, merge).
 *
 * The theme is applied to <html data-theme> here too, so a change in Settings shows at once; the boot script
 * (/api/theme-boot.js) applies it before first paint on the next load. Signed out, it is always Forever.
 */
const SessionContext = createContext(null);

export function SessionProvider({ children }) {
  const [state, setState] = useState({ loading: true, signedIn: false, stage: null, theme: 'forever', providers: [], beta: null, error: null });

  const refresh = useCallback(async () => {
    try {
      const s = await api('/api/session');
      setState({ loading: false, error: null, ...s });
    } catch (err) {
      setState((prev) => ({ ...prev, loading: false, error: err.message }));
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (state.loading) return;
    document.documentElement.setAttribute('data-theme', state.signedIn ? state.theme : 'forever');
  }, [state.loading, state.signedIn, state.theme]);

  const value = useMemo(() => ({ ...state, refresh, setTheme: (theme) => setState((s) => ({ ...s, theme })) }), [state, refresh]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export const useSession = () => useContext(SessionContext);
