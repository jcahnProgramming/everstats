# Backing up and restoring Everstats

Every night after 04:00 UTC the worker container (`everstats-worker`) dumps the database with `pg_dump` into the host
folder in the `BACKUP_DIR` Gitea variable (mounted at `/backups` in the container), as `everstats-YYYY-MM-DD.dump`
(the UTC date, custom format). Each dump is read all the way through with `pg_restore` before it is kept: one that
can't be read is deleted and the failure is recorded. If the worker was down at 04:00, the dump runs as soon as it's back.

**Each dump is deleted 3 days after it was taken** (measured in hours, by the hourly retention sweep and after every good
backup). There are no monthly copies. A dump holds Blizzard's game data as it was that night, and Blizzard's API terms
allow keeping that data at most 30 days: the database keeps 26 days, a dump at most 3 more, and 1 day is slack
(server/retention/policy.js). So **the oldest restore point is about 3 days old**. If backups fail for more than 3 days
in a row, the old ones are still deleted on time and there is no restore point until a backup succeeds again: the admin
page and the worker's health say so.

After a restore, Blizzard data in it may be up to 3 days older than when the dump was taken; the hourly sweep deletes
anything past the window within the hour, and the daily refresh fetches every character again.

How it's going: the admin page (Backups), the worker's health (`curl -s http://<BIND_IP>:3261/api/health`, the
`backup` part), and the log: `docker logs everstats-worker 2>&1 | grep '\[backup\]'`. A failure logs `[backup] FAILED`
and keeps every earlier dump.

**A dump holds everything in the database**: accounts, linked logins, session hashes, sealed API keys and 2FA secrets.
The keys and secrets are sealed with `EVERSTATS_ROOT_KEY`, which is in `.env` and **not** in the dump: a restore needs
the same root key, or those come back as "Can't decrypt" (keys re-entered, 2FA re-enrolled). Keep the backup folder
private.

All commands run on the host, from the deploy folder (where `docker-compose.yml` is). `$BACKUP_DIR` is the host
backup folder.

## Take a backup by hand

Before anything risky (a migration, a restore), and once after the first deploy to prove backups work:

```bash
docker exec everstats-worker node server/tools/backup.js now
# [backup] everstats-2026-11-09.dump: 81234 bytes, verified, 412 ms
docker exec everstats-worker node server/tools/backup.js list
ls -l "$BACKUP_DIR"/
```

It replaces today's file if the nightly one already ran.

## Check a backup restores (do this once now, and now and then)

This restores into a **scratch database** next to the real one and counts what came back. Nothing live is touched.

```bash
f=everstats-2026-11-09.dump                      # the file to check
docker exec everstats-worker node server/tools/backup.js verify /backups/$f
docker exec everstats-db createdb -U everstats restore_check
docker exec -i everstats-db pg_restore -U everstats -d restore_check --no-owner --exit-on-error < "$BACKUP_DIR/$f"
docker exec everstats-db psql -U everstats -d restore_check -c \
  "SELECT (SELECT count(*) FROM _migrations) AS migrations, (SELECT count(*) FROM accounts) AS accounts;"
docker exec everstats-db dropdb -U everstats restore_check
```

The counts should match what the live site has (`-d everstats` instead of `-d restore_check` in the `psql` line).
Anything that errors means: don't rely on that file; try the day before, and look at the backup log.

## Restore the live database

**Restoring puts the whole site back to the moment of that dump.** Accounts, linked logins, passkeys, settings and
every statistic and snapshot recorded since are lost.

1. Take a backup of the current state first (above), so the restore can be undone.
2. Stop the two app containers (the database keeps running):
   ```bash
   docker compose stop everstats everstats-worker
   ```
3. Replace the database's contents with the dump:
   ```bash
   f=everstats-2026-11-09.dump
   docker exec -i everstats-db pg_restore -U everstats -d everstats --clean --if-exists --no-owner --exit-on-error < "$BACKUP_DIR/$f"
   ```
   Snapshot tables come back in the `snapshots` tablespace, which already exists in this database container.
4. Start them again and check:
   ```bash
   docker compose up -d
   docker logs --tail 20 everstats
   curl -s "http://$BIND_IP:3260/api/health"
   ```
5. Sign in, open the admin page, and check a few characters you know.

To undo: restore the backup you took in step 1 the same way.

## If the database container itself is lost

Recreate the folders (`PG_DATA_DIR`, `PG_SNAPSHOT_DIR`, owned by 999:999), deploy (the containers start on an empty
database and migrate it), then stop the two app containers and restore as above.

## How this was tested

`server/test/backup.test.js` covers the logic with a stand-in for `pg_dump`: naming, the 3-day retention,
that the password goes in the environment and never on a command line, that a failed or unreadable dump leaves no file
and keeps every earlier one, the lock, the recorded status, and that the nightly job doesn't stall the worker's
heartbeat. **The real `pg_dump` / `pg_restore` commands and this restore procedure have not yet been run against the
production database**: the first hand backup and the scratch-database check above are that test.
