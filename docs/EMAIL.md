# HENGAM email

| Address | Used for | Handled by |
|---|---|---|
| `hello@hengam.app` | Support, replies to every automated email, public contact | iCloud+ Custom Email Domain (MX `mx01/mx02.mail.icloud.com`) |
| `notifications@hengam.app` | Invites and welcome emails sent by the app | Resend (transactional) |
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
- `api/_email.js` holds the sender and the templates;
- `api/_teams-email.js` holds the actions: `emailInvite` and `sendWelcome`.

The feature is **off** until both of these are set:
- `RESEND_API_KEY` on the server (Vercel environment);
- `VITE_EMAIL_ENABLED=1` in the web build. This shows the "Email this invite" form.

Optional overrides: `EMAIL_FROM` (default `HENGAM <notifications@hengam.app>`), `EMAIL_REPLY_TO` (default `hello@hengam.app`), `APP_ORIGIN` (default `https://hengam.app`), and `EMAIL_DISABLED=1` to turn email off at once.

### DNS for Resend (GoDaddy, `hengam.app`)

Add the records Resend shows when you add the domain `hengam.app`. They are always these three:

| Type | Name | Purpose |
|---|---|---|
| TXT | `resend._domainkey` | DKIM key; mail is signed `d=hengam.app`, so it passes the existing DMARC `p=quarantine` |
| MX | `send` (priority 10) | Bounce handling for the return path `send.hengam.app` |
| TXT | `send` | SPF for `send.hengam.app` only: `v=spf1 include:amazonses.com ~all` |

**Do not touch these records:**
- the apex MX records (iCloud);
- the apex SPF, `v=spf1 include:icloud.com ~all`;
- `sig1._domainkey` (iCloud DKIM);
- `_dmarc`.

The Resend records live only on `send` and `resend._domainkey`. They add no second SPF record at the apex and don't change where mail to `hello@hengam.app` goes.

### Limits and cost

Resend's free plan allows 3,000 emails a month and 100 a day, on one domain, at $0.

The app's own limits:
- `emailInvite`: 20 per manager per hour, and one email per invite every 10 minutes;
- `sendWelcome`: one per account.

### Rollback

- Set `EMAIL_DISABLED=1` (or remove `RESEND_API_KEY`) and redeploy.
- The Resend DNS records can stay in place; they only authorize sending.
