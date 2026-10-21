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

Hengam and Teams share one Firestore, so syncing is not messaging between systems. Every cross-product step is one transaction that reads and writes both sides, or neither. Nothing is queued, so nothing can be half-applied, replayed out of order, or loop: Teams never triggers a Hengam publish, and a publish never writes back to itself. A failed step changes nothing, says why, and is simply tried again.

| Data | Owner | How the other side gets it |
|---|---|---|
| Roster | Hengam | Copied to Teams staff on connect and on every publish. Staff id = Hengam employee id. Someone removed in Hengam stays on the Teams roster marked archived, so past shifts keep a name. |
| Schedule | Hengam | `hengamPublish` copies a saved week. Teams refuses to edit it (`hengam_owned`). |
| Who works a shift after a pickup or swap | Teams, written back | The approving transaction also renames the Hengam slot (`HengamWriteBack`), so republishing changes nothing. |
| Availability, time off | Teams | Hengam's generator overlays them for the week being built (`src/utils/teamsAvailability.js`). |

### Connecting

From Hengam Settings. `hengamConnect` creates one Teams business per Hengam workspace, `hengam-{managerUid}`, so connecting twice finds it. It copies the roster and makes everyone already on Hengam's employee portal a member, linked to their own employee record. The workspace's `users` document records `teamsBizId`.

### Publishing

From Schedule history, "Publish to team", which becomes "Update team schedule" once sent. `shared/teams/hengam.js` turns the Hengam week into Teams shifts:

- Each shift's id is its slot, `h_{weekStart}_{day}_{index}`, so republishing updates the same documents, and a regenerated week (a new Hengam schedule document) replaces the old one shift for shift.
- Hengam names employees by name. A name that matches nobody, or two people, stops the publish with the reason, and nothing is written.
- Hengam's `26:00` overnight ends become next-morning wall times.
- The publish adds, rewrites or cancels exactly what changed. A shift whose person and times are unchanged keeps its version, so its offers and swaps survive. A changed or removed shift closes any offer or swap on it.
- A fingerprint of the result is stored on the Teams schedule, so publishing an unchanged week is recognised and skipped.

### Write-back

A pickup or swap approved in Teams on a Hengam shift updates `data.days[day].shifts[index].employee` (and `content`) on the Hengam schedule in the same transaction. If the slot no longer holds the shift the transfer was agreed on, because the manager edited the week in Hengam after publishing, the transfer is refused (`hengam_changed`) rather than overwriting their edit.

### Availability and time off in Hengam

Before generating, Hengam reads the workspace's Teams availability and approved time off and uses them in place of its own records, for the people who have them. Teams availability is converted day by day for the week, so temporary changes and changes effective mid-week land on the right days; two Teams windows become one Hengam window spanning both. Hengam has whole-day time off only, so a part-day request keeps the person off that whole day. If Teams cannot be read, generation goes ahead on Hengam's records and says so.

Pending Teams time off appears on the Hengam Dashboard, to approve or decline there. Approving reports any shifts the person still has in that time.

### Running Hengam against the emulators

`npm run dev:emulated` runs Hengam with `.env.emulators` (demo values only), connected to the local emulators and with `/api` proxied to `npm run dev:api`. `npm run dev:seed` includes a Hengam workspace, Harbor Bakery (hana@example.test), not yet connected, with a saved week ready to publish and Sam on its employee portal.

## Roadmap

| Phase | Scope | Status |
|---|---|---|
| 1–2 | Inspect Hengam, architecture | Done |
| — | Fix reusable invites, lost employee availability, full-view leak in Hengam | Done |
| 3 | Schema, rules, rules tests | Done |
| 4 | Expo scaffold, sign-in (email, Google, Apple), workspaces, single-use invites, workplace switcher | Done |
| 5 | Home, calendar (day, week, month), upcoming shifts, manual scheduling and publishing | Done |
| 6 | Validation engine, marketplace, swaps, approvals, audit log | Done |
| 7 | Availability, time off, business policies | Done |
| 8 | Hengam sync | Done |
| 9 | Notifications, push, reminders, calendar feed and export | Done |
| 9b | Standalone imports: manual, CSV, Excel, PDF and image via Claude with mandatory review | Done |
| 10 | Performance, accessibility, monitoring, store submission | Done (store accounts and review pending, see [TEAMS_STORE.md](TEAMS_STORE.md)) |

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

## Availability, time off and policies (Phase 7)

### Availability

`businesses/{bizId}/availability/{staffId}` holds a short list of weekly patterns, each with the date it takes effect, so a change can be entered now and apply from next month. Old versions are pruned once a newer one is in force. Each day is available or not, with up to two windows (overnight allowed) or all day. Temporary changes, such as exams or a trip, are kept in the same document and override the weekly pattern for their dates. Someone who has never set availability is treated as available any time.

People set their own unless the business turns that off; managers can set anyone's. `shared/teams/availability.js` holds the rules both sides use: validating a pattern, which version applies on a date, whether a shift fits, and a one-line summary.

Availability does not block anything. A manager may know more than the form does, so the schedule editor warns ("Sam is not available on Weds") rather than refusing. The Schedule view marks every shift that falls outside availability or in time off, and lists who is off each day. The Availability section of Manage shows everyone's week, preferred hours, temporary changes, time off, and a badge on anything changed in the last week or about to change.

### Time off

`businesses/{bizId}/timeOff/{id}` is one request: category, dates, optionally part of one day, reason, and the instants it covers in the business's time zone. The id is derived from the app's request id, so a retried submission is the same request. A request cannot overlap another of the person's pending or approved requests. Managers approve or decline with a note; approving reports any shifts the person still has in that time so they can be reassigned. People can withdraw a pending request, or cancel approved time off that has not started.

Approved time off is a hard rule for trades: `checkAssignment` refuses a pickup or swap that would put someone on a shift during their approved time off.

### Policies

`businesses/{bizId}/settings/policies`, edited from Manage → Settings through `updatePolicies`: whether pickups and swaps need approval, whether employees see the full schedule or set their own availability, weekly and daily hour limits, minimum rest, the trading cut-off, and which kinds of time off are offered, including the business's own. Every change is audited with its before and after values.

## Notifications and calendars (Phase 9)

### In-app notifications

Workflows return `notify`, a list of intents (`{ kind, bizId, to, params }`, where `to` is a uid, `managers` or `members`), from the transaction attempt that committed. The router delivers them after the commit (`api/_teams-notify.js`): it resolves recipients, words each message (`shared/teams/notifications.js`), and writes `users/{uid}/notifications/{key}`. The key identifies the event (for example a shift and its version), so delivering twice writes one notification, and a redelivery never marks a read one unread. Delivery failing does not fail the request; the change is already committed.

| Event | Who hears |
|---|---|
| Week published (Teams or Hengam) | Everyone with a shift in it, with their count |
| Published shift changed, added or removed; Hengam republish | The people whose shifts changed |
| Shift offered | Everyone else in the business |
| Pickup asked for | Managers |
| Pickup decided | The claimant, the person who offered it, and anyone else who asked |
| Swap asked for / agreed / decided | The other person / managers / both |
| Time off asked for / decided | Managers / the person |
| Shift tomorrow | The person working it |

The app shows them behind a bell in every tab's header, with an unread count. Opening one marks it read and goes to what it is about.

### Push

Every notification also queues a push in `pushQueue` (server-only), sent through Expo's push service to each device under `users/{uid}/devices`. The request that caused it sends its own pushes straight away; the daily job sends anything left. Devices Expo reports as uninstalled are removed, and signing out removes that phone's entry first, so a shared phone stops getting the last person's notifications. A sign-out while offline gives up after four seconds and queues the removal. The app sends it to `forgetDevice` at the next launch or sign-in, with the push token as proof that it is that phone, since nobody may be signed in by then. People turn push on from Profile, so the system prompt comes when they ask. Push needs a development build and `EXPO_PUBLIC_EAS_PROJECT_ID`; it is not available on the web, where the bell is the notification.

### The daily job

`/api/cron/daily`, run by Vercel Cron at 01:00 UTC and refused without `CRON_SECRET`: reminds people of shifts in the next 36 hours, closes offers and swaps whose deadline passed (freeing their shifts), and drains the push queue. Every part is safe to run twice. Vercel's Hobby plan allows one cron run a day, so reminders say "Tomorrow" rather than "in two hours"; an hourly schedule on Pro needs no code change.

### Calendars

- **Subscription feed.** Profile → Calendar sync gives a private URL, `/api/calendar/{token}.ics`, for Apple Calendar, Google Calendar or Outlook. It lists every published shift the person works, from a month back, in every workplace they still belong to; a shift removed in the last two weeks stays in as cancelled so calendars drop it. The token is 48 hex characters, held in `calendarFeeds` (server-only), and can be replaced, which kills the old URL.
- **One shift.** A shift's screen has "Google Calendar" (a prefilled event) and, on the web, "Download .ics".

`shared/teams/ics.js` writes RFC 5545: UTC times, escaped text, lines folded at 75 bytes without splitting characters.

## Imports (Phase 9b)

Standalone workspaces can bring in an existing schedule from Manage → "Import a schedule". Hengam workspaces cannot; Hengam owns their shifts.

### Reading the file

- **CSV** (`shared/teams/imports.js`): RFC 4180, with comma, semicolon or tab detected and a BOM stripped.
- **Excel** (`api/_xlsx.js`): `.xlsx` only, read without a dependency. It takes the first sheet, shared and inline strings, and dates stored as serial numbers. `.xls` is refused with a request to save as `.xlsx`.
- **PDF and photos** (`api/_teams-extract.js`): Claude (`claude-opus-5-5`, with the server-side fallback) returns rows against a JSON schema and lists the fields it could not read. Each workspace may spend $5 a month and make 20 such imports a day, recorded in `aiUsage/teams-{bizId}_…`. CSV and Excel are never limited. This needs `ANTHROPIC_API_KEY` on Vercel.

Tables are read in two layouts. A **list** has a row per shift with name, date and time columns. A **grid** has a row per person and a column per day. "Off" cells are skipped, and split shifts like "10-2 / 5-9" become two shifts. Files are capped at 3 MB and 400 rows, and are not stored: only the rows read from them are.

### Review

Nothing becomes a shift without review. Each row is marked as needing a look when:

- its name only resembles someone on the team (a first name, an initial or a near spelling);
- its date is ambiguous (3/4 could be March or April);
- its times were guessed ("9-5" is read as 09:00–17:00);
- Claude flagged it as unclear.

The manager confirms each row, picks the person, adds them as someone new, edits the row, or leaves it out. Applying refuses any row still unresolved, any overlap, and any week that is already published. The shifts arrive as a **draft**, which the manager publishes as usual. An import is applied once, then marked published; a discarded one is closed.

## Launch readiness (Phase 10)

- **Performance.** Icons are imported per family (`@expo/vector-icons/Feather`), which took every other glyph map out of the web bundle: about 450 KB of source, roughly 100 KB gzipped. Routes load on demand. Every Firestore listener is bounded by status, time window or a limit. Firestore keeps its cache in memory, not on disk, so a shared work computer doesn't keep a workplace's schedule after sign-out.
- **Accessibility.** Checked with axe-core on every screen, in light and dark mode. State is set with `aria-*` props (`aria-checked`, `aria-disabled`, `aria-busy`, `aria-hidden`), which React Native and react-native-web both honour; react-native-web ignores `accessibilityState`. Each screen is a `main` landmark under a `banner` header. Light-mode accent, success and warning colours were darkened to clear 4.5:1 on their tinted backgrounds. The remaining axe notice is the tab bar and stack header containers, which the navigation library renders.
- **Monitoring.** `api/_monitoring.js` groups errors into `errorEvents/{day}_{fingerprint}` (server-only), with a count and the people affected. Ids and numbers are stripped before grouping. It records server 5xx errors from the router, failed notification deliveries, daily job parts, failed account deletions, and crashes the app reports through `reportClientError`. The app reports through a root `ErrorBoundary`, which shows a "Something went wrong" screen, and through global handlers for uncaught errors. Each session sends at most ten. Records are kept 30 days; the daily job prunes them and logs a summary. Each daily job part runs even when an earlier one fails, and a failed part makes the run return 500. `GET /api/teams/health` is for an uptime monitor. `scripts/teams-errors.js` lists the recorded errors.
- **Account deletion.** Profile → Delete account re-authenticates (password, or Google/Apple again, with Firebase refusing a different account) and calls `deleteAccount`. It runs the same code as Hengam's `/api/delete-account` (`api/_account-deletion.js`), which needs a sign-in from the last five minutes.
- **Store builds.** `teams/eas.json` has development, preview and production profiles, with remote build numbers. `app.config.js` declares the privacy manifest, the encryption exemption, the blocked storage permissions, the splash screen and the notification icon. What only the account holder can do, and the store answers, are in [TEAMS_STORE.md](TEAMS_STORE.md).

## Running Teams locally

Everything runs against the Firebase emulators under the `demo-hengam` project, so nothing touches production.

```bash
JAVA_HOME=/opt/homebrew/opt/openjdk@21 PATH="/opt/homebrew/opt/openjdk@21/bin:$PATH" npm run dev:emulators
npm run dev:api
cd teams && npx expo start --web
```

`npm run dev:seed` fills the emulators with two workplaces, a manager, and an employee who works at both, with last week and this week published and next week in draft. The test accounts are listed at the top of `scripts/seed-teams-dev.js`.

`teams/.env.example` lists the app's settings. For the emulators, `EXPO_PUBLIC_FIREBASE_PROJECT_ID=demo-hengam` and `EXPO_PUBLIC_USE_EMULATORS=1`. Verification emails are not sent by the emulator; their links are listed at `http://127.0.0.1:9099/emulator/v1/projects/demo-hengam/oobCodes`.

### Testing on your iPhone

`npm run ios:device` (in `teams/`) builds the app onto your own iPhone with a free Apple account, against the emulators on your Mac.

- **What works:** sign-in with email and password, schedules, the marketplace, swaps, availability and time off, imports from Files, and account deletion. Crash reports are not sent from development builds, and calendar feed links point at the Mac's own address, so they don't open on the phone.
- **What doesn't:** push notifications, Sign in with Apple and universal links. A free account can't sign them, so this build leaves them out. They need a paid account and an EAS build.
- **Separate app:** the build uses its own bundle id, `app.hengam.teams.dev`, so it never takes the store app's.
- **Expiry:** Apple stops it opening after 7 days; run the command again to reinstall.

Once, on the iPhone:

1. Turn on Settings → Privacy & Security → Developer Mode, and restart when asked.
2. Connect it to the Mac with a cable, unlock it, and tap Trust.
3. In Xcode → Settings → Accounts, sign in with your Apple ID if it isn't there.

Each time (the phone and the Mac on the same Wi-Fi):

```bash
JAVA_HOME=/opt/homebrew/opt/openjdk@21 PATH="/opt/homebrew/opt/openjdk@21/bin:$PATH" npm run dev:emulators:device
npm run dev:api:device
npm run dev:seed
cd teams && npm run ios:device
```

The first install fails to open with "Untrusted Developer". On the phone, go to Settings → General → VPN & Device Management, tap your Apple ID, then Trust. When the app asks to find devices on your local network, allow it; that is how it reaches the Mac. Sign in as `maya@example.test` (a manager) or `lee@example.test` (an employee) with the password in `scripts/seed-teams-dev.js`.

With the app already installed, `npm run ios:device:start` starts just the bundler. If the app opens to its launcher instead of Hengam Teams, tap the server it lists, or enter `http://<the Mac's address>:8082`.

The app finds the Mac by its network address, which is read when the bundler starts. If the Mac joins a different network (another Wi-Fi, or a phone's hotspot), restart `npm run ios:device:start`, and the emulators and API if they stopped. There is no need to rebuild.

The native build runs from a copy in `~/Library/Developer/HengamTeams`. When Desktop syncs to iCloud, every new folder in it gets Finder attributes that code signing refuses ("resource fork, Finder information, or similar detritus not allowed"). The device variants of the emulators and API listen on your network rather than only on this Mac, so anyone on the same Wi-Fi could reach the test data while they run.

### Before a real build

- **Google sign-in on iOS and Android** needs the iOS and web OAuth client ids from the Firebase console in `EXPO_PUBLIC_GOOGLE_*`, and a development build (it is not in Expo Go). Without them the button is hidden on native; it always works on the web.
- **Sign in with Apple** needs the Apple provider enabled in Firebase and the capability on the App ID. On the web it also needs a Services ID, and is off unless `EXPO_PUBLIC_APPLE_WEB=1`.
- **The Teams web origin** must be listed in `TEAMS_ALLOWED_ORIGINS` on Vercel, and added to Firebase Auth's authorized domains.
- **Invite links** point at `EXPO_PUBLIC_INVITE_BASE_URL` (default `https://teams.hengam.app`). Universal links need the `apple-app-site-association` and `assetlinks.json` files served from that domain.

## Risks

- **Vercel Hobby allows 12 functions and one cron run a day.** `api/teams/*` is one router function; Teams adds `api/calendar/[token]` and `api/cron/daily`, eight functions in all.
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
