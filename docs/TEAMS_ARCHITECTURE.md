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
| 4 | Expo scaffold, sign-in (email, Google, Apple), workspaces, single-use invites, workplace switcher | Done |
| 5 | Home, calendar (day, week, month), upcoming shifts, manual scheduling and publishing | Done |
| 6 | Validation engine, marketplace, swaps, approvals, audit log | Done |
| 7 | Availability and time off | Next |
| 8 | Hengam sync | |
| 9 | Notifications, push, reminders, calendar feed and export | |
| 9b | Standalone imports: manual, CSV, Excel, PDF and image via Claude with mandatory review | |
| 10 | Performance, accessibility, monitoring, store submission | |

## Workspaces and invites (Phase 4)

All Teams writes go through one function, `api/teams/[action].js`, which verifies the caller, rate-limits by action, and runs a workflow from `api/_teams-workspaces.js` inside a Firestore transaction. The rules each workflow enforces are in `shared/teams/workspace.js`, which the app also uses to decide which controls to show.

| Action | Who | Notes |
|---|---|---|
| `createBusiness` | Any signed-in, email-verified account | Idempotent per `requestId`. Creates the business, owner membership, roster entry, default policies and the workplace mirror together. |
| `createInvite` | Managers (employees); owners (managers, owners) | Adds a roster entry, or reuses one with no account. Returns a 10-character code, valid once for 14 days. |
| `previewInvite` | Anyone, before sign-in | Rate-limited by IP: 30 per 15 minutes. Codes are 50 bits. |
| `acceptInvite` | Signed in | One transaction: membership, roster link, invite closed. Accepting twice is a no-op; a second person is refused. |
| `revokeInvite`, `updateMemberRole`, `removeMember`, `leaveBusiness` | Per `shared/teams/workspace.js` | A workspace always keeps at least one owner. Removal keeps the roster entry so past shifts keep their name. |

Invite codes are stored in two places. The manager-readable invite document keeps the code so it can be shared again. `inviteCodes/{sha256}` is server-only and maps the code to its invite, so redeeming a code is one direct read.

Deleting an account (`api/delete-account.js`) now leaves every workspace first. It refuses while the account is the only owner of a workspace that has other people in it, and deletes workspaces nobody else is in.

## Schedules and shifts (Phase 5)

A standalone business builds its schedule in Teams one shift at a time; Hengam businesses will get theirs from sync in Phase 8. One schedule document per week, keyed by its Monday (`schedules/2026-10-19`), holds the week's status. Each shift is its own document.

| Action | Notes |
|---|---|
| `saveShift` | Create or edit. Refuses an overlap with the same person's other live shifts, including overnight ones, and an edit made against a version someone else has since changed. Opens the week as a draft if it is new. |
| `deleteShift` | A draft shift is deleted; a published one is cancelled, so the person working it can be told. |
| `publishSchedule` | Publishes every live shift in the week in one transaction. Publishing twice is harmless. After publishing, saves go live immediately. |

A shift stores the business-local date and times people read (`date`, `startLocal`, `endLocal`, `overnight`) and the UTC instants arithmetic uses (`startAt`, `endAt`, `minutes`). `shared/teams/time.js` converts between them with `Intl`, tested across both daylight-saving transitions: an overnight shift over the fall change is nine hours, over the spring change seven.

`assigneeUid` is set when the roster entry has an account, and filled in for every existing shift when its person joins, so shifts scheduled before someone accepted their invite appear for them.

Employees read their own published shifts from every workplace with one query per workplace, merged and coloured by workplace on Home and Calendar. The queries need the composite indexes in `firestore.indexes.json`, which also keeps Hengam's two existing indexes so a deploy does not drop them.

## Marketplace and swaps (Phase 6)

### Validation

`shared/teams/validation.js` decides whether a person can take a shift: it has not started and is outside the business's cut-off, no overlap with their other shifts here or at any other workplace, the business's minimum rest between shifts, daily and weekly hour limits, and position or location where both the shift and the person name one. It is pure; the server gathers the facts and calls it when a request is made and again inside the transaction that approves it, so a week that filled up in between is caught.

Problems are worded for whoever reads them. The person asking hears "You have a shift at another workplace at the same time"; their manager hears only "Ana has another commitment at that time".

### Cross-workplace conflicts

`userBusy/{uid}/blocks/{bizId}_{shiftId}` holds the start and end of every published, live shift a person works, anywhere. Rules deny it to every client. It is written in the same transaction as every change that affects it: saving, removing or publishing a shift, an approved transfer, someone joining (their existing shifts), and someone leaving or being removed.

### Workflows

| Action | Who | What happens |
|---|---|---|
| `offerShift` | The shift's assignee | Opens an offer and marks the shift with it. Offering twice returns the same offer. |
| `claimOffer` | Any other member | Validated. With approval required, a pending claim (document id = claimant, so no duplicates). Without, the first eligible claimant gets the shift in that transaction. |
| `decideClaim` | Manager | Re-validates, moves the shift, closes the other claims. Rejecting the last claim puts the offer back on the market. |
| `previewClaim` | Member; manager for anyone | The same check without acting, so the app shows the answer before anyone taps. |
| `requestSwap` | Assignee of shift A | Validates both directions and locks both shifts against offers and other swaps. |
| `respondSwap` | Assignee of shift B | Declining frees both. Accepting completes the swap, or waits for a manager if the business requires it. |
| `decideSwap` | Manager | Re-validates both directions and moves both shifts in one transaction. |
| `cancelOffer`, `withdrawClaim`, `cancelSwap`, `listSwapCandidates` | | |

Every offer and swap records the version of each shift it was made against. Any change to the shift (a manager editing it, a transfer) moves the version on and closes its open offer or swap in the same transaction, so nothing is ever approved against a shift that no longer exists as it was. The emulator tests cover three claimants racing for one instant pickup, a swap whose second shift is edited after both people agreed (neither side moves), and limits reached between asking and approval.

### Navigation

Five tabs at most. Everyone: Home, Calendar, Marketplace, Requests. Employees then have Profile; managers have Manage (Schedule and Team) and reach Profile from the avatar in the header. The Requests tab badge counts swaps waiting on the person and, for managers, everything awaiting approval.

Offers carry `claimantUids` so the app can show who has asked without a collection-group query. Every member of the business can read it; who asked for a shift is visible to coworkers.

## Running Teams locally

Everything runs against the Firebase emulators under the `demo-hengam` project, so nothing touches production.

```bash
JAVA_HOME=/opt/homebrew/opt/openjdk@21 PATH="/opt/homebrew/opt/openjdk@21/bin:$PATH" npm run dev:emulators
npm run dev:api
cd teams && npx expo start --web
```

`npm run dev:seed` fills the emulators with two workplaces, a manager, and an employee who works at both, with last week and this week published and next week in draft. The test accounts are listed at the top of `scripts/seed-teams-dev.js`.

`teams/.env.example` lists the app's settings. For the emulators, `EXPO_PUBLIC_FIREBASE_PROJECT_ID=demo-hengam` and `EXPO_PUBLIC_USE_EMULATORS=1`. Verification emails are not sent by the emulator; their links are listed at `http://127.0.0.1:9099/emulator/v1/projects/demo-hengam/oobCodes`.

### Before a real build

- **Google sign-in on iOS and Android** needs the iOS and web OAuth client ids from the Firebase console in `EXPO_PUBLIC_GOOGLE_*`, and a development build (it is not in Expo Go). Without them the button is hidden on native; it always works on the web.
- **Sign in with Apple** needs the Apple provider enabled in Firebase and the capability on the App ID. On the web it also needs a Services ID, and is off unless `EXPO_PUBLIC_APPLE_WEB=1`.
- **The Teams web origin** must be listed in `TEAMS_ALLOWED_ORIGINS` on Vercel, and added to Firebase Auth's authorized domains.
- **Invite links** point at `EXPO_PUBLIC_INVITE_BASE_URL` (default `https://teams.hengam.app`). Universal links need the `apple-app-site-association` and `assetlinks.json` files served from that domain.

## Risks

- **Vercel Hobby allows 12 functions.** `api/teams/*` is one router function, not one file per endpoint.
- **Firebase Storage needs the Blaze plan.** Imports are processed in the request and discarded, within Vercel's 4.5 MB request body limit; larger files would need direct Blob uploads.
- **Imported names are ambiguous.** Matches to the roster are suggestions on the review screen, never applied silently.
- **Swaps show coworkers' shifts.** Choosing a shift to swap for lists coworkers' upcoming shifts (name, time, position) even when the business has the full-schedule view off. Swapping cannot work without it; the list comes from the server and only for the next four weeks.
- **Labor rules are per business.** The app does not know local law and says so where limits are configured.
- **Existing employee accounts.** Accounts linked to Hengam through `managerId` move to memberships with an idempotent migration script.

## Running the emulator tests

The Firestore emulator needs Java 21:

```bash
JAVA_HOME=/opt/homebrew/opt/openjdk@21 PATH="/opt/homebrew/opt/openjdk@21/bin:$PATH" npm run test:emulator
```

It runs the rules tests and the server workflow tests against the `demo-hengam` project id, so nothing touches the real database.
