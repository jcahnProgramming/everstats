import { formatCalendarDate } from '../format.js';
import { APP_VERSION, RELEASES } from '../release.js';

/**
 * What's new (design/v1/pages/changelog): a diamond-rail timeline, newest first, from CHANGELOG.json (bundled with
 * this build). Reached only from the version chip in the footer. The mockup's "Unreleased / Next" entry is left out:
 * CHANGELOG.json records releases, and a list of what's coming would be a promise, not a record.
 */
export function ChangelogPage() {
  return (
    <div className="wrap narrow page-pad stack gap-32">
      <div className="stack gap-8">
        <span className="eyebrow">everstats.app</span>
        <h1 className="h1">What's new</h1>
        <span className="t2">Every release, newest first. You're on v{APP_VERSION}.</span>
      </div>
      <ol className="timeline">
        {RELEASES.map((release, i) => (
          <li key={release.version}>
            <span className="rail" aria-hidden="true"><span className="gem" /><span className="line" /></span>
            <article aria-labelledby={`v-${release.version}`}>
              <div className="row gap-12 release-head">
                <h2 className="mono release-version" id={`v-${release.version}`}>{release.version}</h2>
                {i === 0 && <span className="tag gold">Current</span>}
                <time className="muted small" dateTime={release.date}>{formatCalendarDate(release.date)}</time>
              </div>
              <p className="h3 release-title">{release.title}</p>
              {Object.entries(release.sections).map(([section, items]) => (
                <div key={section} className="stack gap-6">
                  <h3 className="eyebrow">{section}</h3>
                  <ul className="t2 stack gap-6 tips">{items.map((item) => <li key={item}>{item}</li>)}</ul>
                </div>
              ))}
            </article>
          </li>
        ))}
      </ol>
    </div>
  );
}
