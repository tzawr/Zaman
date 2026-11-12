# HENGAM email

| Address | Used for | Handled by |
|---|---|---|
| `hello@hengam.app` | Support, replies to every automated email, public contact | iCloud+ Custom Email Domain (MX `mx01/mx02.mail.icloud.com`) |
| `notifications@mail.hengam.app` | Invites, welcome, schedule, request, team and plan notifications | Resend (transactional) |
| `security@mail.hengam.app` | Password-changed and account-deleted notices (always sent) | Resend (transactional) |
| `noreply@zaman-ba689.firebaseapp.com` | Verification, password reset, email change | Firebase Authentication |

Every automated email shows the sender name **HENGAM** and has reply-to **hello@hengam.app**.

## Firebase Authentication emails

These are set in project `zaman-ba689`, under Authentication → Templates. All four templates use:
- sender name: HENGAM;
- reply-to: `hello@hengam.app`.

Subjects say "HENGAM" through `%APP_NAME%`. That variable comes from the OAuth app name, which is now HENGAM (Google Auth Platform → Branding).

The sending address stays on `firebaseapp.com`. Moving it to `hengam.app` means verifying a custom domain in Firebase, which needs DNS records. That is optional.

## App emails (Resend)

Code:
- `api/_email.js` holds the sender and the template design system;
- `api/_notify.js` holds the outbox, retries, suppression and logging;
- `api/_teams-email.js` holds `emailInvite`, `sendWelcome` and `reportEvent`;
- `api/email/webhook.js` handles delivery events.

See docs/NOTIFICATIONS.md for the full system.

The feature is **off** until both of these are set:
- `RESEND_API_KEY` on the server (Vercel environment);
- `VITE_EMAIL_ENABLED=1` in the web build. This shows the "Email this invite" form.

Optional overrides: `EMAIL_FROM` (default `HENGAM <notifications@mail.hengam.app>`), `EMAIL_REPLY_TO` (default `hello@hengam.app`), `APP_ORIGIN` (default `https://hengam.app`), and `EMAIL_DISABLED=1` to turn email off at once.

### DNS for Resend (GoDaddy, sending subdomain `mail.hengam.app`)

Added 2026-11-12. Resend recommends a subdomain so that sending reputation stays separate from `hengam.app`. These are the only changes:

| Type | Name | Value | Purpose |
|---|---|---|---|
| TXT | `resend._domainkey.mail` | `p=MIGfMA0…IDAQAB` (Resend's public DKIM key) | DKIM, `d=mail.hengam.app`; passes DMARC with relaxed alignment |
| CNAME | `send.mail` | `send.forge.rmta.net` | Return path, bounces and SPF for `send.mail.hengam.app` |
| CNAME | `rsend.mail` | `rsend.forge.rmta.net` | Resend's sending infrastructure |

Receiving on `mail.hengam.app` (Resend's optional MX record) is **not** enabled: replies go to `hello@hengam.app`.

**Do not touch these records:**
- the apex MX records (iCloud);
- the apex SPF, `v=spf1 include:icloud.com ~all`;
- `sig1._domainkey` (iCloud DKIM);
- `_dmarc` (`p=quarantine`, which also covers the subdomain).

A diff of every existing record before and after these were added showed no change.

### Limits and cost

Resend's free plan allows 3,000 emails a month and 100 a day, on one domain, at $0.

The app's own limits:
- `emailInvite`: 20 per manager per hour, and one email per invite every 10 minutes;
- `sendWelcome`: one per account.

### Rollback

- Set `EMAIL_DISABLED=1` (or remove `RESEND_API_KEY`) and redeploy.
- The Resend DNS records can stay in place; they only authorize sending.
