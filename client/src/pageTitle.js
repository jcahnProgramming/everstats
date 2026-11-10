import { useEffect } from 'react';
import { fullTitle } from '../../server/core/pageTitles.js';

/**
 * A page whose title comes from its data (a character, a guild, a profile, a board) sets it once the data is in
 * (0.9.2). `title` null/undefined = not loaded yet: the shell's generic title (server/core/pageTitles.js) stays.
 */
export function usePageTitle(title) {
  useEffect(() => {
    if (title) document.title = fullTitle(title);
  }, [title]);
}
