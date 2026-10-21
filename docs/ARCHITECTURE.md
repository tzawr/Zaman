# Architecture

How Hengam is put together, and why. For what the product does, see the [README](../README.md).

## Shape of the system

A React SPA on Vercel talks directly to Firestore for anything the security rules can authorize, and goes through serverless functions in `api/` for anything that needs a secret or a decision the client cannot be trusted to make.

```
Browser (React SPA)
   │
   ├── Firebase Auth ──────────► identity, ID tokens
   │
   ├── Firestore (direct) ─────► reads/writes gated by firestore.rules
   │
   └── /api/* (Vercel) ────────► verifies ID token with Firebase Admin,
                                 holds ANTHROPIC_API_KEY,
                                 enforces spend caps and rate limits
```

The split matters: **the client never holds a secret, and the server never trusts the client.** Anything involving money — the Anthropic API, plan overrides — goes through `api/`, where an ID token is verified before anything else happens.

## Data model

All collections are top-level. Ownership is by `userId` (the manager's Firebase UID) except where noted.

| Collection | Document ID | Holds |
|---|---|---|
| `users` | Firebase UID | profile, plan, workspace settings, employee-account links |
| `employees` | auto | `userId`, `name`, `role`, `targetHours`, `availability`, `timeOff` |
| `schedules` | auto | `userId`, `weekStart`, `content`, `data`, `instructions`, `employeeCount`, `createdAt` |
| `invites` | invite token | `managerId`, `employeeId`, `employeeName`, `employeeRole`, permission flags, `used` |
| `promoCodes` | the code | `tier`, `durationDays`, `maxUses`, `usedCount`, `expiresAt`, `active` |
| `adminOverrides` | Firebase UID | `tier`, `expiresAt`, `reason`, `grantedBy` |
| `aiUsage` | `{uid}_{period}` | `spendUsd`, `inputTokens`, `outputTokens`, `calls` |
| `rateLimits` | `{bucket}_{key}_{slot}` | `count`, `expiresAt` — server-only, denied to clients |

Two collections use a **secret as the document ID**: `invites` and `promoCodes`. This lets an unauthenticated-ish flow do a direct `get` without being able to enumerate the collection — `list` is denied, `get` is allowed. Guessing a token is the only way in, and the promo endpoint rate-limits guesses.

`aiUsage` uses a composite ID so a user's own spend is readable by checking `docId.split('_')[0] == request.auth.uid`, with writes denied to clients entirely — the Admin SDK bypasses rules and is the only writer.

## Request flow: generating a schedule

1. The manager types coverage rules in plain English.
2. The client POSTs to `/api/generate-schedule` with a Firebase ID token.
3. The function verifies the token, resolves the caller's plan server-side, and checks the monthly spend cap and daily call cap **before** spending anything.
4. The prompt goes to the Anthropic API, which returns **structured constraints, not a schedule**.
5. Actual token usage is recorded against the user's monthly budget.
6. Back in the browser, `runScheduler` produces the week deterministically. `Schedule.jsx` runs twenty seeded variants, scores each with `validateSchedule`, and keeps the cleanest.
7. The manager can edit shifts by hand; the result is saved to `schedules`.

Step 6 runs client-side on purpose. It is pure computation over data the user already has, it needs no secrets, and keeping it local means editing a shift re-runs instantly instead of round-tripping.

## Authorization

Authorization is enforced **twice, independently**, and this is deliberate.

Firestore rules are the backstop: they apply to every direct client write, including one crafted by hand with a valid token and a modified payload. Server checks in `api/` are the gate for anything rules cannot express — spending money, resolving a plan, admin actions.

The rules enforce several things worth calling out:

- **Ownership.** Reading or writing an `employees` or `schedules` document requires `resource.data.userId == request.auth.uid`.
- **Billing fields are not self-writable.** A user owns their profile document but cannot change `tier`, `subscriptionTier`, `promoCode` or the other billing fields in it. Those change only via an admin or the promo flow, which writes a *separate* `adminOverrides` document.
- **Workspace links need a real, unused invite.** `accountType`, `managerId` and `linkedEmployeeId` decide what an account can read. They are writable only in the same batch that closes an invite naming the same manager and employee, and the invite as it stands after that batch must name this account as its user. An invite attaches exactly one account. `scripts/close-claimed-invites.js` closes invites accepted before this was enforced.
- **Managers read their employees' portal records.** A linked employee's availability and time-off submissions live on their own `users` document, which their manager can read but not write. The manager's settings decide whether those submissions are used.
- **Employees read schedules through the server.** A schedule document holds the whole team's week and rules cannot hide fields, so linked employees have no direct read. `/api/my-schedule` returns each week cut down to their own shifts, or whole when the manager allows the full view.

### Plan resolution

Effective plan is `adminOverride ?? userTier`, where an override counts only if it has no expiry or has not expired. This same logic exists in three places — `firestore.rules`, `src/utils/tier.js`, and `api/generate-schedule.js` — because each enforces it at a different trust boundary. `tier.js` is unit-tested against casing, whitespace and expiry edge cases.

## Design decisions

**A deterministic solver, not an LLM, produces the schedule.** An LLM asked to output a rota will produce something plausible that violates a constraint in a way nobody notices until someone doesn't show up. Constraint satisfaction is a solved problem in ordinary code, and code can *prove* a week is impossible. The LLM is confined to the one job it is genuinely better at: turning messy human phrasing into structured data. A wrong parse is visible and correctable; a wrong schedule is not.

**Seeded randomness.** The solver needs tie-breaking, but a manager who reloads must not get a different week. A seeded mulberry32 PRNG gives variation across attempts while keeping any single `(inputs, seed)` pair reproducible.

**Generate twenty, keep the best.** Greedy slot-filling can strand a late slot by spending the only eligible person early. Rather than backtracking, the system samples twenty seeded orderings and scores them. When all twenty leave gaps, that is strong evidence the week is genuinely over-constrained — which is the answer the manager needs.

**Rate limits in Firestore, not memory.** Serverless instances are recycled unpredictably, so an in-process counter resets at arbitrary moments and enforces nothing. The limiter **fails open**: if the counter itself errors, that is our fault, and it should not lock a legitimate user out of their account.

**Spend caps, not call caps.** One Anthropic call can cost 25× another, so counting calls does not bound cost. The monthly cap is denominated in dollars and checked before the request; the daily call cap is a secondary guard so a runaway burns the budget over days rather than in one minute.

**4xx tells, 5xx doesn't.** A 4xx describes something the caller can fix. A 5xx describes our internals — credential shapes, upstream error bodies — so it logs server-side and returns a fixed sentence.

## Known limitations

- **Firestore rules cannot count documents**, so free-tier quotas (employee cap, schedule history) are enforced in application code and are bypassable by a determined user with devtools. The security boundary holds; the product boundary does not. Enforcing it properly needs a counter document or a server endpoint.
- **The admin allowlist is duplicated** in `firestore.rules`, `src/utils/admin.js` and the `ADMIN_UIDS` environment variable. Three copies that must stay in sync.
- **Rules tests need Java 21.** `npm run test:rules` runs `tests/rules/` against the Firestore emulator; see [TEAMS_ARCHITECTURE.md](TEAMS_ARCHITECTURE.md#running-the-rules-tests).
- **No error monitoring.** Server errors go to Vercel logs; there is no alerting.
