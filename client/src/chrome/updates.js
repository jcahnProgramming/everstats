import { useEffect } from 'react';

/**
 * "Everstats was updated" (0.8.2). An open tab keeps running the app it loaded, even after a deploy: nothing makes a
 * single-page app fetch index.html again. This compares the running bundle's version with the server's (/api/health)
 * and, when they differ, asks for a reload: at once on the bar's "Refresh", or by itself on the next route change, as
 * long as nothing is being edited.
 *
 * "Being edited" (editingNow):
 *   - an editor that says so with useEditing(dirty): the card maker, the feedback form, the appeal form, admin forms …
 *   - an editor that was dirty when it unmounted, for the route change that unmounted it (its state may live on in a
 *     draft, or the person may come Back to it)
 *   - typing in any form field since the last route change, unless the field opts out with data-edit-guard="off" (the
 *     top-bar search, whose text is a navigation, not a draft)
 *   - focus inside a form field right now
 */
const editors = new Set();
let typedSinceRoute = false;
let leftDirtyEditor = false;

export function useEditing(dirty) {
  useEffect(() => {
    if (!dirty) return undefined;
    const token = {};
    editors.add(token);
    return () => {
      editors.delete(token);
      leftDirtyEditor = true;
    };
  }, [dirty]);
}

function isField(el) {
  if (!el || !(el instanceof Element)) return false;
  if (el.closest('[data-edit-guard="off"]')) return false;
  return el.matches('input:not([type=button]):not([type=submit]):not([type=checkbox]):not([type=radio]), textarea, [contenteditable="true"]');
}

if (typeof document !== 'undefined') {
  document.addEventListener('input', (e) => {
    if (isField(e.target)) typedSinceRoute = true;
  }, true);
}

/** Is anything being edited right now (or was, on the page this route change just left)? */
export function editingNow() {
  return editors.size > 0 || leftDirtyEditor || typedSinceRoute || isField(document.activeElement);
}

/** Called after each route change has been decided on: what was typed on the old page no longer counts. */
export function routeChanged() {
  typedSinceRoute = false;
  leftDirtyEditor = false;
}

/** The server's version, or null when it can't be read (offline, a deploy in progress). Never cached. */
export async function serverVersion() {
  try {
    const res = await fetch('/api/health', { cache: 'no-store', credentials: 'same-origin' });
    const body = await res.json().catch(() => null);
    return typeof body?.version === 'string' ? body.version : null;
  } catch {
    return null;
  }
}
