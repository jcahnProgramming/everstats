import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { characterSlug } from '../../../server/stats/slug.js';
import { Emblem } from '../chrome/BrandMark.jsx';
import { Icon } from '../chrome/Icon.jsx';
import { Field } from '../components/Controls.jsx';
import { EmptyState } from '../components/EmptyState.jsx';
import { TierBadge } from '../components/Tier.jsx';

/**
 * Home (design/v1/pages/home): hero with the two-field search, three pillars, featured leaderboards.
 *
 * Different from the mockup, on purpose:
 *   - Featured leaderboards: the mockup shows top-5 lists of four "curated statistics" for a chosen ruleset. There
 *     are no boards yet, and picking four statistics here would hardcode statistics (CLAUDE.md), so the section says
 *     it's coming. When it's built, which boards are featured is data, not a list in this file.
 *   - Pillar II named the four rulesets and "Hardcore joins later": rulesets come from Blizzard's list, never typed in.
 *   - No "Placeholdername" in the inputs.
 *   - The emblem's "Overall tier" card shows a letter with no one's name on it: it explains the idea, it isn't a grade.
 */
const PILLARS = [
  ['I', 'Hundreds of statistics', 'Deaths, kills, social numbers, times camped — the whole in-game statistics pane, grouped and searchable.'],
  ['II', 'A board for each one', 'Every statistic ranks separately on each ruleset. A new ruleset gets its own boards the day Blizzard lists it.'],
  ['III', 'Daily snapshots, kept', 'A fresh look-up when you search someone, plus a daily crawl — so every number has a history.'],
];

export function HomePage() {
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [surname, setSurname] = useState('');
  const [problem, setProblem] = useState(null);

  const submit = (e) => {
    e.preventDefault();
    const r = characterSlug(name, surname);
    if (!r.ok) return setProblem(r.problem);
    setProblem(null);
    return navigate(`/c/${encodeURIComponent(r.slug)}`);
  };
  const nameProblem = problem && /surname/i.test(problem) ? null : problem;
  const surnameProblem = problem && /surname/i.test(problem) ? problem : null;

  return (
    <>
      <section className="wrap grid-auto col-xl home-hero">
        <div className="stack gap-24">
          <span className="eyebrow">World of Warcraft: Forever · US region</span>
          <h1 className="h-hero">Every death, hug and camp — ranked.</h1>
          <p className="lead narrow-text">
            Look up any Forever character to open their full in-game statistics, each with its own leaderboard per
            ruleset — and one letter tier, S to D, graded against the players they actually share a ruleset with.
          </p>
          <form className="sheet stack gap-14 home-search" role="search" onSubmit={submit} noValidate>
            <div className="grid-auto col-120 gap-12">
              <Field label="First name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" spellCheck="false" maxLength={24} error={nameProblem} />
              <Field label="Surname" value={surname} onChange={(e) => setSurname(e.target.value)} autoComplete="off" spellCheck="false" maxLength={24} error={surnameProblem} />
            </div>
            <div className="row gap-12">
              <button type="submit" className="btn gold home-go"><Icon name="search" />Open character sheet</button>
              <span className="muted xsmall">Characters appear from level 10, after their first log-out.</span>
            </div>
          </form>
          <EmptyState kind="soon" compact title="Look-ups aren't switched on yet">
            <span>A search opens the character's page, which says plainly that there's nothing to show yet. When look-ups are on, a search fetches the character from Blizzard straight away.</span>
          </EmptyState>
        </div>
        <div className="hide-phone home-emblem">
          <Emblem />
          <div className="panel row gap-10 home-tier-card">
            <TierBadge letter="S" size="md" label="Example tier letter" />
            <span className="stack">
              <span className="disp strong">Overall tier</span>
              <span className="muted xsmall">S to D, rolled up from every category</span>
            </span>
          </div>
        </div>
      </section>

      <section className="wrap grid-auto home-pillars" aria-label="What Everstats does">
        {PILLARS.map(([numeral, title, text]) => (
          <div key={numeral} className="row gap-14 pillar">
            <span className="disp pillar-numeral" aria-hidden="true">{numeral}</span>
            <div className="stack gap-4"><h2 className="h3">{title}</h2><span className="t2">{text}</span></div>
          </div>
        ))}
      </section>

      <section className="wrap stack gap-20 home-featured" aria-labelledby="featured-h">
        <div className="orn"><span className="gem" /><h2 className="h2" id="featured-h">Featured leaderboards</h2><span className="rule" /></div>
        <EmptyState kind="soon" title="Featured leaderboards appear once Everstats tracks characters">
          <span>Each board will show its top five for the ruleset you pick, with a link to the full board.</span>
        </EmptyState>
      </section>
    </>
  );
}
