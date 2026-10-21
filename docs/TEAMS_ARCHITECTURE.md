# Hengam Teams — Architecture

Hengam Teams is the employee-facing companion to Hengam: schedules, a per-business shift marketplace, swaps, availability and time off, on iOS, Android and the web. It works for businesses that schedule in Hengam and for businesses that never touch it. For Hengam itself, see [ARCHITECTURE.md](ARCHITECTURE.md).

## Decisions

| Question | Decision | Why |
|---|---|---|
| Backend | Same Firebase project as Hengam; workflows on Vercel functions under `api/teams/*` | One identity across both products. One Firestore means a transaction can update Hengam's schedule and Teams' shifts together, which removes most of the sync problem. Vercel is already the backend runtime, so no Cloud Functions. |
| Writes | Clients never write business data. The server validates and writes inside a transaction with the Admin SDK. | Claims, swaps and approvals need invariants rules cannot express (no double claim, both sides of a swap or neither). Rules decide only who may read. |
| Tenancy | Everything a business owns lives under `businesses/{bizId}/…`, gated on a membership doc | A forgotten filter in one query cannot reach another business. |
| Time | Shifts store UTC instants plus the business's IANA timezone | Survives DST and makes cross-workplace clash checks possible. Hengam's `26:00` overnight notation is converted once, at sync. |
| Mobile | Expo (React Native) with expo-router and React Native Web, in `teams/` | Native push and App Store / Play distribution. Web output is the same codebase. Hengam's DOM UI was not reusable in React Native either way. |
| Repo | Hengam stays at the root, untouched. `teams/` is the app, `shared/` the code both sides use. | No churn for working Hengam code. |
| Pricing | Standalone Teams is free for now | Paywall hooks can come later; nothing in the model depends on plan. |

## Data model

Collection names and status machines are code in [`shared/teams/schema.js`](../shared/teams/schema.js). The rules and the server read them from there, or match them by name.

```
businesses/{bizId}                     name, mode: hengam|standalone, timezone, hengamOwnerUid?, createdAt
  members/{uid}                        role: owner|manager|employee, status: active|removed, staffId, joinedAt
  staff/{staffId}                      name, uid?, positionIds[], locationIds[]   (team-readable roster)
  staffPrivate/{staffId}               uid?, email, phone, notes                    (managers + that person)
  locations/{id}                       name, address?, timezone?
  positions/{id}                       name, color
  settings/policies                    see DEFAULT_POLICIES
  schedules/{id}                       weekStart, status: draft|published|archived, source, sourceRef?, sourceHash?, version
  shifts/{shiftId}                     scheduleId, staffId, assigneeUid?, startAt, endAt, positionId?, locationId?,
                                       published, status: scheduled|cancelled, version, origin
  offers/{id}                          shiftId, offeredByUid, status, requiresApproval, shift snapshot, expiresAt
    claims/{claimantUid}               status, eligibility result, createdAt
  swaps/{id}                           requesterUid, counterpartyUid, shiftA, shiftB, versionA, versionB, status
  availability/{staffId}              uid?, weekly windows, preferences, effectiveFrom
    overrides/{id}                     uid?, from, to, windows | unavailable
  timeOff/{id}                         uid, staffId, category, startDate, endDate, partial times?, reason?,
                                       status, managerNote?, decidedBy?, decidedAt?
  imports/{id}                         source, status, extracted rows with per-field confidence, review edits
  auditLog/{id}                        actorUid, action, before, after, at            (append-only)
  sync/{id}                            Hengam sync cursor, last hash, failures, retry state

users/{uid}                            existing Hengam profile, unchanged
  workplaces/{bizId}                   name, role: mirror of membership for the switcher (server-written)
  notifications/{dedupeKey}            type, bizId, payload, createdAt, readAt?
  devices/{id}                         platform, token, createdAt, updatedAt
userBusy/{uid}/blocks/{shiftId}        startAt, endAt only, server-only (cross-workplace clashes)
calendarFeeds/{token}                  uid, server-only (calendar subscription URL secret)
```

Three properties are built into the layout rather than checked:

- **One claim per person per offer.** The claim's document id is the claimant's uid.
- **One notification per event.** The notification's document id is a dedupe key derived from the event, so a retried delivery overwrites instead of duplicating.
- **A shift stays with its owner until a transfer completes.** Offers and swaps are separate documents; only the approving transaction rewrites `assigneeUid`, `staffId` and `version` on the shift.

### Shifts are versioned

Every shift carries `version`. A claim or swap records the version it was made against. The approving transaction re-reads the shift, refuses if the version moved, re-runs validation, then writes the new assignee and bumps the version. Two concurrent approvals cannot both win.

### Status machines

`TRANSITIONS` in `schema.js` lists every legal move for schedules, shifts, offers, claims, swaps, time off and imports. Server writes go through `canTransition` in the same transaction that reads the current status. Unit tests check that every status is reachable, final statuses cannot be left, and an import cannot skip review.

## Who can read what

Enforced by [`firestore.rules`](../firestore.rules) and tested against the emulator in [`tests/rules/`](../tests/rules).

| Data | Employee | Manager / owner | Anyone else |
|---|---|---|---|
| Business, staff roster, positions, locations, policies | read | read | — |
| Members | own only | all | — |
| `staffPrivate` | own only | all | — |
| Schedules | published | all | — |
| Shifts | own published; coworkers' published only if `employeeFullView` | all | — |
| Offers | all in the business | all | — |
| Claims | own, or on own offers | all | — |
| Swaps | where a party | all | — |
| Availability, time off | own | all | — |
| Imports, audit log, sync | — | read | — |
| Any write under `businesses/` | **never** | **never** (server only) | — |

A removed member (`status: removed`) loses every read immediately. Someone who works at two businesses reads each only through that business's membership.

## Hengam integration

| Data | Owner | Flow |
|---|---|---|
| Roster, positions, settings (Hengam businesses) | Hengam | Projected to Teams on publish |
| Draft schedules | Hengam | Never leave Hengam |
| Published assignments | Hengam schedule + Teams shifts, changed together | Publish projects to Teams. Approved swaps and pickups write both in one transaction. |
| Availability, time off | Teams | Hengam's scheduler reads Teams collections through an adapter |

- **Idempotent.** Shift ids for synced schedules are derived from the Hengam schedule, employee and slot, so replaying a sync rewrites the same documents.
- **No loops.** Every write records its origin and source hash. Projection skips unchanged input and never writes back out.
- **Failure.** A failed sync marks the schedule `syncStatus: pending`, a Vercel Cron job retries from the `sync` state, and the manager sees a banner.
- **Republish over open requests.** Offers and swaps whose shift changed are cancelled with a notification saying why.
- **Hengam changes needed (Phase 8).** Stable shift ids and `employeeId` in scheduler output (today shifts name the employee by name), an explicit draft/published state, and a "Publish to team" action that calls the sync endpoint.

## Roadmap

| Phase | Scope | Status |
|---|---|---|
| 1–2 | Inspect Hengam, architecture | Done |
| — | Fix reusable invites, lost employee availability, full-view leak in Hengam | Done |
| 3 | Schema, rules, rules tests | Done |
| 4 | Expo scaffold, sign-in (email, Google, Apple), workspaces, single-use invites, workplace switcher | Next |
| 5 | Home, calendar (day, week, month), upcoming shifts, themes, skeletons, empty states | |
| 6 | Validation engine, marketplace, swaps, approvals, audit log | |
| 7 | Availability and time off | |
| 8 | Hengam sync | |
| 9 | Notifications, push, reminders, calendar feed and export | |
| 9b | Standalone imports: manual, CSV, Excel, PDF and image via Claude with mandatory review | |
| 10 | Performance, accessibility, monitoring, store submission | |

## Risks

- **Vercel Hobby allows 12 functions.** `api/teams/*` is one router function, not one file per endpoint.
- **Firebase Storage needs the Blaze plan.** Imports are processed in the request and discarded, within Vercel's 4.5 MB request body limit; larger files would need direct Blob uploads.
- **Imported names are ambiguous.** Matches to the roster are suggestions on the review screen, never applied silently.
- **Labor rules are per business.** The app does not know local law and says so where limits are configured.
- **Existing employee accounts.** Accounts linked to Hengam through `managerId` move to memberships with an idempotent migration script.

## Running the rules tests

The Firestore emulator needs Java 21:

```bash
JAVA_HOME=/opt/homebrew/opt/openjdk@21 PATH="/opt/homebrew/opt/openjdk@21/bin:$PATH" npm run test:rules
```

It runs against the `demo-hengam` project id, so nothing touches the real database.
