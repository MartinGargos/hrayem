# Hrayem

Hrayem is a production-oriented mobile app for Czech racket-sport players who want to find or create badminton, padel, and squash games by city, time, venue, and skill level without relying on messaging groups. This repository currently includes the Milestone 0 Expo client foundation plus the implemented Milestone 1-10 MVP flows and the Milestone 11 repo-side launch surfaces: auth/session resilience, typed navigation, venue search, events, join/waitlist, organizer tools, post-game feedback, chat, notifications, availability, reporting, account deletion, public share fallback, and launch-site asset generation for the current canonical domain `https://hrayem.cz`. Hosted website deployment, final Android app-link inputs, and real production-device launch proof are still separate launch inputs, not completed repo proof.

Milestone 0 is complete in code, but real-device proof is still pending until Apple Developer activation is available again. The remaining deferred checks are iOS dev-build install, offline banner verification on device, CZ/EN switching on device, React Query dummy cache proof on device, Sentry dashboard capture, and deep-link opening on a real install.

## Tech stack

- React Native `0.83.4`
- Expo SDK `55.0.9`
- React `19.2.0`
- TypeScript `5.9.x` in strict mode
- Supabase JS `2.100.0`
- TanStack Query `5.95.2`
- Zustand `5.0.12`
- React Navigation `7.x`
- i18next `25.10.8` + react-i18next `16.6.5`
- Sentry React Native `7.11.0`
- pnpm `10.13.1`

## Prerequisites

- WSL2 or later
- Node `20.19.4` installed once via `nvm`
- Corepack enabled so `pnpm@10.13.1` is available
- Android Studio with an Android emulator on the Windows host
- Expo CLI via the repo scripts or the local project binary
- EAS CLI available through `pnpm dlx eas-cli`
- A Supabase project with the public URL, anon key, and service role key ready for the Milestone 1 apply and verification workflow

## Development environment

- Primary workflow: Cursor + Codex inside WSL
- iOS simulators do not run inside WSL
- Use the Android emulator for fast local iteration
- Use EAS development builds for iOS testing from WSL
- Expo SDK 55 requires Node `>=20.19.4`; this repo pins that version in `.nvmrc`
- All package scripts run through `scripts/with-node20.sh`, so `pnpm run ...` uses Node 20 even if a fresh shell still defaults to an older Node binary

## Environment setup

1. Copy `.env.example` to `.env`.
2. Fill in the variables below.

Client variables bundled into the app:

- `EXPO_PUBLIC_SUPABASE_URL`: Supabase project URL
- `EXPO_PUBLIC_SUPABASE_ANON_KEY`: Supabase anon key for client reads/auth
- `EXPO_PUBLIC_SENTRY_DSN`: Sentry DSN for crash reporting
- `EXPO_PUBLIC_TERMS_VERSION`: active Terms of Service version string
- `EXPO_PUBLIC_PRIVACY_VERSION`: active Privacy Policy version string
- `EXPO_PUBLIC_WEB_BASE_URL`: canonical launch-site origin used for shared event fallback pages and legal pages (`https://hrayem.cz` for the current launch target)
- `EXPO_PUBLIC_APP_STORE_URL`: final App Store page for "Download Hrayem" links
- `EXPO_PUBLIC_PLAY_STORE_URL`: final Google Play page for "Download Hrayem" links; may stay blank while Android launch proof is intentionally deferred

Server-only variables reserved for Edge Functions:

- `SUPABASE_SERVICE_ROLE_KEY`: Supabase service role key
- `EXPO_PUSH_ACCESS_TOKEN`: Expo push service token
- `UPSTASH_REDIS_REST_URL`: Upstash Redis REST endpoint
- `UPSTASH_REDIS_REST_TOKEN`: Upstash Redis REST token
- `EVENT_REMINDER_DISPATCH_SECRET`: shared secret used by the scheduled reminder dispatcher
- `ADMIN_REPORT_EMAIL`: destination for report notifications
- `RESEND_API_KEY`: Resend API key for report email delivery
- `REPORT_EMAIL_FROM`: verified sender used for report email delivery

Launch-site asset variables used during Milestone 11:

- `HRAYEM_APPLE_TEAM_ID`: Apple Team ID used to generate `apple-app-site-association`
- `HRAYEM_ANDROID_SHA256_CERT_FINGERPRINTS`: comma-separated release certificate SHA-256 fingerprints for `assetlinks.json`; may stay blank while Android app-link proof is deferred

## How to run locally

```bash
nvm install 20.19.4
corepack enable
corepack prepare pnpm@10.13.1 --activate
pnpm install
cp .env.example .env
# fill in the .env values
pnpm run start
```

To launch on Android from WSL after the Windows-host emulator is running:

```bash
pnpm run android
```

## How to run on a real device

For local QA in a Metro-driven development build only, the auth screen includes dev-only quick-login buttons for the seeded iPhone QA accounts. They are gated behind `__DEV__` and must never appear in preview or production builds.

### iPhone runbook — Milestone 0 from WSL

Use this flow when you are on Windows + WSL, you have a physical iPhone, and you do not have an Android device available right now. It matches the current `development` profile in [`eas.json`](/home/martin/hrayem/eas.json).

1. Prepare the project in WSL.

   ```bash
   pnpm install
   cp .env.example .env
   # fill in the required EXPO_PUBLIC_* values
   pnpm run doctor
   ```

2. Log in to Expo and register the iPhone for internal iOS builds.

   ```bash
   pnpm dlx eas-cli login
   pnpm dlx eas-cli device:create
   ```

   On the iPhone, open the registration link or QR code that EAS shows, install the temporary Apple device-registration profile, approve the device registration, and return to the CLI when it asks you to continue.

3. Build the iOS development client.

   ```bash
   pnpm dlx eas-cli build --profile development --platform ios
   ```

   If EAS asks for Apple credentials, sign in with the Apple Developer account that will own the build. Wait for the build to finish.

4. Install the build on the iPhone.

   Open the build URL printed by EAS on the iPhone in Safari, tap **Install**, and complete any iOS install prompts. If iOS asks you to trust the developer or provisioning profile, finish that prompt in Settings and then return to the Home Screen.

5. Start Metro from WSL for the development client.

   ```bash
   pnpm run start -- --dev-client --tunnel
   ```

   Keep this process running. The `--tunnel` flag is the safest option from WSL to a physical iPhone.

6. Open the app on the iPhone.

   Tap the installed **Hrayem** app. If it does not connect automatically, scan the QR code shown by Expo with the iPhone camera and tap the link so iOS opens it in the Hrayem development build.

### PROVABLE NOW ON IPHONE

Run these checks on the current Milestone 0 foundation screen:

1. **App opens on a real device:** the Hrayem development build launches and shows the Milestone 0 foundation screen.
2. **React Query wiring:** note the **Fetch count** value, tap **Refetch demo query**, and confirm the count increments and the fetched timestamp updates without a blank-screen flash.
3. **i18n switching:** tap the Czech and English language buttons and confirm the visible copy changes on the screen.
4. **Offline banner:** disable Wi-Fi and cellular data or enable Airplane Mode, reopen the app, and confirm the top offline banner appears.
5. **Date formatting:** confirm the date/time card matches the iPhone's current local timezone.
6. **Sentry smoke test:** tap the Sentry test button on the foundation screen and confirm the event appears in your Sentry dashboard.
7. **Deep link scheme registration:** create or send yourself a `hrayem://event/example-id` link on the iPhone, tap it, and confirm iOS offers to open Hrayem or opens Hrayem directly.

### STILL NEEDS ANDROID LATER

- Android app launch proof on an emulator or Android device.
- Android-side deep-link and app-link proof for the registered `package` / `intentFilters`.
- Cross-platform confidence that the same Milestone 0 checks behave the same way on Android.

## Supabase setup

The repo now includes the Milestone 1 Supabase assets:

- Ordered schema migrations in `supabase/migrations/`
- Seed data in `supabase/seed.sql` for `sports`, `app_config`, and the initial Ostrava venues
- A verification script in `scripts/verify-milestone1.mjs` for the required trigger and RLS checks
- The authoritative allowed city set lives in the migration-seeded `private.cities` table; `src/constants/cities.ts` is the client mirror and the verification script checks they stay in sync
- Milestone 2 adds launch-time `app_config` reads for force-update checks and an `avatars` Storage bucket migration for optional profile photos
- Milestone 4 adds the `events` Edge Function for event creation plus `scripts/verify-milestone4.mjs` for venue search, `SKILL_LEVEL_REQUIRED`, feed pagination, and event-detail proof
- Milestone 10 adds the `reports` and `account` Edge Functions plus `scripts/verify-milestone10.mjs` for report submission and account-deletion proof
- Milestone 11 adds the public `share` Edge Function plus `scripts/verify-milestone11.mjs` for iPhone/web-first launch proof with Android app-link status reported separately

Use this workflow once `.env` contains real `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` values:

```bash
pnpm dlx supabase login
pnpm dlx supabase link --project-ref <project-ref>
pnpm dlx supabase db push
pnpm dlx supabase functions deploy events
pnpm dlx supabase functions deploy reports
pnpm dlx supabase functions deploy account
pnpm dlx supabase functions deploy share
pnpm run verify:milestone1
pnpm run verify:milestone4
pnpm run verify:milestone10
pnpm run verify:milestone11
```

Apply the versioned seed file in `supabase/seed.sql` immediately after the migrations as part of the same Supabase deployment workflow. The Milestone 4 event-creation flow now depends on the deployed `events` Edge Function.

Milestone 9 reminder pushes also require one runtime bridge after deploy so the scheduled database sweep can call the Edge Function dispatcher securely:

```bash
pnpm dlx supabase secrets set EVENT_REMINDER_DISPATCH_SECRET=<shared-secret>
pnpm dlx supabase db query --linked "insert into private.runtime_config (key, value) values
  ('event_reminder_dispatch_url', '<supabase-url>/functions/v1/events/internal/reminders/dispatch'),
  ('event_reminder_dispatch_secret', '<shared-secret>')
on conflict (key) do update set value = excluded.value, updated_at = now();"
```

For Milestone 2 auth flows, also configure these Supabase Auth settings:

- Add `hrayem://auth/callback` to the Auth redirect URL allow list.
- Configure the Apple and Google providers in Supabase Auth.
- Use an EAS development build for real OAuth and push-token testing; the app now includes `expo-notifications`, `expo-location`, `expo-image-picker`, `expo-image-manipulator`, and `expo-web-browser`.

For Milestone 10 report emails, also configure a verified Resend sender and set `ADMIN_REPORT_EMAIL`, `RESEND_API_KEY`, and `REPORT_EMAIL_FROM` in Supabase Edge Function secrets before you deploy or claim admin-email proof.

For Milestone 11 launch readiness, generate the well-known app-link assets before you deploy the website:

```bash
pnpm run generate:launch-assets
```

That command currently targets `https://hrayem.cz`. It always requires real iPhone/web inputs for the current launch target: `EXPO_PUBLIC_WEB_BASE_URL`, `EXPO_PUBLIC_APP_STORE_URL`, and `HRAYEM_APPLE_TEAM_ID`. It generates `public/.well-known/apple-app-site-association` for Apple/web now, and only generates `public/.well-known/assetlinks.json` when `EXPO_PUBLIC_PLAY_STORE_URL` and `HRAYEM_ANDROID_SHA256_CERT_FINGERPRINTS` are both available for Android launch proof.

The website should also host `public/privacy/index.html`, `public/terms/index.html`, the generated `public/.well-known/` files, and the Expo web build so shared `https://hrayem.cz/event/<id>` links can render the public fallback page for users without the app. The repo now includes a minimal [vercel.json](/home/martin/hrayem/vercel.json) for `/event/*`, `/privacy`, `/terms`, and `/.well-known/*`, but actual hosted proof still depends on a live Vercel deployment serving those paths correctly.

## Build and submit

The repo includes `development`, `preview`, and `production` EAS build profiles in [`eas.json`](/home/martin/hrayem/eas.json).

```bash
pnpm dlx eas-cli build --profile development --platform android
pnpm dlx eas-cli build --profile preview --platform ios
pnpm dlx eas-cli build --profile production --platform all
pnpm dlx eas-cli submit --platform ios
pnpm dlx eas-cli submit --platform android
```

Before production builds, configure `SENTRY_AUTH_TOKEN` in EAS so source maps can upload during the production build profile.

## Project structure

```text
src/
  features/       feature-specific screens and logic
  components/     shared UI building blocks
  hooks/          shared custom hooks
  utils/          pure helpers for env, dates, language, and Supabase retries
  navigation/     typed React Navigation shell, route types, and deep-link helpers
  services/       Supabase and external integration clients
  store/          Zustand stores for auth, user preferences, and UI state
  types/          shared TypeScript types
  i18n/           Czech and English translation files plus i18n bootstrap
  constants/      app-wide constants such as the curated Czech city list
```

## Client infrastructure

- React Query is initialized globally with `staleTime: 30s`, `gcTime: 30m`, and retry defaults for both queries and mutations.
- Zustand stores are split by domain: auth, user, and UI.
- Refresh tokens live in `expo-secure-store`; access tokens stay memory-only in the auth store.
- Supabase auth bootstraps from the persisted refresh token with `supabase.auth.refreshSession({ refresh_token })` on app launch, refreshes once on 401 responses, handles OAuth/password-recovery callbacks through a single app-level `hrayem://auth/callback` listener, and listens to `SIGNED_IN`, `TOKEN_REFRESHED`, `PASSWORD_RECOVERY`, and `SIGNED_OUT`.
- Network connectivity is tracked with NetInfo and surfaced through a persistent offline banner.
- Launch routing is now gated by `app_config` (force update), `consent_log` (terms re-consent), and `profiles.profile_complete` before the authenticated user reaches the current foundation/home entry screen.
- Milestone 3 adds the final bottom-tab shell, typed stack routing, and pending event deep-link replay after auth/profile gating completes.
- Expo push tokens are re-registered on app launch with a per-install ownership key stored in `expo-secure-store`, so the same device can move a token cleanly between accounts without letting another authenticated user take over or delete that token by raw value alone; the app also keeps a tiny local cleanup cache until the backend row is confirmed removed.
- If email confirmation delays the first authenticated session, the accepted terms/privacy versions are captured during registration and materialized into `consent_log` on the first successful sign-in before the user can proceed.
- Sentry initializes at app startup with PII scrubbing and a smoke-test button on the Milestone 0 foundation screen.
- i18n is available from day one with Czech and English resource files and device-language detection.
- Date formatting is centralized in `src/utils/dates.ts` using `date-fns` and `date-fns-tz`.

## Key decisions

- The app config currently uses `com.martingargos.hrayem` for iOS and `app.hrayem` for Android. Confirm both release IDs, the Apple Team ID, and the Android signing fingerprints before the first public store build.
- The Milestone 0 root screen is an infrastructure verification surface, not product UI. It exercises React Query, i18n, offline detection, date formatting, deep-link config, and Sentry wiring in one place.
- The repo is normalized to pnpm because the original WSL environment exposed a broken Windows `npm` shim; the package scripts also force Node `20.19.4` so validation and Expo commands work without a manual `nvm use` in every shell.
- Supabase session persistence follows the Android-safe pattern from `BACKEND.md`: refresh token in secure storage, access token in memory only, refreshed on launch via `refreshSession({ refresh_token })`.
