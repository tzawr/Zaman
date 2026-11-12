# HENGAM notifications

Every notification passes through one path, `api/_notify.js` (`persistNotifications`). It writes:
- an **in-app item**: `users/{uid}/notifications/{key}`, shown by the web bell and the Teams app;
- a **push**: `pushQueue`, Teams app only;
- an **email**: `emailOutbox`, sent through Resend.

Each is written at most once per event and follows the person's preferences.

## Events (only real ones)

| Type | Category | Who | Produced by |
|---|---|---|---|
| `schedule_published` | schedule | Staff on the week | Teams `publishSchedule`, and HENGAM → Teams publish |
| `schedule_changed` | schedule | The affected person | Teams shift edits after publishing |
| `shift_reminder` | reminders | The assignee | Daily job, the day before |
| `marketplace_shift`, `pickup_*`, `swap_*` | requests | Members / managers / the people involved | Teams marketplace |
| `time_off_requested`, `time_off_decided` | requests | Managers / the requester | Teams time off |
| `invite_accepted` | team | The manager | Hengam invite page → `reportEvent` (server checks `invites/{id}.usedBy`) |
| `availability_changed` | team | The manager, at most once an hour per employee | Employee portal save → `reportEvent` (server checks the save happened in the last 10 minutes) |
| `plan_activated` | billing | The account | Promo code redemption (the only plan change that exists) |
| `welcome` | account | The owner, once | End of onboarding (`sendWelcome`) |
| `password_changed` | security | The account's verified address | Profile → change password → `reportEvent` (server checks Firebase `tokensValidAfterTime`) |
| `account_deleted` | security | The address the account had | After a successful account deletion |

Firebase Authentication sends three emails itself: verification, password reset, and email-change. They are branded HENGAM, with reply-to `hello@hengam.app`.

There are no payments, renewals or payment failures, because HENGAM has no paid checkout. Those notifications will be added when one exists.

## Preferences

`users/{uid}.notificationPrefs` holds `{ email: {category: bool}, inApp: {category: bool}, language }`. It is edited under Profile → Notifications (`/profile#notifications`).
- Categories: schedule, reminders, requests, team, billing, product.
- Defaults: all on, except product news by email.
- **Account and security** emails cannot be turned off (`shared/notify/prefs.js`).
- The language of emails comes from the preference, then the account's language, then English. Text for every type, in English and Persian, is in `shared/notify/text.js`.

## Reliability

- **Idempotency:** the event key is the document id of the in-app item and the outbox row. Delivering an event twice changes nothing. The daily job and request-time draining claim each email in a transaction before sending.
- **Never undoes work:** delivery runs after the change has been committed, and its failures are caught and reported (`errorEvents`). A failed email never rolls back a saved schedule.
- **Retries:** 6 attempts, with backoff of 1 min, 5 min, 25 min, 2 h, then 6 h. Retries are drained right after new notifications and by the daily job. A final failure is recorded in monitoring (`email.send`).
- **Provider outage:** emails wait in the outbox, up to 14 days (`expireAt`). In-app items and pushes are unaffected.
- **Limits:**
  - at most 12 non-essential emails per person per hour;
  - `emailInvite` 20 per hour, plus one email per invite every 10 minutes;
  - `reportEvent` 30 per hour;
  - `sendWelcome` 3 per hour.
- **Bounces and complaints:** `POST /api/email/webhook` verifies Resend's Svix signature (`RESEND_WEBHOOK_SECRET`, 5-minute tolerance). Permanent bounces and spam complaints add a hashed address to `emailSuppressions`, and those addresses are never mailed again.
- **Privacy:** `emailLog` and `emailEvents` hold type, category, a hashed uid, the status and the provider id. They hold no address, subject or body. Outbox content is cleared as soon as an email is sent, dropped or abandoned.
- **Retention:**
  - in-app notifications: 90 days;
  - outbox: 14 days;
  - logs: 180 days.

  Outbox and logs are pruned by the daily job. Notifications carry `expireAt` for a Firestore TTL policy (free; enable once):

  ```
  gcloud firestore fields ttls update expireAt --collection-group=notifications --enable-ttl --project=zaman-ba689
  ```
- **Security:**
  - Browsers can read, mark read, or delete only their own notifications. They cannot create one.
  - The outbox, logs, events and suppression list are server-only (`tests/rules/notify.rules.test.js`).
  - Links in emails are built from `APP_ORIGIN` / `TEAMS_APP_ORIGIN`, never from a request.

## Configuration

| Variable | Where | Purpose |
|---|---|---|
| `RESEND_API_KEY` | Server | Turns email on. Without it nothing is sent, and in-app items still work. |
| `RESEND_WEBHOOK_SECRET` | Server | Verifies delivery events. |
| `VITE_EMAIL_ENABLED=1` | Web build | Shows the "Email this invite" form. |
| `EMAIL_FROM` | Server | Default `HENGAM <notifications@mail.hengam.app>`. |
| `EMAIL_FROM_SECURITY` | Server | Default `HENGAM Security <security@mail.hengam.app>`. |
| `EMAIL_REPLY_TO` | Server | Default `hello@hengam.app`. |
| `APP_ORIGIN` / `TEAMS_APP_ORIGIN` | Server | Link bases. Defaults: `https://hengam.app` and `https://teams.hengam.app`. |
| `EMAIL_DISABLED=1` | Server | Stops email at once (kill switch). |

Preview every email without sending: `node scripts/email-preview.mjs`.
