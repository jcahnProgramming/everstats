import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import { Icon } from '../chrome/Icon.jsx';
import { Sortable } from '../components/Sortable.jsx';
import { Segmented, Toggle } from '../components/Controls.jsx';
import { EmptyState } from '../components/EmptyState.jsx';
import { ServiceUnavailable } from '../components/States.jsx';
import { useToasts } from '../components/Toasts.jsx';
import { formatDateTime, formatNumber } from '../format.js';
import { useEditing } from '../chrome/updates.js';

/**
 * The card maker (0.8.0, design/v3-share-cards: components/card-maker.md, pages/maker-*, states/*). One page for all four
 * entry points, at the designed routes:
 *   /c/{slug}/share                                   character card (character sheet → Share)
 *   /c/{slug}/tier/share                              tier card (tier panel → Share tier)
 *   /g/{slug}/share                                   guild card (guild header → Share guild card)
 *   /leaderboards/{ruleset}/{statistic}/share?c=…     leaderboard card (a board row's share icon)
 *   /leaderboards/guilds/{ruleset}/{statistic}/share?g=…&mode=
 *
 * The preview is the REAL image the server renders (/card.png): cards are never drawn in the browser (Blizzard's images
 * would block that). While a new image is generated the old one stays, dimmed, under a "Generating your card…" pill.
 * Choices live in this page only; "Save as my default" (the owner, or the guild's Guild Master and officers) is the only
 * way any choice is stored, and it becomes the card everyone sees first and the link preview.
 *
 * Statistics reorder with the shared drag-and-drop list (components/Sortable.jsx, 0.8.1; the preview re-renders on drop,
 * with Undo); the maker is a page, not also a modal (owner's decision, 0.8.0).
 */
const SHOW_LABELS = {
  render: 'Render', tier: 'Overall tier', badge: 'Pinned badge', guild: 'Guild', gear: 'Gear strip',
  recruiting: 'Recruiting ribbon', tierbar: 'Tier bar', cats: 'Category letters', next: 'Distance to next letter',
  transmog: 'Transmog completion', showcase: 'Mount and pet showcase',
};
const TYPE_LABELS = { character: 'Character card', guild: 'Guild card', board: 'Leaderboard card', tier: 'Tier card', collections: 'Collections card' };
const ACCENT_LABELS = { accent: 'Theme accent', c2: 'Accent 2', c3: 'Accent 3', c4: 'Accent 4', c5: 'Accent 5' };

/** base64url of the options' JSON (UTF-8 safe): the server decodes and re-checks every value. */
export function encodeOptions(o) {
  const bytes = new TextEncoder().encode(JSON.stringify(o));
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function useSubject(type) {
  const { slug, ruleset, statistic } = useParams();
  const [params] = useSearchParams();
  const location = useLocation();
  return useMemo(() => {
    if (type === 'character' || type === 'tier' || type === 'collections') return { c: slug };
    if (type === 'guild') return { g: slug };
    const guilds = location.pathname.startsWith('/leaderboards/guilds/');
    return {
      ruleset, statistic,
      period: ['week', 'rolling'].includes(params.get('period')) ? params.get('period') : 'overall',
      ...(guilds ? { g: params.get('g') ?? '', mode: params.get('mode') === 'average' ? 'average' : 'total' } : { c: params.get('c') ?? '' }),
    };
  }, [type, slug, ruleset, statistic, params, location.pathname]);
}

const queryOf = (type, s) => new URLSearchParams(Object.entries({ type, ...s }).filter(([, v]) => v !== undefined && v !== null && v !== '')).toString();

export function CardMakerPage({ type }) {
  const subject = useSubject(type);
  const [state, setState] = useState(null);
  const [error, setError] = useState(null);
  const [period, setPeriod] = useState(subject.period ?? 'overall');
  const load = useCallback(async () => {
    setError(null);
    try {
      setState(await api(`/api/cards/maker?${queryOf(type, { ...subject, period: type === 'board' ? period : undefined })}`));
    } catch (err) {
      setError(err);
    }
  }, [type, subject, period]);
  useEffect(() => {
    load();
  }, [load]);

  const back = type === 'guild' ? `/g/${encodeURIComponent(subject.g)}`
    : type === 'board' ? `/leaderboards/${subject.g ? 'guilds/' : ''}${subject.ruleset}/${subject.statistic}`
      : `/c/${encodeURIComponent(subject.c)}`;
  if (error) {
    return (
      <div className="wrap page-pad stack gap-20">
        <h1 className="h1">Share card</h1>
        {error.status === 404
          ? <EmptyState kind="nodata" title="Nothing to share here yet"><span>{error.message}</span><Link to={back}>Back</Link></EmptyState>
          : <ServiceUnavailable inline title="Couldn’t open the card maker" onRetry={load}>{error.message}</ServiceUnavailable>}
      </div>
    );
  }
  if (!state) return <div className="wrap page-pad"><span className="t2 small" role="status">Loading…</span></div>;
  if (state.status === 'hidden') return <HiddenCharacter back={back} />;
  return <Maker key={state.query} type={type} state={state} back={back} period={period} onPeriod={setPeriod} onSaved={load} />;
}

/** states/hidden-character: "This character can’t be shared", the reason, and two ways back. */
function HiddenCharacter() {
  return (
    <div className="wrap page-pad stack gap-20">
      <h1 className="h1">Share card</h1>
      <section className="panel blocked" aria-labelledby="blocked-h">
        <Icon name="lock" size="xl" />
        <h2 className="h2" id="blocked-h">This character can’t be shared</h2>
        <p className="t2 small">Its owner hid it on Everstats, so it has no page, no card and no link preview, and it is on no leaderboard.</p>
        <div className="row gap-10"><Link className="btn" to="/">Home</Link><Link className="btn ghost" to="/leaderboards">Leaderboards</Link></div>
      </section>
    </div>
  );
}

function Maker({ type, state, back, period, onPeriod, onSaved }) {
  const toast = useToasts();
  const [opts, setOpts] = useState(() => {
    const o = structuredClone(state.initial);
    if (type === 'character' && !o.stats) o.stats = state.choices.defaultStats ?? [];
    return o;
  });
  const set = (patch) => setOpts((o) => ({ ...o, ...patch }));
  const setShow = (k, v) => setOpts((o) => ({ ...o, show: { ...o.show, [k]: v } }));
  // 0.8.2: choices that differ from what the maker opened with hold back the "Everstats was updated" reload.
  const [opened] = useState(() => JSON.stringify(opts));
  useEditing(JSON.stringify(opts) !== opened);
  const fmt = state.formats.find((f) => f.id === opts.format);
  const url = `/card.png?${state.query}&o=${encodeOptions(opts)}`;

  // The preview: the old image stays (dimmed) while the next one is generated; a failure keeps the choices.
  const [shown, setShown] = useState(null);
  const [busy, setBusy] = useState(true);
  const [failed, setFailed] = useState(null);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let live = true;
    setBusy(true);
    setFailed(null);
    const t = setTimeout(() => {
      const img = new Image();
      img.onload = () => {
        if (!live) return;
        setShown({ src: url, format: opts.format });
        setBusy(false);
      };
      img.onerror = async () => {
        if (!live) return;
        let message = 'Couldn’t generate the image.';
        try {
          const r = await fetch(url, { credentials: 'same-origin' });
          const body = await r.json();
          if (body?.error) message = body.error;
        } catch {
          /* keep the plain message */
        }
        if (live) {
          setFailed(message);
          setBusy(false);
        }
      };
      img.src = url;
    }, 350);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [url, retry]); // eslint-disable-line react-hooks/exhaustive-deps

  const [saving, setSaving] = useState(false);
  const fileName = `everstats-${type}-${opts.format}.png`;
  const download = () => {
    const a = document.createElement('a');
    a.href = `${url}&download=1`;
    a.download = fileName;
    document.body.append(a);
    a.click();
    a.remove();
    toast.info('Download started', fileName);
  };
  const copyImage = async () => {
    try {
      if (!window.ClipboardItem || !navigator.clipboard?.write) throw new Error('blocked');
      const blob = fetch(url, { credentials: 'same-origin' }).then((r) => {
        if (!r.ok) throw new Error('failed');
        return r.blob();
      });
      await navigator.clipboard.write([new window.ClipboardItem({ 'image/png': blob })]);
      toast.ok('Image copied');
    } catch {
      toast.warn('Your browser blocked copying images', 'Use Download PNG instead.');
    }
  };
  const link = type === 'board' || type === 'tier' ? `${window.location.origin}${window.location.pathname}${type === 'board' ? `?${new URLSearchParams(Object.entries({ c: state.subject.c, g: state.subject.g, mode: state.subject.g && state.subject.mode === 'average' ? 'average' : null, period: period === 'overall' ? null : period }).filter(([, v]) => v))}` : ''}` : `${window.location.origin}${state.page ?? back}`;
  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(link);
      toast.ok('Link copied');
    } catch {
      toast.warn('Couldn’t copy the link', link);
    }
  };
  const save = async () => {
    setSaving(true);
    try {
      await api('/api/cards/default', { method: 'PUT', body: { type, subject: state.subject, options: opts } });
      toast.ok('Saved as default', 'Everyone sees this card first, and it’s the link preview.');
      onSaved();
    } catch (err) {
      toast.err('Couldn’t save the default', err.message);
    }
    setSaving(false);
  };

  const available = state.status === 'ok';
  const statsShown = state.statsShown[`${opts.format}-${opts.layout}`];
  const disabledToggle = (k) => (k === 'render' && type === 'character' && !state.choices.render?.available)
    || (k === 'badge' && !state.choices.badge) || (k === 'guild' && type === 'character' && !state.choices.guild)
    || (k === 'recruiting' && !state.choices.discord);
  return (
    <div className="wrap page-pad stack gap-20">
      <nav aria-label="Breadcrumb" className="muted small row gap-8"><Link to={back}>{state.title ?? 'Back'}</Link><span>/</span><span className="t2" aria-current="page">Share card</span></nav>
      <div className="row gap-12"><h1 className="h1">Share card</h1><span className="t2">{TYPE_LABELS[type]}</span></div>
      {!available && (
        <EmptyState kind="nodata" title="Not enough data for this card yet"><span>{state.reason}</span></EmptyState>
      )}
      {available && (
        <div className="maker">
          <div className="mk-preview">
            <span className="mono xsmall t2">Preview · {fmt.label} · {fmt.width} × {fmt.height}</span>
            <div className={`stage${busy ? ' is-busy' : ''}`} aria-busy={busy}>
              {failed ? (
                <div className="stack gap-10 mk-failed" role="alert">
                  <span className="h3">Couldn’t generate the image</span>
                  <span className="t2 small">{failed} Your choices are kept.</span>
                  <button type="button" className="btn sm self-start" onClick={() => setRetry((n) => n + 1)}><Icon name="refresh" size="sm" />Try again</button>
                </div>
              ) : shown ? (
                <img className={`pv-${shown.format}`} src={shown.src} alt={`Card preview: ${state.title ?? TYPE_LABELS[type]}`} />
              ) : <span className="mk-blank" />}
              {busy && !failed && <div className="busy"><span role="status">Generating your card…</span></div>}
            </div>
            {state.rendersPaused && <span className="small t2 render-paused-note" role="note"><Icon name="info" size="sm" /> {state.rendersPaused}. Cards use the crest for now.</span>}
            {state.linkPreview && (
              <div className="panel linkprev">
                <img src={`${state.linkPreview}${state.linkPreview.includes('?') ? '&' : '?'}v=${encodeURIComponent(state.saved?.savedAt ?? 'default')}`} alt="Link preview card" />
                <span className="stack gap-4">
                  <span className="eyebrow">Link preview</span>
                  <span className="mono xsmall t2 mk-url">{link.replace(/^https?:[/][/]/, '')}</span>
                  <span className="muted xsmall">What Discord, Reddit and X show when this link is pasted ({state.saved ? `the saved wide card, ${formatDateTime(state.saved.savedAt)}` : 'the default wide card: nothing is saved'}).</span>
                </span>
              </div>
            )}
          </div>

          <div className="mk-controls">
            <div className="panel">
              <div className="mk-sec">
                <div className="hd"><span className="eyebrow">Format</span><span className="muted xsmall">{fmt.width}×{fmt.height} · {fmt.hint}</span></div>
                <Segmented label="Format" value={opts.format} onChange={(id) => set({ format: id })} options={state.formats.map((f) => ({ id: f.id, label: f.label }))} />
              </div>
              <div className="mk-sec">
                <span className="eyebrow">Card theme</span>
                <div className="tchips" role="radiogroup" aria-label="Card theme">
                  {state.themes.map((th) => (
                    <button key={th.id} type="button" className="tchip" role="radio" data-theme={th.id} aria-checked={opts.theme === th.id} onClick={() => set({ theme: th.id })}>
                      <span className="sw"><i className="sw-bg" /><i className="sw-accent" /><i className="sw-text" /></span>{th.label}
                    </button>
                  ))}
                </div>
                <span className="muted xsmall">Independent of your site theme.</span>
              </div>
              <div className="mk-sec">
                <span className="eyebrow">Layout</span>
                <Segmented label="Layout" value={opts.layout} onChange={(id) => set({ layout: id })} options={state.layouts} scroll={false} />
              </div>
              {type === 'character' && <StatPicker state={state} opts={opts} set={set} shown={statsShown} />}
              {type === 'character' && state.choices.transmog && (
                <div className="mk-sec">
                  <span className="eyebrow">Gear strip</span>
                  <Segmented label="Gear strip" value={opts.gear} onChange={(id) => set({ gear: id })} options={[{ id: 'worn', label: 'Worn gear' }, { id: 'transmog', label: 'Transmog' }]} scroll={false} />
                  <span className="muted xsmall">Blizzard’s render shows worn gear.</span>
                </div>
              )}
              {type === 'guild' && <GuildPickers state={state} opts={opts} set={set} />}
              {type === 'board' && (
                <div className="mk-sec">
                  <span className="eyebrow">Period</span>
                  <Segmented label="Period" value={period} onChange={onPeriod} options={state.choices.periods.map((p) => ({ id: p.id, label: p.label, disabled: !p.open }))} scroll={false} />
                  {state.choices.periods.some((p) => !p.open) && <span className="muted xsmall">A period board opens once enough daily snapshots exist.</span>}
                </div>
              )}
              {state.toggles.length > 0 && (
                <div className="mk-sec">
                  <span className="eyebrow">Show</span>
                  <div className="tgrid">
                    {state.toggles.map((k) => (
                      <Toggle key={k} checked={Boolean(opts.show[k]) && !disabledToggle(k)} disabled={disabledToggle(k)} onChange={(v) => setShow(k, v)}><span className="small">{SHOW_LABELS[k] ?? k}</span></Toggle>
                    ))}
                  </div>
                  {type === 'character' && !state.choices.render?.available && <div className="note warn small"><Icon name="warning" /><span>{state.choices.render.reason}</span></div>}
                  {type === 'guild' && !state.choices.discord && <span className="muted xsmall">The Recruiting ribbon shows the guild’s Discord invite, and its Guild Master or officers haven’t set one.</span>}
                </div>
              )}
              <div className="mk-sec">
                <span className="eyebrow">Accent</span>
                <div className="swatches" role="radiogroup" aria-label="Accent" data-theme={opts.theme}>
                  {state.accents.map((a) => (
                    <button key={a} type="button" className="swatch" role="radio" aria-checked={opts.accent === a} aria-label={ACCENT_LABELS[a]} title={ACCENT_LABELS[a]} onClick={() => set({ accent: a })}><i className={`acc-${a}`} /></button>
                  ))}
                </div>
                <span className="muted xsmall">From the card theme’s own palette.</span>
              </div>
            </div>

            <div className="panel mk-actions">
              <button type="button" className="btn gold lg" onClick={download} disabled={busy || Boolean(failed)}><Icon name="download" />Download PNG</button>
              <div className="row">
                <button type="button" className="btn" onClick={copyImage} disabled={busy || Boolean(failed)}><Icon name="copy" size="sm" />Copy image</button>
                <button type="button" className="btn" onClick={copyLink}><Icon name="external" size="sm" />Copy link</button>
              </div>
              <span className="muted xsmall">The link opens the page; its preview is the {state.canSave || state.saved ? 'saved' : 'default'} wide card.</span>
              {state.canSave ? (
                <div className="owner">
                  <span className="stack gap-4 flex-fill"><b className="small">Save as my default</b><span className="muted xsmall">Becomes the default card for everyone and {type === 'guild' ? 'the guild’s' : 'your'} link preview on Discord, Reddit and X.</span></span>
                  <button type="button" className="btn sm" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save default'}</button>
                </div>
              ) : (
                <span className="note small"><Icon name="info" /><span>Your choices aren’t saved. {type === 'board' ? 'A leaderboard card has no saved default.' : type === 'guild' ? 'Only the Guild Master and officers can save this guild’s default card.' : 'Only the character’s owner can save its default card.'}</span></span>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** Statistics 1–6 (the owner's pins by default). A statistic with no real value is disabled: "Not enough data yet". */
function StatPicker({ state, opts, set, shown }) {
  const [q, setQ] = useState('');
  const byId = useMemo(() => new Map(state.choices.stats.map((s) => [s.id, s])), [state.choices.stats]);
  const chosen = (opts.stats ?? []).filter((id) => byId.has(id));
  const toggle = (id) => set({ stats: chosen.includes(id) ? chosen.filter((x) => x !== id) : [...chosen, id].slice(0, state.maxStats) });
  const needle = q.trim().toLowerCase();
  const more = state.choices.stats.filter((s) => !chosen.includes(s.id) && (!needle || s.name.toLowerCase().includes(needle))).slice(0, needle ? 40 : 8);
  const row = (s, i, grip = null) => (
    <div key={s.id} className={`sp${s.available ? '' : ' is-disabled'}`}>
      {grip ?? <span />}
      <input type="checkbox" aria-label={s.name} checked={chosen.includes(s.id)} disabled={!s.available || (!chosen.includes(s.id) && chosen.length >= state.maxStats)} onChange={() => toggle(s.id)} />
      <span className={`ellipsis${i !== null && i >= shown ? ' muted' : ''}`}>{s.name}</span>
      <span className="val">{s.available ? `${formatNumber(s.value)}${s.rank ? ` · #${formatNumber(s.rank)}` : ''}` : 'Not enough data yet'}</span>
    </div>
  );
  return (
    <div className="mk-sec">
      <div className="hd"><span className="eyebrow">Statistics</span><span className="muted xsmall">{chosen.length} of {state.maxStats} · defaults to the owner’s pins</span></div>
      {chosen.length ? (
        <Sortable items={chosen.map((id) => byId.get(id))} labelOf={(x) => x.name} className="statpick" itemClassName="sp-item" ariaLabel="Statistics on the card, in order"
          doneText="Moved: the preview is updating" undoText="Order restored" onReorder={(ids) => set({ stats: ids })}
          renderItem={(x, { grip, index }) => row(x, index, grip)} />
      ) : <div className="statpick"><span className="muted xsmall mk-empty">Pick at least one.</span></div>}
      <span className="muted xsmall">This format and layout show the first {shown}.</span>
      <label className="field"><span className="xsmall t2">Add a statistic</span><input className="inp" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search this character’s statistics" /></label>
      {more.length > 0 && <div className="statpick">{more.map((s) => row(s, null))}</div>}
      {state.choices.stats.some((s) => !s.available) && <span className="muted xsmall">Only real values can go on a card: a statistic at 0 shows “Not enough data yet”.</span>}
    </div>
  );
}

function GuildPickers({ state, opts, set }) {
  const badges = state.choices.badges;
  const chosenBadges = opts.badges ?? badges.slice(0, 4).map((b) => b.id);
  const totals = state.choices.totals;
  const [q, setQ] = useState('');
  const chosenTotals = opts.totals ?? null;
  const needle = q.trim().toLowerCase();
  const listed = totals.filter((t) => !needle || t.name.toLowerCase().includes(needle)).slice(0, needle ? 40 : 10);
  const flip = (list, id, max) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id].slice(0, max));
  return (
    <>
      <div className="mk-sec">
        <div className="hd"><span className="eyebrow">Guild badges</span><span className="muted xsmall">{chosenBadges.length} of 4 · the first is pinned</span></div>
        {badges.length === 0 ? <span className="muted xsmall">This guild has no badges to show yet.</span> : (
          <div className="statpick">
            {badges.map((b) => (
              <label key={b.id} className="sp">
                <span />
                <input type="checkbox" checked={chosenBadges.includes(b.id)} disabled={!chosenBadges.includes(b.id) && chosenBadges.length >= 4} onChange={() => set({ badges: flip(chosenBadges, b.id, 4) })} />
                <span className="ellipsis">{b.name}{b.numeral ? ` ${b.numeral}` : ''}</span>
                <span className="val">{chosenBadges.indexOf(b.id) === 0 ? 'Pinned' : ''}</span>
              </label>
            ))}
          </div>
        )}
      </div>
      <div className="mk-sec">
        <div className="hd"><span className="eyebrow">Totals</span><span className="muted xsmall">{chosenTotals ? `${chosenTotals.length} of 4` : 'The guild page’s own'}</span></div>
        <label className="field"><span className="xsmall t2">Find a statistic</span><input className="inp" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search the guild’s totals" /></label>
        {listed.length === 0 ? <span className="muted xsmall">No totals yet: they’re added up a few minutes after members are fetched.</span> : (
          <div className="statpick">
            {listed.map((t) => (
              <label key={t.id} className="sp">
                <span />
                <input type="checkbox" checked={Boolean(chosenTotals?.includes(t.id))} disabled={Boolean(chosenTotals) && !chosenTotals.includes(t.id) && chosenTotals.length >= 4} onChange={() => set({ totals: flip(chosenTotals ?? [], t.id, 4) })} />
                <span className="ellipsis">{t.name}</span>
                <span className="val">{formatNumber(t.total)}</span>
              </label>
            ))}
          </div>
        )}
        {chosenTotals && <button type="button" className="linklike xsmall self-start" onClick={() => set({ totals: null })}>Use the guild page’s totals</button>}
      </div>
    </>
  );
}
