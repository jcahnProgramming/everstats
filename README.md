# Everstats

WoW Forever character statistics, per-statistic leaderboards and letter tiers. US region. Not affiliated with
Blizzard Entertainment.

Status: scaffold (0.1.0). Every page exists; lookups, leaderboards and tiers are not built yet. `CLAUDE.md` is the
project constitution; `CHANGELOG.json` is what changed.

## Run it locally

```sh
npm install
npm run gen-key root        # prints EVERSTATS_ROOT_KEY=…; put it in .env by hand
npm run dev                 # dev database, web, worker, and the site on http://localhost:3000
npm test
```

No Postgres or Docker needed locally: `npm run dev` starts an embedded one (data in `data/dev-pglite`).

## Deploy

Push to `main`; `.gitea/workflows/deploy.yml` rebuilds the stack on the server (`docker-compose.yml`: Postgres, web
on 3260, worker on 3261). See `CLAUDE.md` → Deploy and `.env.example`.
