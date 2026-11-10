# Backing up and restoring Everstats

## Two environments (0.10.2)

Everstats runs twice on the same host: **production** (everstats.app, `docker-compose.yml`, the `main` branch) and the
private **dev** site (dev.everstats.app, `docker-compose.dev.yml`, the `dev` branch; RELEASING.md). Each has its own
database, backup folder and `.env`, and each backs itself up the same way. Everything below is written for production;
for dev, change these and nothing else:

| | Production | Dev |
|---|---|---|
| Deploy folder (where you run the commands) | `DEPLOY_DIR` | `DEV_DEPLOY_DIR` |
| Backup folder on the host | `BACKUP_DIR` | `DEV_BACKUP_DIR` |
| Database folders | `PG_DATA_DIR`, `PG_SNAPSHOT_DIR` | `DEV_PG_DATA_DIR`, `DEV_PG_SNAPSHOT_DIR` |
| Containers | `everstats`, `everstats-worker`, `everstats-db` | `everstats-dev`, `everstats-dev-worker`, `everstats-dev-db` |
| Database user and name (`-U …`, `-d …`, `createdb`/`dropdb`) | `everstats` / `everstats` | `everstats_dev` / `everstats_dev` |
| Compose | `docker compose …` | `docker compose -p everstats-dev -f docker-compose.dev.yml …` |
| Health (host ports) | `:3260` web, `:3261` worker | `:3270` web, `:3271` worker (or `DEV_WEB_PORT` / `DEV_WORKER_PORT`) |
| Nightly dumps kept | the newest 14 plus the first of every month | the newest **3**, no monthly copies |

**Never restore one environment's dump into the other.** It can't work by design: every database remembers which
environment it belongs to (`environment_marker`, written on its first start), and a process of the other environment
refuses to start on it. A dev database with no marker must also be empty. So a production dump restored into dev's
database stops dev at start-up with "this database belongs to the production environment". Dev starts from an empty
database and fills from sign-ins, lookups and its own crawler; it never gets a copy of production's accounts or data.

Restoring a dump into its **own** environment works exactly as below (the marker comes back with it).

## Production

Every night after 04:00 UTC the worker container (`everstats-worker`) dumps **Everstats' own data** with `pg_dump`
into the host folder in the `BACKUP_DIR` Gitea variable (mounted at `/backups` in the container), as
`everstats-ours-YYYY-MM-DD.dump` (the UTC date, custom format). Each dump is read all the way through with `pg_restore`
before it is kept, and is refused if it holds any Blizzard data. If the worker was down at 04:00, the dump runs as soon
as it's back.

## What's in a backup, and what isn't (0.5.0)

**In it:** every table the retention registry (`server/retention/registry.js`) classifies as ours: accounts,
usernames and their history and holds, sign-in links, passkeys, 2FA secrets and recovery-code hashes, sessions, pins,
profile bios and social handles, settings, beta windows and membership, the admin's passkeys and history, backup and
sweep logs, request counts, reserved names. Plus a `backup_stubs` schema with the parts of three mixed tables that are
ours:

- **character stubs**: id, owner, owned since, hidden, tracked since, how it was found. No name, slug, level or anything
  else Blizzard returned.
- **statistic ids** and when each was first seen. No names.
- **Discovery decisions** (what you approved or rejected), with the reasoning text blanked (it quotes Blizzard names).

**Not in it:** anything Blizzard sent. Every Blizzard table is in the dump as an empty table (its schema only):
character profiles, statistics, gear, renders, snapshots, weekly and rolling baselines and gains, pinned-rank history,
guilds, rosters, guild totals, item icons, rulesets, statistic names, Discovery runs and their raw responses.

**Kept:** the newest 14 nightly dumps plus the first dump of every month, indefinitely (none of it is Blizzard data).
On the dev site: the newest 3, and no monthly copies (owner's decision, 0.10.2).
Dumps from before 0.5.0 (`everstats-YYYY-MM-DD.dump`, no `-ours`) **do** hold Blizzard data: they are still deleted 3
days after they were taken (by the hourly retention sweep and after every good backup).

**A dump holds account identities, session hashes, sealed API keys and 2FA secrets.** The keys and secrets are sealed
with `EVERSTATS_ROOT_KEY`, which is in `.env` and **not** in the dump: a restore needs the same root key, or those come
back as "Can't decrypt" (keys re-entered, 2FA re-enrolled). Keep the backup folder private.

## What a restore brings back, what refills, and what's lost

- **Back at once:** every account exactly as it was (usernames, display names, bios, socials, sign-in methods,
  passkeys, 2FA, sessions, so people stay signed in), pins, settings, beta membership, which characters each account
  owns and which are hidden, the featured character, admin passkeys, the admin history, Discovery decisions.
- **Refills from Blizzard:** characters come back as **stubs** (exactly what the 30-day sweep leaves of a character
  Blizzard stopped returning). A stub has no name, so the crawler can't refresh it on its own: it comes back in full when
  its owner signs in with Battle.net (or presses "Refresh my characters"), when someone looks it up, or when it turns
  up on the roster of a guild that one of those characters is in. From there the daily refresh and roster expansion
  rebuild everything else: statistics, gear, renders, guilds, guild totals, statistic names, rulesets.
  At the default budget (8 requests a second, background work held to 3 of the 4 crawl slots), a character's full fetch
  is 5 requests, a guild is 2: about **5,700 characters an hour** at the most once their names are known again. How
  long the whole refill takes depends on how fast owners sign in and look people up; it can't be measured in advance.
- **Lost for good:** all snapshot history (daily snapshots, weekly and rolling baselines, gains), so the weekly board
  and the "Last 29 days" board start collecting again from the restore (the restore resets the "snapshots began" date,
  so they honestly say "Collecting data" instead of ranking a shorter stretch); pinned-rank history (rank movement);
  untracked characters nobody looks up again; the crawl queue; Discovery runs and their raw responses.

How it's going: the admin page (Backups), the worker's health (`curl -s http://<BIND_IP>:3261/api/health`, the
`backup` part), and the log: `docker logs everstats-worker 2>&1 | grep '\[backup\]'`. A failure logs `[backup] FAILED`
and keeps every earlier dump.

All commands run on the host, from the deploy folder (where `docker-compose.yml` is). `$BACKUP_DIR` is the host
backup folder.

## Take a backup by hand

Before anything risky (a migration, a restore), and once after deploying 0.5.0 to prove backups work:

```bash
docker exec everstats-worker node server/tools/backup.js now
# [backup] everstats-ours-2026-11-12.dump: 112321 bytes, 31 tables with data, no Blizzard data, verified, 321 ms
docker exec everstats-worker node server/tools/backup.js list
```

It replaces today's file if the nightly one already ran.

## Check a backup restores (do this once now, and now and then)

This restores into a **scratch database** next to the real one and counts what came back. Nothing live is touched.
A restore runs in three parts, because the character stubs must be back before the constraints that point at them:

```bash
f=everstats-ours-2026-11-12.dump                      # the file to check
docker exec everstats-worker node server/tools/backup.js verify /backups/$f
docker exec everstats-db createdb -U everstats restore_check
# 1. tables and our data
docker exec -i everstats-db pg_restore -U everstats -d restore_check --no-owner --exit-on-error --section=pre-data --section=data < "$BACKUP_DIR/$f"
# 2. the character stubs, statistic ids and decisions
docker exec everstats-db psql -U everstats -d restore_check -c "SELECT backup_stubs.restore();"
# 3. indexes, constraints and triggers
docker exec -i everstats-db pg_restore -U everstats -d restore_check --no-owner --exit-on-error --section=post-data < "$BACKUP_DIR/$f"
docker exec everstats-db psql -U everstats -d restore_check -c "DROP SCHEMA backup_stubs CASCADE;"
# the counts
docker exec everstats-db psql -U everstats -d restore_check -c \
  "SELECT (SELECT count(*) FROM _migrations) AS migrations, (SELECT count(*) FROM accounts) AS accounts,
          (SELECT count(*) FROM characters) AS character_stubs, (SELECT count(*) FROM characters WHERE name IS NOT NULL) AS with_blizzard_names,
          (SELECT count(*) FROM character_statistics) AS statistic_values, (SELECT count(*) FROM guilds) AS guilds;"
docker exec everstats-db dropdb -U everstats restore_check
```

Run the same `SELECT` against `-d everstats` to compare: migrations, accounts and character stubs match the live
numbers (characters = every character row, live); `with_blizzard_names`, `statistic_values` and `guilds` are **0** in
the scratch copy. Anything that errors means: don't rely on that file; try the day before, and look at the backup log.

## Restore the live database

**Restoring puts Everstats' own data back to the moment of that dump and starts Blizzard's data from empty.** Accounts,
settings, pins and the like made since are lost; game data, history and guild totals refill as described above.

1. Take a backup of the current state first (above), so the restore can be undone.
2. Stop the two app containers (the database keeps running):
   ```bash
   docker compose stop everstats everstats-worker
   ```
3. Replace the database with an empty one, then restore into it in the three parts:
   ```bash
   f=everstats-ours-2026-11-12.dump
   docker exec everstats-db dropdb -U everstats everstats
   docker exec everstats-db createdb -U everstats everstats
   docker exec -i everstats-db pg_restore -U everstats -d everstats --no-owner --exit-on-error --section=pre-data --section=data < "$BACKUP_DIR/$f"
   docker exec everstats-db psql -U everstats -d everstats -c "SELECT backup_stubs.restore();"
   docker exec -i everstats-db pg_restore -U everstats -d everstats --no-owner --exit-on-error --section=post-data < "$BACKUP_DIR/$f"
   docker exec everstats-db psql -U everstats -d everstats -c "DROP SCHEMA backup_stubs CASCADE;"
   ```
   Snapshot tables come back (empty) in the `snapshots` tablespace, which already exists in this database container.
4. Start them again and check:
   ```bash
   docker compose up -d
   docker logs --tail 20 everstats
   curl -s "http://$BIND_IP:3260/api/health"
   ```
5. Sign in with Battle.net (your characters come back first), open the admin page, and watch the crawler fill in.

To undo: restore the backup you took in step 1 the same way.

## If the database container itself is lost

Recreate the folders (`PG_DATA_DIR`, `PG_SNAPSHOT_DIR`, owned by 999:999), deploy (the containers start on an empty
database and migrate it), then stop the two app containers and restore as above.

On **production** the containers then start on an empty database marked `production`: drop and recreate it as in step 3
before restoring (the steps above already do), so the dump's own marker comes back with it.

## The dev site

Same steps with the dev names from the table at the top, run from dev's deploy folder. Two differences:

- Dev's data is test data. Usually the quickest fix for a broken dev database is to **start it over empty**: stop dev,
  empty `DEV_PG_DATA_DIR` and `DEV_PG_SNAPSHOT_DIR` (keep the folders, owned by 999:999), and run the Deploy dev workflow
  again (Gitea → Actions → Deploy dev → Run workflow). Testers sign in again and add their passkeys again; the admin
  enrols a passkey on dev again (RELEASING.md).
- The dev root key (`EVERSTATS_ROOT_KEY` in dev's `.env`) is dev's own: a dev dump needs dev's `.env`, never
  production's.

## How this was tested

`server/test/backup.test.js` covers the logic with a stand-in for `pg_dump`: naming, the 14-nightly-plus-monthly rule
and the 3-day rule for old dumps, that every Blizzard table's data is left out, that a dump showing any Blizzard table
data is refused, that the password goes in the environment and never on a command line, the lock, the recorded status,
that the nightly job doesn't stall the worker's heartbeat, and `backup_stubs.restore()` itself against Postgres.

0.5.0 was also proved end to end with the real `pg_dump` / `pg_restore` 17.10 on a scratch Postgres 17 cluster filled
with synthetic data: a backup taken by `recordedBackup`, then restored into a scratch database with exactly the steps
above. That proof found that the stub restore could not use `ON CONFLICT` (no primary keys exist before post-data),
which is fixed. **It has not yet been run against the production database**: the first hand backup and the
scratch-database check above, on Tower, are that test.
