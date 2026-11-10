import { formatCalendarDate } from '../format.js';
import { APP_VERSION, SITE_ENVIRONMENT, testedRange, visibleReleases } from '../release.js';

/**
 * What's new (design/v1/pages/changelog): a diamond-rail timeline, newest first, from CHANGELOG.json (bundled with
 * this build). Reached only from the version chip in the footer. The mockup's "Unreleased / Next" entry is left out:
 * CHANGELOG.json records releases, and a list of what's coming would be a promise, not a record.
 *
 * 0.10.2: two sites (RELEASING.md). Production shows releases and hotfixes only. The dev site shows everything: each
 * dev build tagged "In testing", and under each release the dev builds it was tested as.
 */
export function ChangelogPage() {
  const dev = SITE_ENVIRONMENT === 'dev';
  const releases = visibleReleases();
  return (
    <div className="wrap narrow page-pad stack gap-32">
      <div className="stack gap-8">
        <span className="eyebrow">{dev ? 'dev.everstats.app' : 'everstats.app'}</span>
        <h1 className="h1">What's new</h1>
        <span className="t2">
          {dev
            ? `Every build on the test site, newest first. Builds marked “In testing” haven’t reached everstats.app yet. You're on v${APP_VERSION}.`
            : `Every release, newest first. You're on v${APP_VERSION}.`}
        </span>
      </div>
      <ol className="timeline">
        {releases.map((release, i) => (
          <li key={release.version}>
            <span className="rail" aria-hidden="true"><span className="gem" /><span className="line" /></span>
            <article aria-labelledby={`v-${release.version}`}>
              <div className="row gap-12 release-head">
                <h2 className="mono release-version" id={`v-${release.version}`}>{release.version}</h2>
                {i === 0 && <span className="tag gold">Current</span>}
                {release.kind === 'dev' && <span className="tag release-testing">In testing</span>}
                <time className="muted small" dateTime={release.date}>{formatCalendarDate(release.date)}</time>
              </div>
              <p className="h3 release-title">{release.title}</p>
              <Sections sections={release.sections} />
              {dev && testedRange(release) && (
                <details className="stack gap-12">
                  <summary className="muted small release-tested">Tested as {testedRange(release)}</summary>
                  <div className="stack gap-16">
                    {release.tested.map((build) => (
                      <div key={build.version} className="stack gap-6">
                        <p className="small"><span className="mono">{build.version}</span> · {formatCalendarDate(build.date)} · {build.title}</p>
                        <Sections sections={build.sections} />
                      </div>
                    ))}
                  </div>
                </details>
              )}
            </article>
          </li>
        ))}
      </ol>
    </div>
  );
}

function Sections({ sections }) {
  return Object.entries(sections).map(([section, items]) => (
    <div key={section} className="stack gap-6">
      <h3 className="eyebrow">{section}</h3>
      <ul className="t2 stack gap-6 tips">{items.map((item) => <li key={item}>{item}</li>)}</ul>
    </div>
  ));
}
