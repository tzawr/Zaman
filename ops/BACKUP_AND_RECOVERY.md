# Backup and recovery

What protects HENGAM's data, how to get it back, and how that has been tested.

## What is critical, and where it lives

| Data | Where | Covered by Firestore backups? | How it is protected |
|---|---|---|---|
| Workspaces, employees, schedules, availability, Teams workplaces/shifts, invites, usage and limits | Firestore `(default)`, project `zaman-ba689`, `us-west1` | Yes | PITR + scheduled backups (managed); logical dumps (`ops/backup/`) |
| User accounts (uid, email, verification, providers, password hashes) | Firebase Authentication | **No** | `firebase auth:export` (encrypted, off-site) + the project's password-hash parameters |
| Security Rules and indexes | Git (`firestore.rules`, `firestore.indexes.json`) | Rules **no**; index definitions yes | Git; redeploy with the Firebase CLI |
| Code and config | Git, Vercel | n/a | Git; Vercel keeps previous deployments (instant rollback) |
| Secrets (Firebase admin key, Anthropic key, CRON/OPS tokens) | Vercel environment variables | n/a | Password manager; rotate after any incident |
| TTL policies | Firestore config | No | None in use today |

Firebase Storage isn't used.

## Options (Firestore Standard edition)

All of these need billing enabled. Production already has it, so turning them on is a
setting, not a plan change.

| Option | What you get | Restores into | Limits |
|---|---|---|---|
| **Point-in-time recovery (PITR)** | Every minute of the last **7 days** | A **new** database (clone, or export at a timestamp then import), or stale reads of chosen documents to copy back | Whole-minute timestamps; not before `earliestVersionTime`. Without PITR, only the last hour. |
| **Scheduled backups** | Daily and/or weekly copies, retained up to **14 weeks** | A **new** database (`firestore:databases:restore`) | One daily and one weekly schedule per database; time of day not selectable; same location as source. Rules and TTL not included. |
| **Clone** | Copy at any minute inside the version window | A **new** database | 1 h window without PITR, 7 days with |
| **Logical dump** (`ops/backup/dump.mjs`) | Exact typed copy as files | Any isolated project or the emulator (`load.mjs`) | Takes time proportional to document count; holds customer data in files |

None of these can overwrite a live database. Getting good data back into `(default)` is
a separate, deliberate step (`copy-back.mjs`, below).

## Recommended setup (needs approval: changes production settings)

```bash
firebase firestore:databases:update "(default)" --point-in-time-recovery ENABLED --project zaman-ba689
```
```bash
firebase firestore:backups:schedules:create --database "(default)" --recurrence DAILY --retention 14d --project zaman-ba689
```
```bash
firebase firestore:backups:schedules:create --database "(default)" --recurrence WEEKLY --day-of-week SUNDAY --retention 98d --project zaman-ba689
```

Plus, outside Firestore:

- Weekly, and before any risky change: `firebase auth:export auth-<date>.json --format=json --project zaman-ba689`.
  Encrypt it (`age`/`gpg`) and store it off-site. It contains password hashes.
- Once: copy the **password hash parameters** (Console → Authentication → Users → ⋮ →
  Password hash parameters) into the password manager. Without them, restored accounts
  must reset their password or sign in with Google.
- Delete protection is **on** for `(default)` (enabled 2026-11-11).

### What it costs (Standard edition; prices from Google's pricing pages, 2026-11, verify before relying)

| Item | Unit price | Today (< 0.01 GiB) | Pilot year 1 (≤ 0.3 GiB, generous) |
|---|---|---|---|
| PITR | ~$0.15 / GiB-month of database size | < $0.01 | ~$0.05 |
| Daily backups, 14 kept | ~$0.03 / GiB-month per backup | < $0.01 | ~$0.13 |
| Weekly backups, 14 kept | same | < $0.01 | ~$0.13 |
| Monthly restore drill | ~$0.20 / GiB restored + reads to compare | < $0.01 | ~$0.07 |
| **Total** | | **cents** | **≈ $0.40 / month** |

Size today: about 250 documents. For comparison, staging's 2,113 documents are 1.1 MiB
as a logical dump. Backups don't affect live performance.

## Restoring without touching production

Every path below writes only to a **new or isolated** database. A new database in the
production project has no Security Rules deployed, so browsers can't reach it; only admin
credentials can.

**A. Managed (the normal path).** Restore a backup, or clone at a minute, into a new database:
```bash
firebase firestore:backups:list --project zaman-ba689
```
```bash
firebase firestore:databases:restore --backup <backup name> --database restore-<date> --project zaman-ba689
```
```bash
firebase firestore:databases:clone "projects/zaman-ba689/databases/(default)" "projects/zaman-ba689/databases/restore-<date>" --snapshot-time 2026-11-20T14:05:00Z --project zaman-ba689
```
Then verify the copy document by document against production **as of the snapshot time**:
```bash
node ops/backup/compare.mjs --expected project:zaman-ba689 --expected-read-time <snapshot> --actual project:zaman-ba689/restore-<date> --allow-production-read
```

**B. Into a separate project** (for investigation away from production, e.g. staging):
```bash
node ops/backup/dump.mjs --from project:zaman-ba689/restore-<date> --allow-production-read --out backups/inc-<id>
```
```bash
node ops/backup/load.mjs --dump backups/inc-<id> --into project:<isolated-project>/<new-db> --credentials <isolated sa.json>
```
```bash
node ops/backup/auth-restore.mjs --export auth-<date>.json --into project:<isolated-project> --credentials <sa> --hash-config hash.json
```
`load.mjs` and `auth-restore.mjs` refuse the production project outright, and `load.mjs`
refuses a non-empty target.

**C. Back into production, deliberately.** Only after a verified copy exists:
```bash
node ops/backup/copy-back.mjs --from project:zaman-ba689/restore-<date> --to project:zaman-ba689 --paths <collections or docs> --allow-production-read
```
That's a dry run, showing creates, overwrites and unchanged. Then, if approved:
```bash
node ops/backup/copy-back.mjs ... --apply --incident INC-<n> --confirm-target project:zaman-ba689
```
Copy-back writes only the listed paths, never deletes, saves the target's prior versions
to `backups/pre-copyback-<incident>-<time>/` first (an undo point), and verifies afterwards.

## Tested so far

| Test | Where | Result |
|---|---|---|
| `npm run test:backup`: dump → restore into an empty isolated DB → compare; typed values (int vs double, µs timestamps, bytes, geopoint, null, references re-pointed); subcollection-only parents; tamper detection; copy-back dry run, apply and undo point; every production refusal | Emulator | 8/8 pass |
| Real-infrastructure restore: 2,113 staging documents dumped and restored into an isolated DB, compared with the backup and with live staging | Staging → emulator | Exact match, 2,113/2,113 |
| Auth restore: 122 staging accounts exported and imported into an isolated Auth, uid/email/verification checked | Staging → emulator | 122/122 (passwords need the hash parameters) |
| Point-in-time compare (`--expected-read-time`) | Staging | See the readiness record |
| **Production clone drill**: `(default)` @ 2026-11-11T07:39:00Z → `drill-20261111-0739`; clone 10 min 24 s; compared at the snapshot | Production | **PASS: 248/248 documents identical, 0 mismatches; value-type histograms identical (41,683 values)** |
| Restore from a scheduled backup | Production | Not run yet: first backups not taken at drill time |

## Disaster recovery plan

**Objectives for the pilot.** Recovery point (RPO): **1 minute** with PITR (24 h with daily
backups alone). Recovery time (RTO): **under 2 hours** for a partial restore, half a day for
a full one.

| Scenario | Detect | Recover |
|---|---|---|
| A manager deletes or breaks their own data | Support request | PITR clone at the minute before → copy-back of that manager's paths only |
| A bad release corrupts data | Ops status errors; support | Roll back the code (Vercel). Clone at the minute before the release. Compare. Copy back the affected paths. |
| Rules or code change exposes or blocks data | Ops status, rules checks | Fix the rules forward (see release checklist). Data is unaffected. |
| Database deleted | Everything fails; ops status critical | Delete protection prevents this by accident. Otherwise restore the latest backup into a new database and repoint, or copy everything back into a recreated `(default)`. |
| Region outage | Google status page; ops status | Wait (regional database). Backups are in the same region. |
| Auth accounts lost or corrupted | Sign-in failures (`auth_issues`) | `auth-restore.mjs` from the latest export into the project, plus hash parameters |
| Credential leak (admin key, Anthropic key) | Unexpected writes or spend (ops status) | Rotate in Google Cloud / Anthropic, update Vercel env, redeploy, review audit logs |

### Recovery checklist

1. **Declare.** Open an incident id (INC-n). Note the time the problem started, to the minute.
2. **Stop the bleeding.** Roll back the code if a release caused it. Pause anything that
   keeps writing bad data.
3. **Preserve.** Don't delete anything. Note `earliestVersionTime` (PITR window) and the
   latest backup:
   ```bash
   firebase firestore:databases:get "(default)" --project zaman-ba689
   ```
   ```bash
   firebase firestore:backups:list --project zaman-ba689
   ```
4. **Restore into a new database** (path A), at the minute before the problem.
5. **Verify** the copy with `compare.mjs`, and inspect the affected documents in it.
6. **Plan the copy-back:** run `copy-back.mjs` dry, with the narrowest `--paths`. Get a
   second person to review the counts.
7. **Apply** with `--incident` and `--confirm-target`. Keep the printed undo-point path.
8. **Check** with ops status, the affected managers' views, and `compare.mjs` on the paths.
9. **Clean up:** delete the temporary database. A clone **inherits delete protection**,
   so switch it off on the temporary database first; never on `(default)`:
   ```bash
   firebase firestore:databases:update restore-<date> --delete-protection DISABLED --project zaman-ba689
   ```
   ```bash
   firebase firestore:databases:delete restore-<date> --force --project zaman-ba689
   ```
   Securely delete local dumps once the incident is closed.
10. **Write up:** cause, timeline, data affected, and what changes.

**Drill monthly** (`node ops/backup/production-drill.mjs --run`, with approval) and after
any change to the backup setup.
