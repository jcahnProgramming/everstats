import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { Icon } from '../chrome/Icon.jsx';
import { Segmented, Toggle } from '../components/Controls.jsx';
import { Provenance } from '../components/EmptyState.jsx';
import { useToasts } from '../components/Toasts.jsx';
import { formatDate, formatNumber, timeAgo } from '../format.js';
import { useSession } from '../session.jsx';
import {
  AccountMarker, CollectionEmpty, CompletionBar, CountCard, Glyph, Legend, NotReturned, SectionFresh, SectionState, StandingBar, STANDINGS, Tile, WowheadLink,
  formatMoney, pct,
} from './parts.jsx';
import { TransmogTracker } from './Transmog.jsx';
import { ShareButton } from '../share/ShareButtons.jsx';
import { fillStyle } from '../components/fillGrid.js';
import { SwitchedOff } from '../components/SwitchedOff.jsx';
import { OFF_WORDS } from '../features.js';

/**
 * The Collections tab (0.9.0, design/v4-collections pages/collections-tab and the screens beside it), at
 * /c/{slug}/collections and /c/{slug}/collections/{screen}. Everything comes from GET /api/characters/:slug/collections
 * (counts, section summaries, Legacy Points, gold) and, per screen, /collections/:kind. Opening the tab on data older
 * than a day queues a refresh at lookup priority; the page polls while it runs and shows the design's partial state.
 */
const SCREENS = [
  { id: '', label: 'Overview' },
  { id: 'transmog', label: 'Transmog', kinds: ['transmog'] },
  { id: 'mounts', label: 'Mounts', kinds: ['mounts'] },
  { id: 'pets', label: 'Pets', kinds: ['pets', 'hunter-pets'] },
  { id: 'toys', label: 'Toys', kinds: ['toys'] },
  { id: 'heirlooms', label: 'Heirlooms', kinds: ['heirlooms'] },
  { id: 'titles', label: 'Titles', kinds: ['titles'] },
  { id: 'achievements', label: 'Achievements', kinds: ['achievements'] },
  { id: 'reputations', label: 'Reputations', kinds: ['reputations'] },
  { id: 'professions', label: 'Professions', kinds: ['professions'] },
  { id: 'dungeons-raids', label: 'Dungeons & raids', kinds: ['dungeons', 'raids'] },
  { id: 'quests', label: 'Quests', kinds: ['quests', 'quests-completed'] },
  { id: 'pvp', label: 'PvP', kinds: ['pvp'] },
  { id: 'legacy', label: 'Legacy', kinds: ['achievements'] },
];
// Which screen a section header opens, and the glyph each kind wears.
const SCREEN_OF = { transmog: 'transmog', mounts: 'mounts', pets: 'pets', 'hunter-pets': 'pets', toys: 'toys', heirlooms: 'heirlooms', titles: 'titles', achievements: 'achievements', reputations: 'reputations', professions: 'professions', dungeons: 'dungeons-raids', raids: 'dungeons-raids', quests: 'quests', 'quests-completed': 'quests', pvp: 'pvp' };
const GLYPH_OF = { appearances: 'transmog', exalted: 'reputations', revered: 'reputations', 'pets-rare': 'pets', 'boss-kills': 'dungeons', quests: 'quests', legacy: 'legacy', 'quests-completed': 'quests', raids: 'dungeons' };
const glyphFor = (k) => GLYPH_OF[k] ?? k;
const POLL_MS = 3000;
const POLL_MAX = 40;

export function CollectionsView({ character: c, screen = '' }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const polls = useRef(0);
  const base = `/c/${encodeURIComponent(c.slug)}/collections`;

  const load = useCallback(async () => {
    try {
      const d = await api(`/api/characters/${encodeURIComponent(c.slug)}/collections`);
      setData(d);
      setError(null);
    } catch (err) {
      setError(err);
    }
  }, [c.slug]);

  useEffect(() => {
    polls.current = 0;
    load();
  }, [load]);

  // While a refresh runs, ask again every few seconds (bounded), so the page fills in as Blizzard answers.
  useEffect(() => {
    if (!data?.refreshing || polls.current >= POLL_MAX) return undefined;
    const t = setTimeout(() => {
      polls.current += 1;
      load();
    }, POLL_MS);
    return () => {
      clearTimeout(t);
    };
  }, [data, load]);

  if (error) return <div className="note warn" role="alert"><Icon name="warning" /><span>Couldn’t load collections: {error.message}</span></div>;
  if (!data) return <CollectionsLoading />;
  // 0.10.3: Collections switched off by Everstats (features/registry.js): said plainly, nothing is fetched.
  if (data.status === 'off') return <SwitchedOff>{data.message ?? OFF_WORDS.collections} Statistics, gear and leaderboards are unaffected.</SwitchedOff>;
  if (data.status !== 'ok') return <div className="note" role="status"><Icon name="info" /><span>Collections aren’t available for this character.</span></div>;

  const present = new Set(data.sections.map((s) => s.id));
  const screens = SCREENS.filter((s) => !s.kinds || s.id === 'legacy' ? (s.id !== 'legacy' || data.legacy) : s.kinds.some((k) => present.has(k)));
  const current = screens.find((s) => s.id === screen) ?? screens[0];
  return (
    <div className="stack gap-24">
      <nav className="ctabs coll-nav" aria-label="Collections">
        <div className="seg phone-scroll" role="list">
          {screens.map((s) => (
            <Link key={s.id || 'overview'} role="listitem" to={s.id ? `${base}/${s.id}` : base} aria-current={s.id === current.id ? 'page' : undefined} className={`seg-link${s.id === current.id ? ' is-current' : ''}`}>{s.label}</Link>
          ))}
        </div>
      </nav>
      <RefreshLine data={data} slug={c.slug} onQueued={load} />
      {current.id === '' ? <Overview data={data} base={base} character={c} onReload={load} />
        : <Screen id={current.id} label={current.label} data={data} character={c} refreshing={data.refreshing} onRetry={load} />}
      <Provenance source="Blizzard Entertainment’s game data API: character collections, achievements, reputations, professions, encounters, quests, PvP summary, and the static catalogs (every mount, pet, toy, title, achievement and appearance)" fetchedAt={data.fetchedAt}>
        <span className="muted">Collections refresh weekly, at sign-in, and when someone opens this tab on data older than a day.</span>
      </Provenance>
    </div>
  );
}

function CollectionsLoading() {
  return (
    <div className="stack gap-16" aria-busy="true">
      <span className="t2 small" role="status">Loading collections from Blizzard…</span>
      <div className="ccounts">{Array.from({ length: 6 }, (_, i) => <div key={i} className="ccount is-off"><span className="n">—</span><span className="l skel">&nbsp;</span></div>)}</div>
      <div className="cgrid">{Array.from({ length: 12 }, (_, i) => <span key={i} className="ctile skel-tile static"><span className="ic" /><span className="nm" /></span>)}</div>
    </div>
  );
}

function RefreshLine({ data, slug, onQueued }) {
  const toast = useToasts();
  const [busy, setBusy] = useState(false);
  const now = async () => {
    setBusy(true);
    try {
      const r = await api(`/api/characters/${encodeURIComponent(slug)}/collections/refresh`, { method: 'POST' });
      if (r.refresh === 'not_configured') toast.err('Look-ups are switched off', 'Everstats can’t ask Blizzard right now.');
      onQueued();
    } catch (err) {
      toast.err('Couldn’t refresh', err.message);
    } finally {
      setBusy(false);
    }
  };
  if (!data.fetchedAt) {
    return (
      <div className="note" role="status">
        <Icon name="clock" />
        <span className="flex-fill">{data.refreshing ? 'Loading collections from Blizzard… this page fills in as the answers arrive.' : 'Collections load on the next refresh.'}</span>
        {!data.refreshing && <button type="button" className="btn sm" onClick={now} disabled={busy}><Icon name="refresh" size="sm" />Refresh now</button>}
      </div>
    );
  }
  return (
    <div className="row gap-12 small t2 wrap-row">
      <span>Collections from {formatDate(data.fetchedAt)} ({timeAgo(data.fetchedAt)}){data.refreshing ? ' · refreshing now' : ''}</span>
      {data.refresh === 'rate_limited' && <span className="muted">Not refreshed: too many look-ups from your network.</span>}
      {!data.refreshing && <button type="button" className="btn ghost sm" onClick={now} disabled={busy}><Icon name="refresh" size="sm" />Refresh</button>}
    </div>
  );
}

function usePins() {
  const session = useSession();
  const toast = useToasts();
  const [pins, setPins] = useState(null);
  useEffect(() => {
    if (!session.signedIn) return undefined;
    let live = true;
    api('/api/account/pins').then((r) => { if (live) setPins(r.pinIds); }, () => {});
    return () => {
      live = false;
    };
  }, [session.signedIn]);
  const toggle = async (id, name) => {
    const next = pins.includes(id) ? pins.filter((x) => x !== id) : [...pins, id];
    try {
      setPins((await api('/api/account/pins', { method: 'PUT', body: { statisticIds: next } })).pinIds);
      toast.ok(next.includes(id) ? 'Pinned to your dashboard' : 'Unpinned', name);
    } catch (err) {
      toast.err("Couldn't change your pins", err.message);
    }
  };
  return { pins, toggle };
}

function Overview({ data, base, character: c, onReload }) {
  const { pins, toggle } = usePins();
  const [open, setOpen] = useState(() => new Set());
  // 0.9.2: opening or closing a section keeps the clicked header exactly where it was on screen (the page used to jump
  // as the section above it changed height): measured before the change, put back right after it renders.
  const anchor = useRef(null);
  useLayoutEffect(() => {
    const a = anchor.current;
    if (!a) return;
    anchor.current = null;
    const el = document.getElementById(a.id);
    if (el) window.scrollBy(0, el.getBoundingClientRect().top - a.top);
  }, [open]);
  const flip = (id, e) => {
    const head = e?.currentTarget?.closest('[id]');
    if (head) anchor.current = { id: head.id, top: head.getBoundingClientRect().top };
    setOpen((o) => {
      const n = new Set(o);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  };
  const sections = data.sections.filter((s) => s.id !== 'quests'); // quests in progress live inside the Quests section
  // "Collapse all" only when every section is open; otherwise "Expand all".
  const allIds = [...sections.map((s) => s.id), ...(data.legacy ? ['legacy'] : [])];
  const allOpen = allIds.length > 0 && allIds.every((id) => open.has(id));
  return (
    <>
      <section className="stack gap-14" aria-labelledby="coll-h">
        <div className="row gap-16 wrap-row">
          <h2 className="h2" id="coll-h">Collections</h2>
          <span className="spacer" />
          <span className="muted small">Counts are statistics: pin one to your dashboard, or open its leaderboard.</span>
          {!c.hidden && <ShareButton to={`/c/${encodeURIComponent(c.slug)}/collections/share`} label="Share collections" />}
        </div>
        {/* 0.9.2: rows that always fill (components/fillGrid.js), never an empty slot at the end. */}
        <div className="ccounts fillgrid">
          {data.counts.map((k) => (
            <CountCard key={k.key} count={k} glyph={glyphFor(k.key)} pinned={pins ? pins.includes(k.id) : null} onPin={pins ? () => toggle(k.id, k.name) : null}
              boardTo={c.ruleset && k.board ? `/leaderboards/${c.ruleset.id}/${k.id}` : null} style={fillStyle(data.counts.length, { lg: 6, md: 4, sm: 2 })} />
          ))}
        </div>
        {data.counts.some((k) => k.shared) && (
          <p className="muted xsmall acct-legend">
            <AccountMarker shared={{ how: 'detected' }} />
            <span>appears only where it is known: Blizzard says so, or every character Everstats has fetched on the owner’s account has the identical collection.</span>
          </p>
        )}
      </section>
      <FamilyBoards boards={data.familyBoards ?? []} ruleset={c.ruleset?.id ?? null} />
      <GoldPanel gold={data.gold} character={c} onChange={onReload} />
      <section className="stack gap-10" aria-labelledby="bycoll-h">
        <div className="row gap-12 wrap-row">
          <h2 className="h2" id="bycoll-h">By collection</h2>
          <span className="muted xsmall">Collapsed by default</span>
          <span className="spacer" />
          <button type="button" className="linklike small" onClick={() => setOpen(allOpen ? new Set() : new Set(allIds))}>{allOpen ? 'Collapse all' : 'Expand all'}</button>
        </div>
        {sections.map((s) => <SectionRow key={s.id} s={s} open={open.has(s.id)} onToggle={(e) => flip(s.id, e)} base={base} slug={c.slug} refreshing={data.refreshing} />)}
        {data.legacy && <LegacyRow legacy={data.legacy} open={open.has('legacy')} onToggle={(e) => flip('legacy', e)} base={base} />}
      </section>
    </>
  );
}

/**
 * 0.9.1: every other collection board this character is on: one per achievement category, transmog slot, instance and
 * PvP field Blizzard returned for it (only values above zero), grouped, each linked to its board. Collapsed by default.
 */
const FAMILY_LABELS = { achcat: 'Achievements by category', slot: 'Appearances by slot', instance: 'Boss kills by instance', pvp: 'PvP summary' };
function FamilyBoards({ boards, ruleset }) {
  const [open, setOpen] = useState(false);
  if (!boards.length || !ruleset) return null;
  const groups = Object.keys(FAMILY_LABELS).map((f) => [f, boards.filter((b) => b.family === f)]).filter(([, l]) => l.length);
  return (
    <section className={`csec${open ? ' is-open' : ''}`} aria-labelledby="famb-h">
      <button type="button" className="hd" aria-expanded={open} aria-controls="famb-body" onClick={() => setOpen(!open)}>
        <Glyph name="category" />
        <span className="tt"><span className="h3" id="famb-h">More collection leaderboards</span><span className="meta"><span>{formatNumber(boards.length)} boards: by achievement category, transmog slot, instance and PvP field</span></span></span>
        <span className="side" />
        <Icon name="chevron-down" size="sm" className="chev" />
      </button>
      {open && (
        <div className="bd" id="famb-body">
          {groups.map(([f, list]) => (
            <div key={f} className="stack gap-6">
              <h3 className="eyebrow">{FAMILY_LABELS[f]}</h3>
              <div className="qlist panel">
                {list.map((b) => (
                  <div key={b.id} className="qrow">
                    <Link className="nm" to={`/leaderboards/${ruleset}/${b.id}`}>{b.name}</Link>
                    <span className="row gap-10"><b className="num">{formatNumber(b.value)}</b>{b.rank ? <span className="rankpill"><b>#{formatNumber(b.rank)}</b> of {formatNumber(b.withAny)}</span> : null}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

/** One collapsed line per section (collection-section.md). */
function summaryText(s) {
  const m = s.summary;
  if (!m) return s.state === 'never' ? 'Loads on the next refresh' : s.state === 'not_returned' ? 'Blizzard didn’t return this' : '';
  const of = (have, total, word) => (total ? `${formatNumber(have)} ${word} of ${formatNumber(total)}` : `${formatNumber(have)} ${word}`);
  switch (s.id) {
    case 'transmog': return of(m.have, m.total, 'appearances');
    case 'mounts': case 'toys': case 'heirlooms': return of(m.have, m.total, 'collected');
    case 'pets': return `${of(m.have, m.total, 'species')}${m.owned !== m.have ? ` · ${formatNumber(m.owned)} pets` : ''}${m.maxLevel ? ` · highest level ${m.maxLevel}` : ''}`;
    case 'hunter-pets': return `${formatNumber(m.have)} tamed · hunters only`;
    case 'titles': return `${of(m.have, m.total, 'earned')}${m.active ? ` · active: “${m.active}”` : ''}`;
    case 'achievements': return `${of(m.have, m.total, 'earned')} · ${formatNumber(m.inProgress)} in progress${m.latest ? ` · latest ${formatDate(m.latest)}` : ''}`;
    case 'reputations': return `Exalted with ${formatNumber(m.exalted)} · ${formatNumber(m.factions)} factions`;
    case 'professions': return `${m.primary} primary · ${m.secondary} secondary${m.maxed ? ` · ${m.maxed} at max skill` : ''}`;
    case 'dungeons': case 'raids': return m.instances ? `${formatNumber(m.bosses)} bosses killed · ${formatNumber(m.instances)} instances` : 'None recorded by Blizzard';
    case 'quests-completed': return `${formatNumber(m.completed)} completed`;
    case 'pvp': return Object.keys(m.fields).length ? [...Object.keys(PVP_LABELS), ...Object.keys(m.fields)].filter((k, i, a) => k in m.fields && a.indexOf(k) === i).slice(0, 2).map((k) => `${PVP_LABELS[k] ?? k.replace(/_/g, ' ')}: ${formatNumber(m.fields[k])}`).join(' · ') : 'Nothing returned';
    default: return '';
  }
}
const PREVIEW_KINDS = new Set(['mounts', 'pets', 'toys', 'heirlooms']);

function SectionRow({ s, open, onToggle, base, slug, refreshing }) {
  const m = s.summary;
  const total = m?.total ?? null;
  const label = s.id === 'quests-completed' ? 'Quests' : s.label;
  return (
    <div className={`csec${open ? ' is-open' : ''}`} id={`coll-${s.id}`}>
      <button type="button" className="hd" aria-expanded={open} aria-controls={`coll-body-${s.id}`} onClick={onToggle}>
        <Glyph name={glyphFor(s.id)} />
        <span className="tt">
          <span className="h3">{label}</span>
          <span className="meta"><span>{summaryText(s)}</span>{s.shared && <AccountMarker shared={{ how: 'detected' }} short />}</span>
        </span>
        <span className="side">{total ? <><span className="bar" aria-hidden="true"><span style={{ width: `${pct(m.have, total)}%` }} /></span><span className="muted xsmall">{pct(m.have, total)}%</span></> : null}</span>
        <Icon name="chevron-down" size="sm" className="chev" />
      </button>
      {open && (
        <div className="bd" id={`coll-body-${s.id}`}>
          {PREVIEW_KINDS.has(s.id) && s.state !== 'never' ? <TilePreview kind={s.id} slug={slug} />
            : s.id === 'transmog' && s.state === 'ok' ? <TransmogPreview slug={slug} />
              : <SectionState section={s} glyph={glyphFor(s.id)} what={label.toLowerCase()} />}
          <div className="row gap-12 wrap-row">
            <Link className="btn sm" to={`${base}/${SCREEN_OF[s.id]}`}>Open {label.toLowerCase()}<Icon name="chevron-right" size="sm" /></Link>
            <SectionFresh section={s} refreshing={refreshing} />
            {['mounts', 'toys', 'heirlooms'].includes(s.id) && <span className="muted xsmall">Blizzard gives no dates for {label.toLowerCase()}, so they can’t be sorted by most recent.</span>}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * 0.9.2: the Transmog section's preview: the slots with the most appearances collected (have / total where Blizzard's
 * catalog gives a total), each linking into the tracker at that slot.
 */
function TransmogPreview({ slug }) {
  const [sec, setSec] = useState(null);
  useEffect(() => {
    let live = true;
    api(`/api/characters/${encodeURIComponent(slug)}/collections/transmog`).then((r) => { if (live) setSec(r.section); }, () => { if (live) setSec(false); });
    return () => {
      live = false;
    };
  }, [slug]);
  if (sec === null) return <span className="muted small" role="status">Loading slots…</span>;
  if (!sec || !sec.slots?.length) return null;
  const top = [...sec.slots].sort((a, b) => b.have - a.have).slice(0, 8);
  return (
    <div className="stack gap-8">
      <span className="eyebrow">Most collected slots</span>
      <div className="row gap-8 wrap-row tm-preview">
        {top.map((sl) => (
          <span key={sl.type} className="tag tm-slot"><Glyph name={`slot:${sl.type}`} className="cg sm-glyph" />{sl.name}<b className="num">{formatNumber(sl.have)}{sl.total ? ` / ${formatNumber(sl.total)}` : ''}</b></span>
        ))}
      </div>
    </div>
  );
}

function TilePreview({ kind, slug }) {
  const [sec, setSec] = useState(null);
  useEffect(() => {
    let live = true;
    api(`/api/characters/${encodeURIComponent(slug)}/collections/${kind}`).then((r) => { if (live) setSec(r.section); }, () => { if (live) setSec(false); });
    return () => {
      live = false;
    };
  }, [kind, slug]);
  if (sec === null) return <div className="cgrid" aria-busy="true">{Array.from({ length: 6 }, (_, i) => <span key={i} className="ctile skel-tile static"><span className="ic" /><span className="nm" /></span>)}</div>;
  if (!sec) return <span className="muted small">Couldn’t load this section.</span>;
  const state = <SectionState section={sec} glyph={kind} what={kind} />;
  if (sec.state !== 'ok') return state;
  return <div className="cgrid" role="list">{sec.collected.slice(0, 12).map((x) => <Tile key={x.id} item={x} glyph={kind} />)}</div>;
}

function LegacyRow({ legacy, open, onToggle, base }) {
  return (
    <div className={`csec${open ? ' is-open' : ''}`} id="coll-legacy">
      <button type="button" className="hd" aria-expanded={open} aria-controls="coll-body-legacy" onClick={onToggle}>
        <Glyph name="legacy" />
        <span className="tt">
          <span className="h3">Legacy Points</span>
          <span className="meta"><span>{formatNumber(legacy.points)} points · from {formatNumber(legacy.achievements)} achievement{legacy.achievements === 1 ? '' : 's'}</span>{legacy.accountWide && <AccountMarker shared={{ how: 'stated' }} short />}</span>
        </span>
        <span className="side" />
        <Icon name="chevron-down" size="sm" className="chev" />
      </button>
      {open && (
        <div className="bd" id="coll-body-legacy">
          <p className="small t2">Forever’s achievements say what they reward. Everstats adds up every “Earn N Legacy Points” reward on the achievements this character has earned.</p>
          <Link className="btn sm self-start" to={`${base}/legacy`}>Open Legacy Points<Icon name="chevron-right" size="sm" /></Link>
        </div>
      )}
    </div>
  );
}

/**
 * Gold (opt-in). The owner always sees their own; anyone else only when the owner chose to share it. Nothing about it
 * is shown to a visitor when it's private (the panel isn't drawn at all).
 */
function GoldPanel({ gold, character: c, onChange }) {
  const toast = useToasts();
  const [busy, setBusy] = useState(false);
  if (!gold) return null;
  const flip = async (on) => {
    setBusy(true);
    try {
      await api(`/api/account/characters/${c.id}/gold-public`, { method: 'PUT', body: { public: on } });
      toast.ok(on ? 'Gold stats are public' : 'Gold stats are private', on ? `${c.name} now appears on the gold leaderboards.` : `${c.name} left the gold leaderboards.`);
      onChange();
    } catch (err) {
      toast.err('Couldn’t change that', err.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="panel stack gap-14 gold-panel" aria-labelledby="gold-h">
      <div className="row gap-12 wrap-row">
        <h2 className="h3" id="gold-h">Gold</h2>
        {gold.mine && <span className={`tag${gold.public ? ' gold' : ''}`}>{gold.public ? 'Public' : 'Only you can see this'}</span>}
      </div>
      {gold.state === 'off' ? (
        <p className="small t2">{OFF_WORDS.gold} Nothing Everstats already has is deleted; it ages out as usual.</p>
      ) : gold.state === 'none' ? (
        <p className="small t2">Gold updates when the owner signs in with Battle.net. Blizzard shares a character’s gold only with its owner, and Everstats keeps it for at most 30 days.</p>
      ) : (
        <>
          <div className="kvgrid">
            <div className="cell"><b>{formatMoney(gold.fields.money)}</b><span>Gold on hand</span></div>
            <div className="cell"><b>{formatMoney(gold.fields.gained)}</b><span>Total gold gained</span></div>
            <div className="cell"><b>{formatMoney(gold.fields.lost)}</b><span>Total gold lost</span></div>
            <div className="cell"><b>{formatMoney(gold.fields.items)}</b><span>Item value gained</span></div>
          </div>
          <span className="muted xsmall">From the last Battle.net sign-in, {formatDate(gold.fetchedAt)}. Gold updates when the owner signs in.</span>
        </>
      )}
      {gold.mine && gold.state !== 'off' && (
        <div className="stack gap-6">
          <Toggle checked={gold.public} disabled={busy} onChange={(v) => flip(v)}>Show my gold stats publicly</Toggle>
          <span className="small t2">Gold is private Blizzard data: only you can share it. On, anyone can see these four numbers on this page and {c.name} appears on the gold leaderboards (they rank only characters whose owners chose to share). Off, it leaves them at once. Your character’s location is never collected.</span>
        </div>
      )}
    </section>
  );
}

// ---- screens

function useSection(slug, kind, query = '') {
  const [state, setState] = useState({ loading: true, section: null, error: null });
  const reload = useCallback(async () => {
    try {
      const r = await api(`/api/characters/${encodeURIComponent(slug)}/collections/${kind}${query}`);
      setState({ loading: false, section: r.section ?? null, error: null });
    } catch (err) {
      setState({ loading: false, section: null, error: err });
    }
  }, [slug, kind, query]);
  useEffect(() => {
    reload();
  }, [reload]);
  return { ...state, reload };
}

function ScreenHead({ glyph, title, sub = null, count = null, ruleset = null, shared = null }) {
  return (
    <div className="row gap-12 wrap-row">
      <Glyph name={glyph} className="cg lg gold" />
      <h2 className="h1">{title}</h2>
      {sub && <span className="t2 small">{sub}</span>}
      <span className="spacer" />
      <AccountMarker shared={shared} tagged />
      {count?.rank && ruleset ? <Link className="rankpill" to={`/leaderboards/${ruleset}/${count.id}`}><b>#{formatNumber(count.rank)}</b> on board</Link> : null}
    </div>
  );
}

function Screen({ id, label, data, character: c, refreshing, onRetry }) {
  const count = (key) => data.counts.find((k) => k.key === key) ?? null;
  const rs = c.ruleset?.id ?? null;
  switch (id) {
    case 'transmog': return <TransmogTracker slug={c.slug} count={count('appearances')} ruleset={rs} refreshing={refreshing} onRetry={onRetry} />;
    case 'mounts': return <GridScreen slug={c.slug} kind="mounts" title="Mounts" count={count('mounts')} ruleset={rs} what="mounts" />;
    case 'toys': return <GridScreen slug={c.slug} kind="toys" title="Toys" count={count('toys')} ruleset={rs} what="toys" />;
    case 'heirlooms': return <GridScreen slug={c.slug} kind="heirlooms" title="Heirlooms" count={count('heirlooms')} ruleset={rs} what="heirlooms" />;
    case 'pets': return <PetsScreen slug={c.slug} count={count('pets')} ruleset={rs} hunter={data.sections.some((s) => s.id === 'hunter-pets')} />;
    case 'titles': return <TitlesScreen slug={c.slug} count={count('titles')} ruleset={rs} />;
    case 'achievements': return <AchievementsScreen slug={c.slug} count={count('achievements')} ruleset={rs} />;
    case 'reputations': return <ReputationsScreen slug={c.slug} count={count('exalted')} ruleset={rs} />;
    case 'professions': return <ProfessionsScreen slug={c.slug} />;
    case 'dungeons-raids': return <EncountersScreen slug={c.slug} />;
    case 'quests': return <QuestsScreen slug={c.slug} count={count('quests')} ruleset={rs} />;
    case 'pvp': return <PvpScreen slug={c.slug} />;
    case 'legacy': return <LegacyScreen slug={c.slug} count={count('legacy')} ruleset={rs} />;
    default: return <span className="muted">{label}</span>;
  }
}

const Loading = () => <div className="cgrid" aria-busy="true">{Array.from({ length: 12 }, (_, i) => <span key={i} className="ctile skel-tile static"><span className="ic" /><span className="nm" /></span>)}</div>;
const Failed = ({ error }) => <div className="note warn" role="alert"><Icon name="warning" /><span>{error.message}</span></div>;
const PAGE = 60;

/** Search + All / Collected / Missing (Missing only with a catalog) + name sort; the shared grid screens. */
function useGridFilter(sec) {
  const [q, setQ] = useState('');
  const [show, setShow] = useState('all');
  const [limit, setLimit] = useState(PAGE);
  const all = useMemo(() => (sec ? [...(sec.collected ?? []), ...(sec.missing ?? [])] : []), [sec]);
  const needle = q.trim().toLowerCase();
  const list = all.filter((x) => (show === 'all' || (show === 'collected') === x.collected) && (!needle || (x.name ?? '').toLowerCase().includes(needle)))
    .sort((a, b) => (b.collected - a.collected) || (a.name ?? '').localeCompare(b.name ?? ''));
  return { q, setQ, show, setShow, limit, setLimit, list };
}

function FilterBar({ f, catalog, label }) {
  return (
    <div className="fbar">
      <label className="search"><Icon name="search" size="sm" /><input className="inp" type="search" placeholder={`Search ${label}`} value={f.q} onChange={(e) => f.setQ(e.target.value)} aria-label={`Search ${label}`} data-edit-guard="off" /></label>
      <Segmented label="Show" value={f.show} onChange={f.setShow} scroll={false}
        options={[{ id: 'all', label: 'All' }, { id: 'collected', label: 'Collected' }, ...(catalog ? [{ id: 'missing', label: 'Missing' }] : [])]} />
    </div>
  );
}

function CollectedOnlyNote({ what }) {
  return <div className="note small"><Icon name="info" /><span>Blizzard’s full list of {what} isn’t available right now, so this shows what’s collected only: no missing {what}, no totals.</span></div>;
}

function GridScreen({ slug, kind, title, count, ruleset, what }) {
  const { loading, section: sec, error, reload } = useSection(slug, kind);
  const f = useGridFilter(sec);
  if (loading) return <Loading />;
  if (error) return <Failed error={error} />;
  const catalog = sec.total !== null && sec.total !== undefined;
  return (
    <section className="stack gap-16" aria-label={title}>
      <ScreenHead glyph={kind} title={title} count={count} ruleset={ruleset} shared={count?.shared} />
      {sec.state !== 'ok' && <SectionState section={sec} glyph={kind} what={what} onRetry={reload} />}
      {sec.collected && (
        <>
          <CompletionBar label={`${title} collected`} have={sec.collected.length} total={sec.total} large />
          {!catalog && <CollectedOnlyNote what={what} />}
          <FilterBar f={f} catalog={catalog} label={what} />
          <Legend />
          {f.list.length ? <div className="cgrid" role="list">{f.list.slice(0, f.limit).map((x) => <Tile key={`${x.collected}-${x.id}`} item={x} glyph={kind} />)}</div> : <span className="muted small">Nothing matches.</span>}
          <ShowMore f={f} />
        </>
      )}
    </section>
  );
}

function ShowMore({ f }) {
  if (f.list.length <= f.limit) return null;
  return (
    <div className="row gap-12">
      <span className="muted small">Showing {formatNumber(Math.min(f.limit, f.list.length))} of {formatNumber(f.list.length)}</span>
      <span className="spacer" />
      <button type="button" className="btn sm" onClick={() => f.setLimit(f.limit + PAGE)}>Show more</button>
    </div>
  );
}

function PetsScreen({ slug, count, ruleset, hunter }) {
  const { loading, section: sec, error, reload } = useSection(slug, 'pets');
  const f = useGridFilter(sec);
  const [sel, setSel] = useState(null);
  if (loading) return <Loading />;
  if (error) return <Failed error={error} />;
  const catalog = sec.total !== null && sec.total !== undefined;
  return (
    <section className="stack gap-16" aria-label="Pets">
      <ScreenHead glyph="pets" title="Pets" sub={sec.owned ? `${formatNumber(sec.owned)} pets owned` : null} count={count} ruleset={ruleset} shared={count?.shared} />
      {sec.state !== 'ok' && <SectionState section={sec} glyph="pets" what="pets" onRetry={reload} />}
      {sec.collected && (
        <div className={`tracker no-picker${sel ? '' : ' no-detail'}`}>
          <div className="center">
            <CompletionBar label="Species collected" have={sec.collected.length} total={sec.total} large />
            {!catalog && <CollectedOnlyNote what="pets" />}
            <FilterBar f={f} catalog={catalog} label="pets" />
            <div className="cgrid" role="list">
              {f.list.slice(0, f.limit).map((x) => <Tile key={`${x.collected}-${x.id}`} item={x} glyph="pets" sub={x.collected ? x.qualityName ?? null : null} onSelect={x.collected ? setSel : null} selected={sel?.id === x.id} />)}
            </div>
            <ShowMore f={f} />
          </div>
          {sel && (
            <aside className="panel cdetail" aria-label={`${sel.name} details`}>
              <span className="grab" aria-hidden="true" />
              <div className="top">
                <Tile item={sel} glyph="pets" size="lg" />
                <div className="stack gap-6"><span className="h3">{sel.name}</span><span className="status got">Collected</span>{sel.type && <span className="tag">{sel.type}</span>}</div>
              </div>
              <div className="kvgrid">
                <div className="cell"><b>{sel.level ?? '—'}</b><span>Level</span></div>
                <div className="cell"><b>{sel.qualityName ?? '—'}</b><span>Quality</span></div>
                <div className="cell"><b>{formatNumber(sel.stats?.health)}</b><span>Health</span></div>
                <div className="cell"><b>{formatNumber(sel.stats?.power)}</b><span>Power</span></div>
                <div className="cell"><b>{formatNumber(sel.stats?.speed)}</b><span>Speed</span></div>
              </div>
              <button type="button" className="btn ghost sm self-start" onClick={() => setSel(null)}>Close</button>
            </aside>
          )}
        </div>
      )}
      {hunter && <HunterPets slug={slug} />}
    </section>
  );
}

function HunterPets({ slug }) {
  const { loading, section: sec } = useSection(slug, 'hunter-pets');
  if (loading || !sec) return null;
  return (
    <section className="panel stack gap-12" aria-labelledby="hp-h">
      <div className="row gap-10"><Glyph name="hunter-pets" /><h3 className="h3" id="hp-h">Hunter pets</h3><span className="muted xsmall">hunters only</span></div>
      {sec.state !== 'ok' ? <SectionState section={sec} glyph="hunter-pets" what="hunter pets" /> : (
        <div className="qlist">{sec.items.map((p) => <div key={`${p.name}-${p.slot}`} className="qrow"><span className="nm">{p.name}{p.creature ? <span className="muted"> · {p.creature}</span> : null}{p.active ? <span className="tag sm">Active</span> : null}</span><span className="id">Level {p.level ?? '—'}</span></div>)}</div>
      )}
    </section>
  );
}

function TitlesScreen({ slug, count, ruleset }) {
  const { loading, section: sec, error } = useSection(slug, 'titles');
  if (loading) return <Loading />;
  if (error) return <Failed error={error} />;
  return (
    <section className="stack gap-16" aria-label="Titles">
      <ScreenHead glyph="titles" title="Titles" count={count} ruleset={ruleset} shared={count?.shared} />
      {sec.state !== 'ok' && <SectionState section={sec} glyph="titles" what="titles" />}
      {sec.collected && sec.collected.length > 0 && (
        <div className="panel tlist">
          {sec.collected.map((t) => (
            <div key={t.id} className={`trow${sec.active?.id === t.id ? ' is-active' : ''}`}>
              <Glyph name="titles" /><span className="tt">{t.name}</span>{sec.active?.id === t.id ? <span className="tag gold">Active</span> : <span />}
            </div>
          ))}
        </div>
      )}
      {sec.missing && sec.missing.length > 0 && (
        <details className="panel">
          <summary className="pad-14">Not earned · {formatNumber(sec.missing.length)} of {formatNumber(sec.total)}</summary>
          <div className="tlist">{sec.missing.map((t) => <div key={t.id} className="trow"><Glyph name="titles" /><span className="tt muted">{t.name}</span><span className="status miss">Not earned</span></div>)}</div>
        </details>
      )}
    </section>
  );
}

function CritBars({ list }) {
  if (!list.length) return null;
  return (
    <div className="crit">
      {list.map((k, i) => (k.target ? (
        <CompletionBar key={i} label={k.description ?? `Step ${i + 1}`} have={Math.min(k.amount ?? 0, k.target)} total={k.target} />
      ) : (
        <span key={i} className={`ck${k.done ? '' : ' no'}`}><Icon name={k.done ? 'check' : 'close'} size="sm" />{k.description ?? `Step ${i + 1}`}</span>
      )))}
    </div>
  );
}

function AchievementsScreen({ slug, count, ruleset }) {
  const { loading, section: sec, error } = useSection(slug, 'achievements');
  const [cat, setCat] = useState(null);
  if (loading) return <Loading />;
  if (error) return <Failed error={error} />;
  const inCat = (a) => cat === null || a.categoryId === cat;
  return (
    <section className="stack gap-16" aria-label="Achievements">
      <ScreenHead glyph="achievements" title="Achievements" sub={sec.totalPoints ? `${formatNumber(sec.totalPoints)} points` : null} count={count} ruleset={ruleset} shared={count?.shared} />
      {sec.state !== 'ok' && <SectionState section={sec} glyph="achievements" what="achievements" />}
      {sec.earned && (
        <div className="tracker no-detail">
          <nav className="panel picker catnav" aria-label="Achievement categories">
            <button type="button" className="spi" aria-current={cat === null ? 'true' : undefined} onClick={() => setCat(null)}><Glyph name="category" /><span className="n">All</span><span className="c">{formatNumber(sec.earned.length)}{sec.catalog ? ` / ${formatNumber(sec.catalog)}` : ''}</span></button>
            {sec.categories.map((k) => (
              <button key={k.id ?? 'none'} type="button" className={`spi${k.have >= k.total ? ' done' : ''}`} aria-current={cat === k.id ? 'true' : undefined} onClick={() => setCat(k.id)}>
                <Glyph name="category" /><span className="n">{k.name ?? 'Other'}</span><span className="c">{k.have} / {k.total}</span>
              </button>
            ))}
          </nav>
          <div className="center">
            <CompletionBar label="Achievements earned" have={sec.earned.length} total={sec.catalog} large />
            {!sec.catalog && <CollectedOnlyNote what="achievements" />}
            <h3 className="h3">In progress</h3>
            <div className="panel achs">
              {sec.inProgress.filter(inCat).map((a) => (
                <div key={a.id} className="ach">
                  <Tile item={{ ...a, collected: false }} glyph="achievements" size="sm" bare />
                  <span className="nm">{a.name}</span><span className="when">In progress</span>
                  {a.description && <span className="ds">{a.description}</span>}
                  <CritBars list={a.criteria} />
                </div>
              ))}
              {!sec.inProgress.filter(inCat).length && <span className="muted small pad-14">Nothing in progress here.</span>}
            </div>
            <h3 className="h3">Recently earned</h3>
            <div className="panel achs">
              {sec.earned.filter(inCat).map((a) => (
                <div key={a.id} className="ach">
                  <Tile item={{ ...a, collected: true }} glyph="achievements" size="sm" bare />
                  <span className="nm">{a.name}{a.accountWide ? <> <AccountMarker shared={{ how: 'stated' }} short /></> : null}</span>
                  <span className="when">{formatDate(a.completedAt)}</span>
                  <span className="ds">{a.description}{a.legacyPoints ? ` · ${a.legacyPoints} Legacy Point${a.legacyPoints === 1 ? '' : 's'}` : ''}</span>
                </div>
              ))}
              {!sec.earned.filter(inCat).length && <span className="muted small pad-14">None earned here yet.</span>}
            </div>
            {sec.notEarned && sec.notEarned.filter(inCat).length > 0 && (
              <details className="panel">
                <summary className="pad-14">Not started · {formatNumber(sec.notEarned.filter(inCat).length)}</summary>
                <div className="achs">{sec.notEarned.filter(inCat).map((a) => <div key={a.id} className="ach"><Tile item={{ ...a, collected: false }} glyph="achievements" size="sm" bare /><span className="nm">{a.name}</span><span className="when">Missing</span><span className="ds">{a.description}</span></div>)}</div>
              </details>
            )}
            <span className="muted xsmall">Dates are Blizzard’s. Forever reports 0 achievement points, so Everstats counts achievements instead.</span>
          </div>
        </div>
      )}
    </section>
  );
}

function ReputationsScreen({ slug, count, ruleset }) {
  const { loading, section: sec, error } = useSection(slug, 'reputations');
  const [q, setQ] = useState('');
  const [only, setOnly] = useState('all');
  if (loading) return <Loading />;
  if (error) return <Failed error={error} />;
  const needle = q.trim().toLowerCase();
  const keep = (r) => (only === 'all' || r.standing === 'Exalted') && (!needle || (r.name ?? '').toLowerCase().includes(needle));
  return (
    <section className="stack gap-16" aria-label="Reputations">
      <ScreenHead glyph="reputations" title="Reputations" sub={sec.groups ? `Exalted with ${formatNumber(sec.exalted)}` : null} count={count} ruleset={ruleset} />
      {sec.state !== 'ok' && <SectionState section={sec} glyph="reputations" what="reputations" />}
      {sec.groups && (
        <>
          <details className="panel">
            <summary className="pad-14">How to read a standing bar</summary>
            <div className="stack gap-8 pad-14">
              <div className="standing-scale" aria-hidden="true">{STANDINGS.map((s) => <span key={s}>{s}</span>)}</div>
              <span className="small t2">Eight steps from Hated to Exalted. Filled steps are reached; the current step fills by your progress inside it. The step number and the standing’s name always say the same thing as the colours.</span>
            </div>
          </details>
          <div className="fbar">
            <label className="search"><Icon name="search" size="sm" /><input className="inp" type="search" placeholder="Search factions" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search factions" data-edit-guard="off" /></label>
            <Segmented label="Show" value={only} onChange={setOnly} scroll={false} options={[{ id: 'all', label: 'All' }, { id: 'exalted', label: 'Exalted' }]} />
          </div>
          {sec.groups.map((g) => {
            const items = g.items.filter(keep);
            if (!items.length) return null;
            return (
              <section key={g.name ?? 'other'} className="panel stack gap-14 pad-16">
                <h3 className="eyebrow">{g.name ?? 'Other factions'}</h3>
                <div className="repgroup">{items.map((r) => <StandingBar key={r.id} rep={r} />)}</div>
              </section>
            );
          })}
        </>
      )}
    </section>
  );
}

function ProfessionsScreen({ slug }) {
  const { loading, section: sec, error } = useSection(slug, 'professions');
  if (loading) return <Loading />;
  if (error) return <Failed error={error} />;
  const block = (title, list) => (list?.length ? (
    <section className="stack gap-10">
      <h3 className="eyebrow">{title}</h3>
      {list.map((p) => (
        <div key={p.id} className="panel prof">
          <Glyph name="professions" />
          <div className="hd"><span className="h3">{p.name}</span>{p.tiers.some((t) => t.max && t.skill >= t.max) && <span className="tag gold">Max skill</span>}</div>
          <div className="stack gap-8">{p.tiers.map((t, i) => <CompletionBar key={t.id ?? i} label={`${t.name ?? p.name}${t.recipes !== null ? ` · ${formatNumber(t.recipes)} recipes` : ''}`} have={t.skill ?? 0} total={t.max} />)}</div>
        </div>
      ))}
    </section>
  ) : null);
  return (
    <section className="stack gap-16" aria-label="Professions">
      <ScreenHead glyph="professions" title="Professions" />
      {sec.state !== 'ok' && <SectionState section={sec} glyph="professions" what="professions" />}
      {block('Primary', sec.primaries)}
      {block('Secondary', sec.secondaries)}
    </section>
  );
}

function EncountersScreen({ slug }) {
  const d = useSection(slug, 'dungeons');
  const r = useSection(slug, 'raids');
  if (d.loading || r.loading) return <Loading />;
  const part = (title, s) => (s.section ? (
    <section className="stack gap-10">
      <h3 className="eyebrow">{title}</h3>
      {s.section.state !== 'ok' ? <SectionState section={s.section} glyph="dungeons" what={title.toLowerCase()} /> : s.section.items.map((inst) => (
        <div key={inst.id} className="panel inst">
          {inst.modes.map((m, i) => (
            <div key={i} className="stack gap-10">
              <div className="hd"><span className="h3">{inst.name}</span>{m.difficulty && <span className="tag">{m.difficulty}</span>}{inst.expansion && <span className="muted xsmall">{inst.expansion}</span>}</div>
              {m.total ? <CompletionBar label="Bosses killed" have={m.completed ?? 0} total={m.total} /> : null}
              <div className="bosses">{m.bosses.map((b) => <div key={b.id} className={`boss${b.kills ? '' : ' no'}`}><span className="pip" aria-hidden="true" /><span className="nmx">{b.name}</span><span className="k">{b.kills ? `${formatNumber(b.kills)} kill${b.kills === 1 ? '' : 's'}` : 'Not killed'}</span></div>)}</div>
            </div>
          ))}
        </div>
      ))}
    </section>
  ) : null);
  return (
    <section className="stack gap-16" aria-label="Dungeons and raids">
      <ScreenHead glyph="dungeons" title="Dungeons & raids" />
      {part('Dungeons', d)}
      {part('Raids', r)}
    </section>
  );
}

function QuestsScreen({ slug, count, ruleset }) {
  const [q, setQ] = useState('');
  const [asked, setAsked] = useState({ q: '', cursor: 0 });
  const { loading, section: sec, error } = useSection(slug, 'quests', `?q=${encodeURIComponent(asked.q)}&cursor=${asked.cursor}`);
  useEffect(() => {
    const t = setTimeout(() => setAsked({ q, cursor: 0 }), 300);
    return () => {
      clearTimeout(t);
    };
  }, [q]);
  if (error) return <Failed error={error} />;
  const done = sec?.completed;
  const mark = (name) => {
    if (!asked.q || !name) return name;
    const i = name.toLowerCase().indexOf(asked.q);
    return i < 0 ? name : <>{name.slice(0, i)}<mark>{name.slice(i, i + asked.q.length)}</mark>{name.slice(i + asked.q.length)}</>;
  };
  return (
    <section className="stack gap-16" aria-label="Quests">
      <ScreenHead glyph="quests" title="Quests" count={count} ruleset={ruleset} />
      {sec && (
        <div className="kvgrid">
          <div className="cell"><b>{done.state === 'never' ? '—' : formatNumber(done.total)}</b><span>Completed (Blizzard’s quest log)</span></div>
          <div className="cell"><b>{sec.inProgress.state === 'never' ? '—' : formatNumber(sec.inProgress.items.length)}</b><span>In progress</span></div>
        </div>
      )}
      <section className="stack gap-10">
        <h3 className="h3">Completed</h3>
        <label className="search"><Icon name="search" size="sm" /><input className="inp" type="search" placeholder="Search completed quests by name or id" value={q} onChange={(e) => setQ(e.target.value.slice(0, 80))} aria-label="Search completed quests" data-edit-guard="off" /></label>
        {loading || !sec ? <Loading /> : done.state !== 'ok' ? <SectionState section={done} glyph="quests" what="completed quests" /> : (
          <>
            <div className="panel qlist">
              {done.items.map((x) => <div key={x.id} className="qrow"><span className="nm">{mark(x.name)}</span><span className="id">#{x.id}</span></div>)}
              {!done.items.length && <span className="muted small pad-14">No completed quest matches “{asked.q}”.</span>}
            </div>
            <div className="row gap-12">
              <span className="muted small">{done.matched ? `${formatNumber(done.start + 1)}–${formatNumber(done.start + done.items.length)} of ${formatNumber(done.matched)}` : ''}{asked.q ? ` matching “${asked.q}”` : ''}</span>
              <span className="spacer" />
              {done.start > 0 && <button type="button" className="btn sm ghost" onClick={() => setAsked({ ...asked, cursor: Math.max(0, done.start - 50) })}>Previous</button>}
              {done.next && <button type="button" className="btn sm" onClick={() => setAsked({ ...asked, cursor: Number(done.next) })}>Next</button>}
            </div>
          </>
        )}
      </section>
      {sec && (
        <section className="stack gap-10">
          <h3 className="h3">In progress</h3>
          {sec.inProgress.state !== 'ok' ? <SectionState section={sec.inProgress} glyph="quests" what="quests in progress" /> : (
            <div className="panel qlist">{sec.inProgress.items.map((x) => <div key={x.id} className="qrow"><span className="nm">{x.name}</span><span className="id">#{x.id}</span></div>)}</div>
          )}
          <span className="muted xsmall">Blizzard lists quests in progress without their objectives, so there are no progress bars.</span>
        </section>
      )}
    </section>
  );
}

const PVP_LABELS = { honorable_kills: 'Honorable kills', pvp_rank: 'PvP rank', honor_level: 'Honor level' };
function PvpScreen({ slug }) {
  const { loading, section: sec, error } = useSection(slug, 'pvp');
  if (loading) return <Loading />;
  if (error) return <Failed error={error} />;
  const fields = sec.fields ?? {};
  const known = Object.keys(PVP_LABELS);
  const keys = [...known, ...Object.keys(fields).filter((k) => !known.includes(k))];
  return (
    <section className="stack gap-16" aria-label="PvP">
      <ScreenHead glyph="pvp" title="PvP" sub="Blizzard’s PvP summary" />
      {sec.state !== 'ok' && <SectionState section={sec} glyph="pvp" what="PvP data" />}
      {sec.fields && (
        <div className="kvgrid">
          {keys.map((k) => (
            <div key={k} className="cell">
              <b>{k in fields ? formatNumber(fields[k]) : '—'}</b>
              <span>{PVP_LABELS[k] ?? k.replace(/_/g, ' ').replace(/^./, (x) => x.toUpperCase())}{k in fields ? '' : ' · not returned'}</span>
            </div>
          ))}
        </div>
      )}
      <span className="muted xsmall">Forever has no PvP seasons or rated brackets in Blizzard’s API, so only the summary is shown.</span>
    </section>
  );
}

function LegacyScreen({ slug, count, ruleset }) {
  const { loading, section: sec, error } = useSection(slug, 'legacy');
  if (loading) return <Loading />;
  if (error) return <Failed error={error} />;
  return (
    <section className="stack gap-16" aria-label="Legacy Points">
      <ScreenHead glyph="legacy" title="Legacy Points" count={count} ruleset={ruleset} shared={sec.accountWide ? { how: 'stated' } : null} />
      {sec.state !== 'ok' && sec.state !== 'empty' && <SectionState section={sec} glyph="legacy" what="achievements" />}
      {!sec.catalog && <div className="note small"><Icon name="clock" /><span>Legacy Points are counted from Blizzard’s achievement list, which Everstats hasn’t finished reading yet.</span></div>}
      {sec.points !== null && (
        <>
          <div className="cbig"><b>{formatNumber(sec.points)}</b><span>Legacy Points{sec.available ? ` · ${formatNumber(sec.available.points)} available from ${formatNumber(sec.available.achievements)} achievements` : ''}</span></div>
          <p className="small t2">Everstats adds up the “Earn N Legacy Points” rewards on the achievements this character has earned, as Blizzard words them.{sec.accountWide ? ' Blizzard marks every one of those achievements as account-wide, so the total is shared across the Battle.net account.' : ''}</p>
          {sec.earning.length ? (
            <div className="panel achs">
              {sec.earning.map((e) => (
                <div key={e.id} className="ach">
                  <Tile item={{ id: e.id, name: e.name, collected: true }} glyph="achievements" size="sm" bare />
                  <span className="nm">{e.name}</span><span className="when">{formatDate(e.completedAt)}</span>
                  <span className="ds">+{e.points} Legacy Point{e.points === 1 ? '' : 's'}</span>
                </div>
              ))}
            </div>
          ) : <CollectionEmpty glyph="legacy" what="Legacy Points" checkedAt={sec.checkedAt} />}
        </>
      )}
    </section>
  );
}

export { NotReturned, WowheadLink };
