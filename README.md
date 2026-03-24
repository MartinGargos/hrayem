# Hrayem

Hrayem is a production-oriented mobile app for Czech racket-sport players who want to find or create badminton, padel, and squash games by city, time, venue, and skill level without relying on messaging groups. This repository currently contains Milestone 0: the Expo app foundation, environment setup, and shared client infrastructure that later milestones will build on.

## Tech stack

- React Native `0.83.2`
- Expo SDK `55.0.8`
- React `19.2.0`
- TypeScript `5.9.x` in strict mode
- Supabase JS `2.100.0`
- TanStack Query `5.95.2`
- Zustand `5.0.12`
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
- A Supabase project with the public URL and anon key ready

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

Use Expo Dev Client builds through EAS:

```bash
pnpm dlx eas-cli build --profile development --platform android
pnpm dlx eas-cli build --profile development --platform ios
pnpm run start -- --dev-client
```

Install the generated development build on the device, then connect it to the Metro server started from WSL.

## Supabase setup

Milestone 0 does not yet add the database migrations, seed files, or Edge Functions described in `BACKEND.md`; those land in Milestone 1. The client is already wired to consume the public Supabase URL and anon key.

When the backend assets are added, the expected workflow will be:

```bash
pnpm dlx supabase link --project-ref <project-ref>
pnpm dlx supabase db push
pnpm dlx supabase functions deploy <function-name>
```

Seed data will be applied once the repo contains the Milestone 1 seed files for `sports`, `app_config`, and venues.

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
  navigation/     reserved for the typed navigation shell in Milestone 3
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
- Supabase auth bootstraps from the persisted refresh token with `supabase.auth.refreshSession({ refresh_token })` on app launch and listens to `SIGNED_IN`, `TOKEN_REFRESHED`, and `SIGNED_OUT`.
- Network connectivity is tracked with NetInfo and surfaced through a persistent offline banner.
- Sentry initializes at app startup with PII scrubbing and a smoke-test button on the Milestone 0 foundation screen.
- i18n is available from day one with Czech and English resource files and device-language detection.
- Date formatting is centralized in `src/utils/dates.ts` using `date-fns` and `date-fns-tz`.

## Key decisions

- The app config currently assumes `app.hrayem` for both the iOS `bundleIdentifier` and Android `package`, based on the `hrayem.app` domain. Confirm this before the first store build.
- The Milestone 0 root screen is an infrastructure verification surface, not product UI. It exercises React Query, i18n, offline detection, date formatting, deep-link config, and Sentry wiring in one place.
- The repo is normalized to pnpm because the original WSL environment exposed a broken Windows `npm` shim; the package scripts also force Node `20.19.4` so validation and Expo commands work without a manual `nvm use` in every shell.
- Supabase session persistence follows the Android-safe pattern from `BACKEND.md`: refresh token in secure storage, access token in memory only, refreshed on launch via `refreshSession({ refresh_token })`.
