import { APP_VERSION, RELEASES } from '../release.js';
import './pages.css';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
// "2026-11-08" → "8 Nov 2026", read as a calendar date (no time zone can shift it a day).
function formatDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}
const SECTION_CHIP = { New: 'chip-accent', Improved: 'chip-success' };

// Reached only from the version in the bottom bar. Rendered from CHANGELOG.json, bundled with this build.
export function ChangelogPage() {
  return (
    <>
      <div className="page-head">
        <h1>What's new</h1>
        <p className="muted">You're on v{APP_VERSION}.</p>
      </div>
      {RELEASES.map((release, i) => (
        <article key={release.version} className="panel release" aria-labelledby={`v-${release.version}`}>
          <div className="panel-head">
            <h2 id={`v-${release.version}`} className="row">
              <span className="mono">v{release.version}</span>
              {i === 0 && <span className="chip chip-accent">Current</span>}
            </h2>
            <time className="faint" dateTime={release.date}>{formatDate(release.date)}</time>
          </div>
          <p className="release-title display">{release.title}</p>
          {Object.entries(release.sections).map(([section, items]) => (
            <div key={section} className="stack">
              <h3><span className={`chip ${SECTION_CHIP[section] ?? ''}`}>{section}</span></h3>
              <ul className="release-items">
                {items.map((item) => <li key={item}>{item}</li>)}
              </ul>
            </div>
          ))}
        </article>
      ))}
    </>
  );
}
