# Hrayem

Hrayem is a production-oriented mobile app for Czech racket-sport players who want to find or create badminton, padel, and squash games by city, time, venue, and skill level without relying on messaging groups. This repository currently includes the Milestone 0 Expo client foundation, the proven Milestone 1 Supabase schema, the Milestone 2 authentication/session-resilience flow, the Milestone 3 typed navigation shell, and the Milestone 4 venue search, event creation, feed, and event-detail foundation.

Milestone 0 is complete in code, but real-device proof is still pending until Apple Developer activation is available again. The remaining deferred checks are iOS dev-build install, offline banner verification on device, CZ/EN switching on device, React Query dummy cache proof on device, Sentry dashboard capture, and deep-link opening on a real install.

## Tech stack

- React Native `0.83.2`
- Expo SDK `55.0.8`
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

Server-only variables reserved for Edge Functions:

- `SUPABASE_SERVICE_ROLE_KEY`: Supabase service role key
- `EXPO_PUSH_ACCESS_TOKEN`: Expo push service token
- `UPSTASH_REDIS_REST_URL`: Upstash Redis REST endpoint
- `UPSTASH_REDIS_REST_TOKEN`: Upstash Redis REST token
- `ADMIN_REPORT_EMAIL`: destination for report notifications

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

Use this workflow once `.env` contains real `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` values:

```bash
pnpm dlx supabase login
pnpm dlx supabase link --project-ref <project-ref>
pnpm dlx supabase db push
pnpm dlx supabase functions deploy events
pnpm run verify:milestone1
pnpm run verify:milestone4
```

Apply the versioned seed file in `supabase/seed.sql` immediately after the migrations as part of the same Supabase deployment workflow. The Milestone 4 event-creation flow now depends on the deployed `events` Edge Function.

For Milestone 2 auth flows, also configure these Supabase Auth settings:

- Add `hrayem://auth/callback` to the Auth redirect URL allow list.
- Configure the Apple and Google providers in Supabase Auth.
- Use an EAS development build for real OAuth and push-token testing; the app now includes `expo-notifications`, `expo-location`, `expo-image-picker`, `expo-image-manipulator`, and `expo-web-browser`.

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
- Expo push tokens are re-registered on app launch and claimed in `device_tokens` by token value so the same physical device token moves cleanly between accounts; the app also keeps a tiny local cleanup cache until the backend row is confirmed removed.
- If email confirmation delays the first authenticated session, the accepted terms/privacy versions are captured during registration and materialized into `consent_log` on the first successful sign-in before the user can proceed.
- Sentry initializes at app startup with PII scrubbing and a smoke-test button on the Milestone 0 foundation screen.
- i18n is available from day one with Czech and English resource files and device-language detection.
- Date formatting is centralized in `src/utils/dates.ts` using `date-fns` and `date-fns-tz`.

## Key decisions

- The app config currently assumes `app.hrayem` for both the iOS `bundleIdentifier` and Android `package`, based on the `hrayem.app` domain. Confirm this before the first store build.
- The Milestone 0 root screen is an infrastructure verification surface, not product UI. It exercises React Query, i18n, offline detection, date formatting, deep-link config, and Sentry wiring in one place.
- The repo is normalized to pnpm because the original WSL environment exposed a broken Windows `npm` shim; the package scripts also force Node `20.19.4` so validation and Expo commands work without a manual `nvm use` in every shell.
- Supabase session persistence follows the Android-safe pattern from `BACKEND.md`: refresh token in secure storage, access token in memory only, refreshed on launch via `refreshSession({ refresh_token })`.
