/** Display formatting shared by every page. US English (1.0 covers the US region only). */

export const formatNumber = (n) => (Number.isFinite(n) ? n.toLocaleString('en-US', { maximumFractionDigits: 2 }) : '—');

export const formatDate = (iso) => (iso ? new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : null);

/** "Nov 9" in the current year, "Nov 9, 2025" otherwise (0.9.2: short labels that must stay on one line). */
export const formatShortDate = (iso) => {
  if (!iso) return null;
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', d.getFullYear() === new Date().getFullYear() ? { month: 'short', day: 'numeric' } : { year: 'numeric', month: 'short', day: 'numeric' });
};

export const formatDateTime = (iso) => (iso ? new Date(iso).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' }) : null);

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "2026-11-08" → "8 Nov 2026", read as a calendar date so no time zone can shift it a day. */
export function formatCalendarDate(isoDate) {
  const [y, m, d] = String(isoDate).split('-').map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

/** "just now", "4 min ago", "3 h ago", "2 days ago". null → null (the caller says "never"). */
export function timeAgo(iso, now = Date.now()) {
  if (!iso) return null;
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 36) return `${h} h ago`;
  const d = Math.round(h / 24);
  return `${d} day${d === 1 ? '' : 's'} ago`;
}

/** Bytes as the admin reads them: "812 KB", "1.4 GB". */
export function formatBytes(n) {
  if (!Number.isFinite(n)) return null;
  const units = ['bytes', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${i === 0 ? v : v.toFixed(v >= 100 ? 0 : 1)} ${units[i]}`;
}
