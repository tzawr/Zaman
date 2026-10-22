# Hengam Teams — Store submission

What is ready in the repo, what only you can do, and the answers the App Store and Google Play ask for. The app's configuration is `teams/app.config.js`; build profiles are `teams/eas.json`.

## Before the first build (only you can do these)

1. **Accounts.** An Apple Developer Program membership and a Google Play developer account, both in the business's name.
2. **EAS project.** In `teams/`, run `npx eas-cli@latest login` then `npx eas-cli@latest init`. Put the project id it prints in `EXPO_PUBLIC_EAS_PROJECT_ID`. Push needs it.
3. **Environment variables on EAS.** Add every `EXPO_PUBLIC_*` value from `teams/.env.example` to the `production` (and `preview`) environment with `npx eas-cli@latest env:create`. Production values point at `zaman-ba689` and the production API URL, and never set `EXPO_PUBLIC_USE_EMULATORS`.
4. **Sign-in providers.** Google: the iOS and web client ids, and `EXPO_PUBLIC_GOOGLE_IOS_URL_SCHEME`. Apple: enable the provider in Firebase and the Sign in with Apple capability on the `app.hengam.teams` App ID. If Google sign-in ships on iOS, Sign in with Apple must too (App Review 4.8). Both are already in the app.
5. **Vercel.** Set `ANTHROPIC_API_KEY` (photo and PDF imports), `CRON_SECRET`, and `TEAMS_ALLOWED_ORIGINS`.
6. **Privacy policy.** It must cover Teams before review (see below).
7. **A review account.** Create one in production for App Review: an owner of a demo workspace with a published week, one other member, and a shift on the marketplace. Put its email and password in App Store Connect's review notes, not in this repo.

## Building and submitting

```bash
cd teams
npx eas-cli@latest build --profile production --platform all
npx eas-cli@latest submit --profile production --platform ios
npx eas-cli@latest submit --profile production --platform android
```

- `development` builds the dev client (needed for push and native Google sign-in). `preview` builds an internal test build.
- Build numbers live on EAS (`appVersionSource: remote`) and go up by one with each production build. The version people see is `version` in `app.config.js`. Raise it for each store release.
- The first Android upload must be done by hand in the Play Console. After that, `eas submit` works with a service account key.

## What the app declares

- **iOS.** It uses no non-exempt encryption, only HTTPS, so there are no export compliance questions per build. The privacy manifest lists the required-reason APIs React Native and the Expo modules use. The only permission prompt is notifications, shown when the person turns push on in Profile.
- **Android.** Permissions: internet, notifications, and starting after reboot (for scheduled notifications). The external-storage permissions are blocked, since files come through the system picker.
- **Account deletion.** Profile → Delete account. It re-authenticates the person and deletes the account in both Teams and Hengam (Apple 5.1.1(v), Google Play account deletion policy). Google Play also asks for a web page where people can request deletion. Hengam's Settings page is that page.

## Listing

**Name:** Hengam Teams
**Subtitle (iOS, 30 characters):** Shifts, swaps and time off
**Category:** Business (secondary: Productivity)
**Age rating:** 4+ / Everyone. No user-generated content is visible outside a workplace, and nothing is shared publicly.

**Description:**

> Your shifts, every workplace, in one place.
>
> Hengam Teams is where your team sees the schedule, swaps and picks up shifts, and asks for time off, without the group chat.
>
> For everyone on the team
> • See your shifts across every workplace, with clashes caught before they happen
> • Offer a shift you can't work, or pick up one someone else offered
> • Swap shifts with a coworker, with your manager's approval when it's needed
> • Set your availability and request time off
> • Get a reminder the day before, and sync shifts to Apple, Google or Outlook calendar
>
> For managers
> • Build and publish the week, and everyone hears about it
> • Approve pickups, swaps and time off from your phone
> • Bring in an existing schedule from a spreadsheet, PDF or photo, and review every row before it's used
> • Works on its own, or alongside Hengam's automatic scheduling
>
> Free for now. One account works in both Hengam and Hengam Teams.

**Keywords (iOS, 100 characters):** schedule,shifts,rota,roster,shift swap,time off,staff,employee,workforce,restaurant,retail

## App Privacy (App Store) and Data safety (Google Play)

Nothing is used for tracking or advertising, and nothing is sold. Every item below is linked to the person's identity, and collection is not optional where it's needed to use the app.

| Data | Why | Notes |
|---|---|---|
| Name, email address | App functionality, account | From sign-up or Google/Apple |
| User ID | App functionality | Firebase uid |
| Other user content: shifts, availability, time off, requests | App functionality | Entered by the person or their manager |
| Photos or files (optional) | App functionality | Only when a manager imports a schedule. The file is read once and not stored. Word, Excel and CSV files are read on our server; PDFs and photos are sent to Anthropic to read. |
| Device ID: push token (optional) | App functionality | Only when push is turned on. Sent through Expo's push service. |
| Crash data, other diagnostic data | App functionality / diagnostics | Error message, stack, screen name, platform, app version; kept 30 days |

Data is encrypted in transit. People can delete their account in the app.

## Privacy policy: what has to be added

The policy at `/privacy` (in `src/i18n.jsx`, every language) describes Hengam. Before review it also needs to say:

- Hengam Teams uses the same account and data store as Hengam. Workplaces hold their members' names, contact details, shifts, availability, time off and requests, and members of a workplace see the schedule and the marketplace.
- Push notifications: the device's push token is stored and sent to Expo's push service (expo.dev) to deliver them, until the person signs out on that device, the app is uninstalled, or the account is deleted.
- Calendar feeds: a private link that anyone holding it can read, which the person can replace at any time.
- Schedule imports: a PDF or photo is sent to Anthropic's API to read the shifts in it, and is not stored by Hengam. Anthropic does not use it to train models.
- Crash reports: error details and the screen name, with the account id when signed in, kept for 30 days.
- Deleting the account in either app deletes it in both. Workplaces keep their own records of past shifts and time off.

## Monitoring after launch

- **Errors.** `node scripts/teams-errors.js` lists the errors the server and the app recorded, grouped and most frequent first (`--days 7`, `--stack`). It needs production credentials, like the other scripts.
- **Uptime.** Point any uptime monitor (UptimeRobot, Better Stack and similar have free tiers) at `GET /api/teams/health`. It returns 200 when the function can reach Firestore, and 503 otherwise.
- **The daily job.** It returns 500 when any part failed, so Vercel's cron history shows it. The failure is also in the error list.
