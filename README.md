# Hengam

Shift scheduling for managers who still build the weekly rota by hand.

**Live: [hengam.app](https://hengam.app)**

A manager describes coverage in plain English — *"1 supervisor and 1 barista from open until 4pm, nobody works a close followed by an open"* — and Hengam turns that into a checked weekly schedule. When a week genuinely cannot be staffed, it says so and explains which shift is uncovered and why, instead of quietly producing something that looks fine and isn't.

## The problem

Small-team scheduling is a constraint problem that people solve in spreadsheets. A manager holds in their head: who is available which days, who has time off, who is trained for which role, who needs 40 hours and who wants 12, minimum coverage per daypart, and the rule that nobody closes at midnight and opens at 6am. Changing one shift cascades. Most weeks it takes an hour or two, and a mistake surfaces when someone doesn't turn up.

The interesting part is not generating *a* schedule. It's knowing when no valid schedule exists, and being able to say which constraint is the binding one.

## Screenshots

<!-- TODO: add screenshots.
     Suggested: (1) the generated week view, (2) the rules input with parsed
     constraints, (3) the explained-gap state when a week can't be staffed. -->

## How the scheduling engine works

This is the part worth reading.

**The LLM does not write the schedule.** It is used for exactly one job: turning a manager's free text into a structured constraint object — coverage slots, role requirements, pairings, people to keep apart, day and close caps. That is a language problem, and it is the only part of the system where a wrong answer is cheap and correctable.

Everything after that is deterministic code in [`src/utils/scheduler.js`](src/utils/scheduler.js). `runScheduler(employees, settings, weekStart, constraints)` walks the week and fills each coverage slot, rejecting a candidate for any of:

- already assigned that day
- unavailable, or on booked time off for that date
- wrong role for the slot
- starts too late or ends too early to satisfy the slot
- fewer than four hours of overlap with the slot
- would break the clopening rule — a close followed by an open inside the minimum rest gap
- would push them past their target hours

Randomness comes from a seeded PRNG (mulberry32), so the same inputs and the same seed always produce the same week. That matters for a scheduling tool: a manager who reloads should not get a different rota.

**Generate, then check.** A single pass can fill slots in an order that paints itself into a corner, so [`src/pages/Schedule.jsx`](src/pages/Schedule.jsx) runs twenty seeded variants and scores each with `validateSchedule`, keeping the one with the fewest violations. If every variant leaves coverage unfilled, that is a real answer — the week is over-constrained — and the uncovered slots are reported as `emptySlots` per day rather than silently dropped.

The output separates what happened from what it cost:

```js
{
  weekStart,
  days:    { monday: { date, shifts, emptySlots }, ... },
  summary: [{ employee, role, scheduledHours, targetHours, difference }],
  issues: [], recommendations: [],
}
```

## Features

- Plain-English coverage rules parsed into structured constraints
- Deterministic, reproducible schedule generation
- Per-employee availability, time off, roles and target hours
- Explained coverage gaps when a week cannot be staffed
- Team invites; employees get a read-only view of their own shifts
- CSV, PNG and PDF export
- English and Persian (فارسی), including RTL layout
- Light and dark themes

## Tech stack

| | |
|---|---|
| Frontend | React 19, Vite 8, React Router 7, Framer Motion |
| Auth & data | Firebase Auth, Cloud Firestore |
| Backend | Vercel serverless functions (`api/`) |
| Rule parsing | Anthropic API — natural language to structured constraints only |
| Export | html2canvas, jsPDF (both lazy-loaded) |

Firestore was chosen because the access pattern is per-workspace document reads with real-time updates, and because its security rules let authorization live next to the data rather than only in application code. The tradeoff is that rules cannot count documents, so quota limits are enforced in application code — noted honestly in [`firestore.rules`](firestore.rules) where it applies.

## Security

Most of the engineering effort here went somewhere invisible, so it is worth listing.

- **Content-Security-Policy** built from what the app actually loads, plus HSTS, `X-Frame-Options: DENY`, `Cross-Origin-Opener-Policy`, `Referrer-Policy` and `Permissions-Policy` — see [`vercel.json`](vercel.json). The policy was verified against the real build in a browser before shipping, because a CSP that breaks sign-in is worse than none.
- **Firestore rules** ([`firestore.rules`](firestore.rules)) enforce per-document ownership, keep collections non-listable where the document ID is itself a secret, lock billing fields away from the user who owns the document, and only allow an account to join a workspace when a real invite backs the link.
- **Every endpoint verifies a Firebase ID token server-side.** Admin routes check an allowlist. Authorization is never inferred from the client — see [`api/_firebase-admin.js`](api/_firebase-admin.js).
- **Spend caps on AI usage.** One call can cost 25× another, so a per-user monthly USD budget and a daily call cap are checked before the request, not after ([`api/generate-schedule.js`](api/generate-schedule.js)).
- **Rate limiting** backed by Firestore rather than memory, because serverless instances are recycled and an in-process counter resets at random. It fails open — a broken limiter should not lock a user out ([`api/_rate-limit.js`](api/_rate-limit.js)).
- **Errors say what the caller can fix.** A 4xx carries a useful message; a 5xx logs the detail server-side and returns a fixed sentence, so failures never leak credentials or internals.

## Accessibility

Every form control has a programmatic accessible name — either a `<label htmlFor>` pairing or an `aria-label`; a placeholder alone is not treated as a label. Text colours meet WCAG AA contrast in both themes.

## Local development

```bash
npm install
npm run dev
```

Running the serverless functions locally needs the Vercel CLI and credentials:

```bash
npm run dev:vercel
```

Copy `.env.example` to `.env.local` and fill it in. `VITE_FIREBASE_*` values are public client config; `ANTHROPIC_API_KEY` and the Firebase Admin credentials are server-only and must never carry the `VITE_` prefix, which would inline them into the browser bundle.

```bash
npm run build    # production build + prerendered SEO pages
npm run lint
npm test         # 42 unit tests
```

## Testing

42 tests covering the logic where a bug is expensive and silent:

| Suite | Tests | Covers |
|---|---|---|
| `scheduler.test.js` | 15 | slot filling, availability windows, clopening, target hours, midnight boundaries |
| `shiftTime.test.js` | 9 | shift-length maths across midnight, wall-clock formatting |
| `tier.test.js` | 9 | plan resolution, admin overrides, expiry |
| `exportSchedule.test.js` | 5 | CSV shape and escaping |
| `setupChecklist.test.js` | 4 | onboarding completeness |

## Project structure

```
api/                 Vercel serverless functions
  _firebase-admin.js   token verification, admin allowlist, error shaping
  _rate-limit.js       Firestore-backed rate limiter
  generate-schedule.js rule parsing, spend caps
src/
  pages/             route components
  components/        shared UI
  utils/
    scheduler.js       the constraint solver
    tier.js            plan resolution
    shiftTime.js       shift arithmetic
  i18n.jsx           English + Persian strings
firestore.rules      authorization
vercel.json          security headers, caching, SPA rewrites
docs/ARCHITECTURE.md data model, request flow, design decisions
```

## Further reading

[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) covers the data model, the end-to-end request flow for generating a schedule, the authorization model, and the reasoning behind the main design decisions.
