# Releasing Everstats

Two sites, one repository (0.10.2):

| | Production | Dev (private test site) |
|---|---|---|
| Address | https://everstats.app | https://dev.everstats.app (behind Cloudflare Access: the owner and invited testers) |
| Branch | `main` | `dev` |
| Deploys | `.gitea/workflows/deploy.yml` on every push to `main` | `.gitea/workflows/deploy-dev.yml` on every push to `dev` |
| Stack | `docker-compose.yml`, project `everstats` | `docker-compose.dev.yml`, project `everstats-dev` |
| Data | production's own | its own, started empty; never a copy of production's |
| Blizzard / Discord | the production clients | "Everstats Dev" clients of its own |
| Changelog shows | releases and hotfixes | everything, dev builds marked "In testing" |
| Marker | none | a striped "DEV" bar on every page |

Feature branches and pull requests are built and tested by `.gitea/workflows/ci.yml` and never deployed. The GitHub
mirror copies every branch, as before.

Every command below is for **PowerShell on your PC** (no `&&`: one command per step), unless it says "the host" (a terminal on the server).

## The version rule

- Every build merged into `dev` is a **patch**, on dev only. Production on 0.10.2 → dev builds 0.10.3, 0.10.4, 0.10.5…
- Promoting `dev` → `main` is a **release**: the next **minor**. Those dev builds ship together as 0.11.0. The next round
  of dev builds is 0.11.1, 0.11.2…, released as 0.12.0, and so on. After 1.0 the same: 1.0.1, 1.0.2… released as 1.1.0
  (1.0.0 itself is the public launch, released the same way with `--version 1.0.0`).
- **Hotfixes** are the one exception: a patch straight to production (0.11.1 on `main`), merged back into `dev` so dev's
  next number carries on after it (0.11.2).

`CHANGELOG.json` says which is which with `"kind"`: `"dev"` (a dev build, "In testing"), `"release"` (made by the
release script, with the dev builds it rolled up kept under it in `"tested"`) or `"hotfix"`. Entries from before
0.10.2 have no kind. `scripts/check-changelog.js` enforces all of it: on `main` (`CHANGELOG_TARGET=production`) no dev
build may be left in and the newest entry must be a release or hotfix, so a promotion that skipped the release script
fails before production is touched. It runs in CI, in each deploy before the host is touched, and again in the image
build.

## Start a feature

1. `git checkout dev`
2. `git pull --ff-only origin dev`
3. `git checkout -b my-feature`
4. Work and commit. Add a dev build entry at the top of `CHANGELOG.json` with `"kind": "dev"`, dated the day you merge.
   Its number: `node scripts/release.js next` prints it (one patch above the newest entry). Write the lines for
   players, as always: they are rolled into the release later.
5. `git push -u origin my-feature` (CI builds and tests it; nothing is deployed)
6. When it's ready: `git checkout dev`
7. `git pull --ff-only origin dev`
8. `git merge --no-ff my-feature`
9. `git push origin dev`. Deploy dev runs: tests, then dev.everstats.app. Watch it in Gitea → Actions.
10. Check https://dev.everstats.app/api/health shows `"environment":"dev"` and the new version.

## Promote dev → main (a release)

When dev has been good for a while (usually a couple of builds):

1. `git checkout dev`
2. `git pull --ff-only origin dev`
3. `node scripts/release.js --dry-run` (shows the release entry it would make; changes nothing)
4. `node scripts/release.js` (add `--title "…"` for a better title). It writes the release entry (the next minor,
   dated today) and prints the remaining steps, one at a time. They are:
5. `git diff CHANGELOG.json`: read it, and edit any line that doesn't read well for players
6. `git add CHANGELOG.json`
7. `git commit -m "0.11.0: release"`
8. `git push origin dev`, then wait for Deploy dev to go green (dev runs the release build first)
9. `git checkout main`
10. `git pull --ff-only origin main`
11. `git merge --ff-only dev`. If git says it can't fast-forward, `main` has a hotfix `dev` doesn't have: merge `main`
    into `dev` first (see Hotfix, steps 9–13), then come back here.
12. `git push origin main`, then wait for Deploy to go green
13. Check https://everstats.app/api/health shows `"environment":"production"` and the release version
14. `git checkout dev`

## Hotfix

1. `git checkout main`
2. `git pull --ff-only origin main`
3. `git checkout -b hotfix-short-name`
4. Fix it. Add a `CHANGELOG.json` entry on top: `"kind": "hotfix"`, the next patch of production's newest version
   (production on 0.11.0 → 0.11.1), dated today.
5. `git push -u origin hotfix-short-name` (CI tests it)
6. `git checkout main`
7. `git merge --no-ff hotfix-short-name`
8. `git push origin main`, then wait for Deploy to go green
9. `git checkout dev`
10. `git pull --ff-only origin dev`
11. `git merge main`. If `CHANGELOG.json` conflicts, keep both: the hotfix entry stays where it is, and any dev build
    above it is renumbered after it (a dev 0.11.1 becomes 0.11.2). `node scripts/check-changelog.js` must pass.
12. `git push origin dev`, then wait for Deploy dev to go green
13. `git branch -d hotfix-short-name`

## Roll back

Both deploys build the new image BEFORE anything restarts, and keep the running one as `everstats:previous` /
`everstats-dev:previous`. A failed health check puts the previous image back automatically and the run stays red.
To roll back by hand, or to undo a release that passed its checks but is wrong:

**Production, the safe way (a new commit):**

1. `git checkout main`
2. `git pull --ff-only origin main`
3. `git revert --no-edit <commit>` (the merge of the release: `git revert -m 1 --no-edit <merge commit>`)
4. Add a hotfix entry to `CHANGELOG.json` saying what was undone (the next patch)
5. `git commit -am "0.11.1: undo …"`
6. `git push origin main`, then merge `main` back into `dev` as in Hotfix steps 9–12

**Production, at once, without a commit (the host's terminal, in production's deploy folder):**

1. `docker image tag everstats:previous everstats:local`
2. `docker compose up -d --no-build --force-recreate everstats everstats-worker`
3. `curl -s http://<BIND_IP>:3260/api/health`

This leaves the code on `main` as it was: the next push to `main` deploys it again, so follow up with the revert above.
The database keeps any migration the newer version ran (migrations only ever add). If a migration itself must be
undone, restore from a backup (RESTORE.md).

**Dev:** the same with dev's names: on the host, in dev's deploy folder, `docker image tag everstats-dev:previous everstats-dev:local`,
then `docker compose -p everstats-dev -f docker-compose.dev.yml up -d --no-build --force-recreate everstats-dev everstats-dev-worker`.
Or revert on `dev` and push. Dev's data is test data: starting it over empty is always allowed (RESTORE.md, "The dev
site").

## How the guards work (and their limits)

Dev and production share a host. What keeps dev away from production:

- **Separate everything:** project name, container names, image name, compose network (its own pinned /24, no default),
  host ports, deploy folder, database folders, backup folder, `.env`, root key, database user and name.
- **The app refuses to start** (`server/core/environment.js`) unless `ENVIRONMENT` is set and its address, database
  host, database name and database user are exactly its environment's. Dev given production's database URL stops before
  it connects.
- **The database remembers** whose it is (`environment_marker`): a process of the other environment refuses it before
  any migration runs, and a dev database with no marker must be empty. A production backup restored into dev is refused.
- **The dev deploy refuses** any dev folder that is, contains or sits inside one of production's (from production's
  Gitea variables AND what production's running containers mount; `/mnt/user/x` and `/mnt/cache/x` count as the same
  folder), dev ports equal to production's, dev's subnet equal to production's, a dev `.env` without
  `ENVIRONMENT=dev`, a dev checkout not on `dev`, and a dev `.env` that reuses production's root key, database
  password or Blizzard / Discord client id. **Production's deploy refuses** the mirror image: its folders against
  dev's, and an `.env` without `ENVIRONMENT=production`.
- **Resource caps** on every dev container (`docker-compose.dev.yml`), and capped test containers in CI.

What they can't do:

- **One Docker daemon and one root user.** Anyone (or anything) with a shell on the host, or the runner's Docker socket,
  can still reach both stacks. The guards stop mistakes in configuration, not a person deliberately working around them.
- **Keys entered on dev's admin page** are sealed in dev's database, where the deploy can't compare them with
  production's. If production's Blizzard client were pasted there, dev would spend production's request budget.
  Only the "Everstats Dev" client belongs there.
- **Building** the dev image (npm install, the client build, Chromium) runs in Docker's builder, which the caps don't
  cover: a dev deploy briefly uses more CPU than the dev containers may.
- **A rollback** puts the previous image back, not the previous database: a migration the failed version ran stays.
