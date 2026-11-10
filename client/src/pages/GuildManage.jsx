import { useCallback, useEffect, useState } from 'react';
import { Link } from '../scope.jsx';
import { api } from '../api.js';
import { Icon } from '../chrome/Icon.jsx';
import { Button, Field, Modal } from '../components/Controls.jsx';
import { useToasts } from '../components/Toasts.jsx';
import { formatDate } from '../format.js';
import { useSession } from '../session.jsx';
import { ReportButton } from '../moderation/Moderation.jsx';
import { useFeature } from '../features.js';

/**
 * Guild page management (0.7.0), built from v1 parts only (panel, field, buttons, tags, note, modal).
 *
 *   GuildLinksArea  the public "Links" area: description (plain text, never linkified), the Discord invite (built from
 *                   a code) and up to 5 labelled links, each showing its label AND its domain. A link opens only after
 *                   a "You're leaving Everstats for {domain}" notice, in a new tab, rel="noopener noreferrer nofollow".
 *                   Every link has "Report this link". Shown only when something is set.
 *   ManageGuild     "Manage guild", only for the Guild Master (the account owning the roster's rank-0 character) and
 *                   the officers they added. Edits only what Everstats owns: never the name, faction or roster.
 */
export function GuildLinksArea({ links, slug }) {
  const [leaving, setLeaving] = useState(null);
  const [reporting, setReporting] = useState(null);
  const reportsOn = useFeature('reports'); // 0.10.3: Player reports switch
  if (!links) return null;
  const all = [
    ...(links.discord ? [{ id: 'discord', label: 'Discord server', url: links.discord.url, host: 'discord.gg', discord: true }] : []),
    ...links.links,
  ];
  return (
    <section className="panel pad-20 guild-links" aria-labelledby="links-h">
      <h2 className="eyebrow" id="links-h">Links</h2>
      {links.description && (
        <div className="stack gap-4">
          <p className="t2 guild-desc">{links.description}</p>
          {/* 0.8.2: anyone can report the description (links have their own "Report this link"). */}
          <span className="self-start"><ReportButton guild={slug} label="Report the description" /></span>
        </div>
      )}
      {all.length > 0 && (
        <ul className="plain guild-links-list">
          {all.map((l) => (
            <li key={l.id} className="row gap-4">
              <a className="btn sm ghost guild-link" href={l.url} target="_blank" rel="noopener noreferrer nofollow" onClick={(e) => {
                e.preventDefault();
                setLeaving(l);
              }}>
                <b>{l.label}</b>
                <span className="host">{l.discord ? `discord.gg/${links.discord.code}` : l.host}</span>
              </a>
              {!l.discord && reportsOn && (
                <button type="button" className="btn ghost sm icon" aria-label={`Report the link “${l.label}”`} title="Report this link" onClick={() => setReporting(l)}>
                  <Icon name="warning" size="sm" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      <span className="muted xsmall">Written by this guild’s Guild Master or officers, not checked by Everstats. Links open in a new tab.</span>
      {leaving && (
        <Modal title={`You’re leaving Everstats for ${leaving.host}`} onClose={() => setLeaving(null)} actions={(
          <>
            <button type="button" className="btn ghost" onClick={() => setLeaving(null)}>Stay here</button>
            <a className="btn gold" href={leaving.url} target="_blank" rel="noopener noreferrer nofollow" onClick={() => setLeaving(null)}>
              Continue to {leaving.host}<Icon name="external" size="sm" />
            </a>
          </>
        )}>
          <p className="t2">“{leaving.label}” goes to a site Everstats doesn’t run or check:</p>
          <p className="mono small">{leaving.url}</p>
        </Modal>
      )}
      {reporting && <ReportLink link={reporting} slug={slug} onClose={() => setReporting(null)} />}
    </section>
  );
}

function ReportLink({ link, slug, onClose }) {
  const toast = useToasts();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState(null);
  const send = async () => {
    setBusy(true);
    try {
      await api(`/api/guilds/${encodeURIComponent(slug)}/links/${link.id}/report`, { method: 'POST', body: { note } });
      toast.ok('Reported', 'Everstats will look at this link.');
      onClose();
    } catch (err) {
      setProblem(err.message);
      setBusy(false);
    }
  };
  return (
    <Modal title="Report this link" onClose={onClose} busy={busy} actions={(
      <>
        <button type="button" className="btn ghost" onClick={onClose} disabled={busy}>Cancel</button>
        <Button className="btn" loading={busy} onClick={send}>Report</Button>
      </>
    )}>
      <p className="t2">“{link.label}” → <span className="mono">{link.host}</span></p>
      <Field label="What’s wrong with it? (optional)" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} error={problem} />
    </Modal>
  );
}

const blankLink = () => ({ label: '', url: '' });

/** The Guild Master's and officers' panel. Renders nothing for anyone else. */
export function ManageGuild({ slug, onSaved }) {
  const session = useSession();
  const toast = useToasts();
  const [state, setState] = useState(null);
  const [form, setForm] = useState(null);
  const [problem, setProblem] = useState(null);
  const [busy, setBusy] = useState(false);
  const [officer, setOfficer] = useState('');
  const [officerProblem, setOfficerProblem] = useState(null);

  const load = useCallback(async () => {
    try {
      const s = await api(`/api/guilds/${encodeURIComponent(slug)}/manage`);
      setState(s);
      if (s.role) setForm({ description: s.description, discordInvite: s.discordInvite, links: s.links.map((l) => ({ label: l.label, url: l.url })) });
    } catch {
      setState({ role: null });
    }
  }, [slug]);
  useEffect(() => {
    if (session.signedIn) load();
  }, [session.signedIn, load]);

  if (!session.signedIn || !state?.role || !form) return null;

  const save = async () => {
    setBusy(true);
    setProblem(null);
    try {
      const s = await api(`/api/guilds/${encodeURIComponent(slug)}/manage`, { method: 'PUT', body: { ...form, links: form.links.filter((l) => l.label.trim() || l.url.trim()) } });
      setState(s);
      setForm({ description: s.description, discordInvite: s.discordInvite, links: s.links.map((l) => ({ label: l.label, url: l.url })) });
      toast.ok('Guild page saved', 'The Links area shows it now.');
      onSaved?.();
    } catch (err) {
      setProblem(err.message);
    } finally {
      setBusy(false);
    }
  };
  const addOfficer = async (e) => {
    e.preventDefault();
    setOfficerProblem(null);
    try {
      setState(await api(`/api/guilds/${encodeURIComponent(slug)}/manage/editors`, { method: 'POST', body: { username: officer } }));
      setOfficer('');
      toast.ok('Officer added', 'They can edit this guild page while they have a character in the guild.');
    } catch (err) {
      setOfficerProblem(err.message);
    }
  };
  const removeOfficer = async (username) => {
    try {
      setState(await api(`/api/guilds/${encodeURIComponent(slug)}/manage/editors/${encodeURIComponent(username)}`, { method: 'DELETE' }));
      toast.ok('Officer removed');
    } catch (err) {
      toast.err('Couldn’t remove that officer', err.message);
    }
  };
  const setLink = (i, key, value) => setForm((f) => ({ ...f, links: f.links.map((l, j) => (j === i ? { ...l, [key]: value } : l)) }));

  return (
    <section className="panel pad-24 stack gap-18" aria-labelledby="manage-h" id="manage">
      <div className="stack gap-6">
        <div className="row gap-10">
          <h2 className="h2" id="manage-h">Manage guild</h2>
          <span className="tag gold">{state.role === 'gm' ? 'Guild Master' : 'Officer'}</span>
        </div>
        <span className="t2 small">
          {state.role === 'gm'
            ? <>You lead this guild in game{state.gmCharacter ? <> as <Link to={`/c/${encodeURIComponent(state.gmCharacter.slug)}`}>{state.gmCharacter.name} {state.gmCharacter.surname}</Link></> : null} (rank 0 on Blizzard’s roster{state.rosterAt ? ` as of ${formatDate(state.rosterAt)}` : ''}). If that changes, control moves at the next roster refresh.</>
            : <>The Guild Master added you as an officer. You can edit while you have a character in this guild that’s shown on Everstats.</>}
        </span>
        <span className="muted xsmall">You can change only what Everstats keeps for the guild. The name, faction and roster come from Blizzard.</span>
      </div>

      <div className="field">
        <label htmlFor={`${slug}-desc`}>Description <span className="muted">(up to 280 characters, plain text)</span></label>
        <textarea id={`${slug}-desc`} className="inp" maxLength={280} rows={3} value={form.description} aria-describedby={`${slug}-desc-note`} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
        <span className="help" id={`${slug}-desc-note`}>{[...form.description].length}/280 · Links typed here are not made clickable.</span>
      </div>
      <Field label="Discord invite code" help="The part after discord.gg/ (letters, digits and hyphens). Everstats builds the link." value={form.discordInvite} onChange={(e) => setForm((f) => ({ ...f, discordInvite: e.target.value }))} maxLength={32} />

      <fieldset className="plain-fieldset stack gap-10">
        <legend className="strong-text">Links <span className="muted">({form.links.length} of {state.maxLinks})</span></legend>
        <span className="help">https only, a real domain name (no IP addresses), no link shorteners. Visitors see the label and the domain, and a “You’re leaving Everstats” notice before they go.</span>
        {form.links.map((l, i) => (
          <div key={i} className="link-edit">
            <Field label={`Label ${i + 1}`} value={l.label} maxLength={40} placeholder="Raid team application" onChange={(e) => setLink(i, 'label', e.target.value)} />
            <Field label={`Address ${i + 1}`} value={l.url} maxLength={400} placeholder="https://" inputMode="url" onChange={(e) => setLink(i, 'url', e.target.value)} />
            <button type="button" className="btn ghost sm" onClick={() => setForm((f) => ({ ...f, links: f.links.filter((_, j) => j !== i) }))}>Remove</button>
          </div>
        ))}
        {form.links.length < state.maxLinks && (
          <button type="button" className="btn sm self-start" onClick={() => setForm((f) => ({ ...f, links: [...f.links, blankLink()] }))}><Icon name="plus" size="sm" />Add a link</button>
        )}
      </fieldset>
      {problem && <div className="note err small" role="alert"><Icon name="error" /><span>{problem}</span></div>}
      <div className="row gap-10">
        <Button className="btn gold" loading={busy} onClick={save}>Save guild page</Button>
        {state.updatedAt && <span className="muted xsmall">Last saved {formatDate(state.updatedAt)}</span>}
      </div>

      {state.role === 'gm' && (
        <div className="stack gap-12">
          <h3 className="h3">Officers</h3>
          <span className="t2 small">Officers can edit this page too. Only players who own a character in this guild that’s tracked and shown on Everstats can be added; they lose access by themselves if they leave.</span>
          {state.editors.length === 0 ? <span className="muted small">No officers yet.</span> : (
            <ul className="plain stack gap-6">
              {state.editors.map((e) => (
                <li key={e.username ?? e.addedAt} className="row gap-10">
                  <span className="mono">{e.username ? `@${e.username}` : 'A player without a username'}</span>
                  {!e.active && <span className="tag">No character in the guild: can’t edit</span>}
                  <span className="muted xsmall">added {formatDate(e.addedAt)}</span>
                  <span className="spacer" />
                  {e.username && <button type="button" className="btn ghost sm" onClick={() => removeOfficer(e.username)}>Remove</button>}
                </li>
              ))}
            </ul>
          )}
          <form className="row gap-8 align-end" onSubmit={addOfficer}>
            <Field label="Add an officer by username" placeholder="@username" value={officer} onChange={(e) => setOfficer(e.target.value)} maxLength={21} error={officerProblem} />
            <button type="submit" className="btn" disabled={!officer.trim()}>Add</button>
          </form>
        </div>
      )}
    </section>
  );
}
