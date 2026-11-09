import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { Icon } from '../chrome/Icon.jsx';
import { formatDateTime, formatNumber, timeAgo } from '../format.js';

/**
 * "Fetch all members" (0.9.0, server/guilds/fetchAll.js): pulls a whole guild in now instead of the few members a day
 * the roster seeding finds. Step 1 reads Blizzard's roster (2 requests) and shows the counts and the cost; nothing
 * else is asked of Blizzard until the person presses Start. Then a background job fetches the members through the
 * shared crawler (never ahead of anyone's look-up, never more than half the request budget); this panel polls and shows
 * progress, and leaving the page cancels nothing.
 *
 * No mockup draws this (design v1's guild page predates it): built from the page's own parts (.panel, .note, .bar,
 * buttons), one panel under the banner.
 */
const POLL_MS = { roster: 2000, queued: 4000, running: 3000 };
const plural = (n, one, many = `${one}s`) => `${formatNumber(n)} ${n === 1 ? one : many}`;

/** "about 1 minute", "about 4 minutes", "about 2 hours" (never "0 minutes"). */
export function aboutDuration(seconds) {
  const s = Math.max(0, Number(seconds) || 0);
  if (s < 90 * 60) return `about ${plural(Math.max(1, Math.round(s / 60)), 'minute')}`;
  return `about ${plural(Math.round(s / 3600), 'hour')}`;
}

function CountLine({ counts }) {
  if (!counts || counts.roster === null || counts.roster === undefined) return null;
  return (
    <p className="t2 small gfetch-counts">
      <b className="strong-text">{formatNumber(counts.roster)}</b> member{counts.roster === 1 ? '' : 's'} on Blizzard’s roster
      {' · '}<b className="strong-text">{formatNumber(counts.tracked)}</b> tracked
      {' · '}<b className="strong-text">{formatNumber(counts.toFetch)}</b> to fetch (level 10+)
      {' · '}<b className="strong-text">{formatNumber(counts.underTen)}</b> under level 10
    </p>
  );
}

export function GuildFetch({ slug, onDone }) {
  const [s, setS] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const lastState = useRef(null);
  const base = `/api/guilds/${encodeURIComponent(slug)}/fetch-all`;

  const load = useCallback(async () => {
    try {
      const r = await api(base);
      setS(r);
      return r;
    } catch (err) {
      setError(err.message);
      return null;
    }
  }, [base]);

  useEffect(() => {
    load();
  }, [load]);

  // Poll while something is happening; when a fetch finishes, the guild page reloads its members and totals once.
  useEffect(() => {
    if (!s) return undefined;
    if (lastState.current && ['queued', 'running'].includes(lastState.current) && s.state === 'done') onDone?.();
    lastState.current = s.state;
    const every = POLL_MS[s.state];
    if (!every) return undefined;
    const t = setTimeout(() => {
      load();
    }, every);
    return () => {
      clearTimeout(t);
    };
  }, [s, load, onDone]);

  async function post(path) {
    setBusy(true);
    setError(null);
    try {
      setS(await api(`${base}/${path}`, { method: 'POST' }));
    } catch (err) {
      setError(err.message);
      await load();
    } finally {
      setBusy(false);
    }
  }

  if (!s) return null;
  const off = !s.configured;
  const rate = s.perSecond;

  return (
    <section className="panel pad-20 stack gap-12 gfetch" aria-labelledby="gfetch-h" aria-busy={['roster', 'running'].includes(s.state)}>
      <div className="row gap-10">
        <Icon name="guild" />
        <h2 className="h3" id="gfetch-h">Fetch every member</h2>
        {s.state === 'running' && <span className="tag">Fetching</span>}
        {s.state === 'queued' && <span className="tag">Queued</span>}
      </div>

      {(s.state === 'idle' || s.state === 'failed') && (
        <>
          <p className="t2 small">
            Everstats tracks a guild’s members as it finds them, a few a day. This fetches every level 10+ member now. First it reads
            Blizzard’s roster ({s.rosterRequests} requests) and shows you what fetching the rest would cost; nothing else starts until you say so.
          </p>
          {s.state === 'failed' && <div className="note err small" role="alert"><Icon name="error" /><span>{s.problem ?? 'That didn’t work.'}</span></div>}
          {off && <div className="note small"><Icon name="info" /><span>Look-ups aren’t switched on yet, so Everstats can’t ask Blizzard for this guild.</span></div>}
          <div className="row gap-8">
            <button type="button" className="btn" disabled={busy || off} onClick={() => post('roster')}>
              <Icon name="download" size="sm" />{busy ? 'Reading the roster…' : 'Fetch all members'}
            </button>
          </div>
        </>
      )}

      {s.state === 'roster' && <p className="t2 small" role="status">Reading Blizzard’s roster…</p>}

      {s.state === 'ready' && (
        <>
          <CountLine counts={s.counts} />
          {s.counts.toFetch > 0 ? (
            <>
              <p className="small">
                Fetching them costs <b className="strong-text">~{formatNumber(s.cost.requests)} requests</b> to Blizzard, {aboutDuration(s.cost.seconds)}
                <span className="muted"> (about {s.requestsPerMember} a member, at {formatNumber(rate)} a second: at most half of what Everstats may ask, so look-ups and the daily refresh keep going).</span>
              </p>
              <div className="row gap-8">
                <button type="button" className="btn" disabled={busy} onClick={() => post('start')}>
                  <Icon name="play" size="sm" />Start fetching {plural(s.counts.toFetch, 'member')}
                </button>
                <span className="muted xsmall">This roster count is good until {formatDateTime(s.expiresAt)}.</span>
              </div>
            </>
          ) : (
            <div className="note ok small"><Icon name="check" /><span>Every level 10+ member on the roster is already tracked. There’s nothing to fetch.</span></div>
          )}
        </>
      )}

      {s.state === 'queued' && (
        <>
          <CountLine counts={s.counts} />
          <p className="small" role="status">
            {s.ahead > 0
              ? <>Queued: starts after {plural(s.ahead, 'other guild')}. Everstats fetches {plural(s.concurrent, 'guild')} at a time.</>
              : <>Starting in a moment…</>}
          </p>
          {s.paused && <div className="note warn small"><Icon name="pause" /><span>The background crawl is paused by Everstats right now. This fetch waits and starts when it resumes.</span></div>}
          <p className="muted xsmall">You can leave this page: the fetch carries on, and this panel shows where it is when you come back.</p>
        </>
      )}

      {s.state === 'running' && (
        <>
          <CountLine counts={s.counts} />
          <div className="stack gap-6">
            <p className="small" role="status">
              Fetching {formatNumber(s.progress.done)} of {plural(s.progress.total, 'member')}…
              {s.progress.remaining > 0 && <span className="muted"> {aboutDuration(s.progress.seconds)} left</span>}
            </p>
            <div className="bar" role="progressbar" aria-label="Members fetched" aria-valuemin={0} aria-valuemax={s.progress.total} aria-valuenow={s.progress.done}>
              <span className="bar-fill" style={{ width: `${s.progress.total ? Math.min(100, (s.progress.done / s.progress.total) * 100) : 0}%` }} />
            </div>
          </div>
          {s.paused && <div className="note warn small"><Icon name="pause" /><span>The background crawl is paused by Everstats right now. This fetch waits and carries on when it resumes.</span></div>}
          <p className="muted xsmall">You can leave this page: the fetch carries on. Someone looking a character up always goes first.</p>
        </>
      )}

      {(s.state === 'done' || s.state === 'cooldown') && (
        <>
          {s.state === 'done' ? (
            <div className="note ok small" role="status">
              <Icon name="check" />
              <span className="stack gap-2">
                <b>{plural(s.result.added, 'member')} added</b>
                <span>
                  {[s.result.notFound > 0 ? `${formatNumber(s.result.notFound)} Blizzard didn’t return (recorded; tried again on the daily refresh)` : null,
                    s.result.failed > 0 ? `${formatNumber(s.result.failed)} couldn’t be fetched just now` : null].filter(Boolean).join(' · ')}
                  {(s.result.notFound > 0 || s.result.failed > 0) ? '. ' : ''}
                  Guild totals, tiers and badges update within a few minutes.
                </span>
              </span>
            </div>
          ) : (
            <p className="t2 small">Last fetched {timeAgo(s.finishedAt)}: {plural(s.result.added, 'member')} added.</p>
          )}
          <div className="row gap-8">
            <button type="button" className="btn" disabled><Icon name="clock" size="sm" />Fetch all members</button>
            <span className="muted xsmall">Available again {formatDateTime(s.availableAt)}. Members are still refreshed every day.</span>
          </div>
        </>
      )}

      {error && <div className="note err small" role="alert"><Icon name="error" /><span>{error}</span></div>}
    </section>
  );
}
