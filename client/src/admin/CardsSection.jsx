import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { formatDateTime, formatNumber } from '../format.js';
import { SettingRow } from './AdminPages.jsx';

/**
 * /admin → Share cards (0.8.0): how many cards render at once (cards.maxConcurrent), the times this web process
 * measured (since it started; nothing is estimated), and the image cache (Blizzard data: kept a few hours at most and
 * never past the retention window; never in a backup).
 */
export function CardsSection({ settings, onSaved }) {
  const [data, setData] = useState(null);
  useEffect(() => {
    let live = true;
    api('/api/admin/cards').then((d) => { if (live) setData(d); }, () => {});
    return () => {
      live = false;
    };
  }, []);
  const recent = data?.renderer?.recent ?? [];
  const sorted = recent.map((r) => r.ms).sort((a, b) => a - b);
  return (
    <section className="panel pad-20 stack gap-16" aria-labelledby="cards-h">
      <h2 className="h2 h2-panel" id="cards-h">Share cards</h2>
      {settings.filter((s) => s.section === 'cards').map((s) => <SettingRow key={s.key} setting={s} onSaved={onSaved} />)}
      {!data ? <span className="t2 small" role="status">Loading…</span> : (
        <div className="stack gap-8 small">
          <span>Renderer: {data.renderer?.browser ? 'Chromium running' : 'idle (Chromium starts on the next render)'} · {formatNumber(data.renderer?.running ?? 0)} rendering · {formatNumber(data.renderer?.waiting ?? 0)} waiting</span>
          <span>{sorted.length ? `Last ${sorted.length} renders: median ${formatNumber(sorted[Math.floor(sorted.length / 2)])} ms, slowest ${formatNumber(sorted.at(-1))} ms` : 'No card rendered since this process started.'}</span>
          <span>Cache: {formatNumber(data.cache.images)} image{data.cache.images === 1 ? '' : 's'}, {formatNumber(Math.round(data.cache.bytes / 1024 / 1024 * 10) / 10)} MB{data.cache.oldest_data ? ` · oldest Blizzard data in it from ${formatDateTime(data.cache.oldest_data)}` : ''}</span>
          <span>Saved defaults: {data.defaults.length ? data.defaults.map((d) => `${formatNumber(d.n)} ${d.kind}`).join(' · ') : 'none yet'}</span>
        </div>
      )}
    </section>
  );
}
