/**
 * 0.7.1, the admin's Activity panel: a page opened from a search says so once (`?via=search` on its API call), so the
 * server can COUNT searches. Once per history entry: Refresh or a re-render doesn't count it again. Nothing about the
 * visitor is sent or kept.
 */
const counted = new Set();
export function viaSearchOnce() {
  const st = typeof window === 'undefined' ? null : window.history.state;
  if (st?.usr?.via !== 'search' || !st.key || counted.has(st.key)) return '';
  counted.add(st.key);
  return '?via=search';
}
