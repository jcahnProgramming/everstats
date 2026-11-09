import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { characterSlug } from '../../../server/stats/slug.js';
import { Emblem, SearchIcon } from '../chrome/icons.jsx';
import { EmptyState } from '../components/EmptyState.jsx';
import './pages.css';

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

  return (
    <>
      <section className="hero">
        <Emblem size={88} />
        <div className="hero-copy">
          <p className="eyebrow smallcaps">WoW Forever · US</p>
          <h1>Every statistic. Every character.</h1>
          <p className="muted">Look up a character by name and surname to see their gear, their stats, and the numbers the game keeps quietly: deaths, kills, times camped and hundreds more, with a leaderboard for each.</p>
        </div>
      </section>

      <form className="panel search" onSubmit={submit} noValidate aria-describedby={problem ? 'search-problem' : undefined}>
        <div className="search-fields">
          <div className="field">
            <label htmlFor="name">Name</label>
            <input id="name" className="input" value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" spellCheck="false" maxLength={24} />
          </div>
          <div className="field">
            <label htmlFor="surname">Surname</label>
            <input id="surname" className="input" value={surname} onChange={(e) => setSurname(e.target.value)} autoComplete="off" spellCheck="false" maxLength={24} />
          </div>
          <button type="submit" className="btn btn-primary search-go">
            <SearchIcon size={18} /> Look up
          </button>
        </div>
        {problem && <p id="search-problem" className="notice notice-danger">{problem}</p>}
        <p className="faint">Characters are realmless. Blizzard lists a character from level 10, once they've logged out at least once.</p>
      </form>

      <EmptyState kind="soon" title="Lookups aren't switched on yet">
        <span>When they are, a search fetches the character from Blizzard straight away, and every character Everstats tracks is refreshed at least once a day.</span>
      </EmptyState>
    </>
  );
}
