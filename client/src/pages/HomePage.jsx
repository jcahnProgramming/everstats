import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { characterSlug } from '../../../server/stats/slug.js';
import { Emblem } from '../chrome/BrandMark.jsx';
import { Icon } from '../chrome/Icon.jsx';
import { Field } from '../components/Controls.jsx';
import { TierBadge } from '../components/Tier.jsx';
import { useSession } from '../session.jsx';
import { useCoverage } from '../useCoverage.js';
import { DashboardPage } from './DashboardPage.jsx';
import { WhySignIn } from '../chrome/SignInNudge.jsx';

/**
 * Home (design/v1/pages/home): hero with the two-field search, three pillars, featured leaderboards.
 *
 * Different from the mockup, on purpose:
 *   - Signed in, home is the player's dashboard (DashboardPage.jsx); this page is for visitors.
 *   - Featured leaderboards: the mockup shows top-5 lists of four "curated statistics". Picking four statistics here
 *     would hardcode statistics (CLAUDE.md), so the section links to the leaderboards instead.
 *   - Pillar II named the four rulesets and "Hardcore joins later": rulesets come from Blizzard's list, never typed in.
 *   - No "Placeholdername" in the inputs.
 *   - The emblem's "Overall tier" card shows a letter with no one's name on it: it explains the idea, it isn't a grade.
 *   - 0.8.0: "Why sign in?" right after the search (chrome/SignInNudge.jsx), built from v1 parts: the live benefits,
 *     both sign-in buttons and the real tracked counts. Visitors only; nothing is blocked without an account.
 */
const PILLARS = [
  ['I', 'Hundreds of statistics', 'Deaths, kills, social numbers, times camped — the whole in-game statistics pane, grouped and searchable.'],
  ['II', 'A board for each one', 'Every statistic ranks separately on each ruleset. A new ruleset gets its own boards the day Blizzard lists it.'],
  // 0.8.1: was "Daily snapshots, kept … so every number has a history", written before the 30-day rule (0.4.2). Blizzard's
  // terms allow keeping its data 30 days at most, so the history covers the live window (keepDays from /api/coverage).
  ['III', 'Daily snapshots', (days) => (days
    ? `A fresh look-up when you search someone, plus a daily crawl. Progress, rank movement and the “Last ${days} days” boards cover the last ${days} days: Blizzard’s rules don’t let Everstats keep its data longer.`
    : 'A fresh look-up when you search someone, plus a daily crawl. Blizzard’s rules let Everstats keep its data for 30 days at most, so history covers that window.')],
];

export function HomePage() {
  const session = useSession();
  if (session.signedIn) return <DashboardPage />;
  return <VisitorHome />;
}

function VisitorHome() {
  const navigate = useNavigate();
  const { coverage } = useCoverage();
  const [name, setName] = useState('');
  const [surname, setSurname] = useState('');
  const [problem, setProblem] = useState(null);

  const submit = (e) => {
    e.preventDefault();
    const r = characterSlug(name, surname);
    if (!r.ok) return setProblem(r.problem);
    setProblem(null);
    return navigate(`/c/${encodeURIComponent(r.slug)}`, { state: { via: 'search' } });
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
          <p className="t2 small">A search fetches the character from Blizzard straight away. <Link to="/sign-in">Sign in with Battle.net</Link> and every Forever character on your account joins the boards at once.</p>
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

      <WhySignIn />

      <section className="wrap grid-auto home-pillars" aria-label="What Everstats does">
        {PILLARS.map(([numeral, title, text]) => (
          <div key={numeral} className="row gap-14 pillar">
            <span className="disp pillar-numeral" aria-hidden="true">{numeral}</span>
            <div className="stack gap-4"><h2 className="h3">{title}</h2><span className="t2">{typeof text === 'function' ? text(coverage?.keepDays ?? null) : text}</span></div>
          </div>
        ))}
      </section>

      <section className="wrap stack gap-20 home-featured" aria-labelledby="featured-h">
        <div className="orn"><span className="gem" /><h2 className="h2" id="featured-h">Featured leaderboards</h2><span className="rule" /></div>
        <div className="panel pad-20 row gap-14">
          <span className="t2 flex-fill">A board for every statistic on every ruleset: overall, this week, and over the last few weeks. Beta: they fill up as players join.</span>
          <Link className="btn gold" to="/leaderboards">Browse the leaderboards</Link>
        </div>
      </section>
    </>
  );
}
