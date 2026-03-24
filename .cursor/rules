# Repository rules

## Purpose
This repository is for building a production-quality mobile app for iOS and Android.
The goal is to ship a real, polished, maintainable app that is ready for App Store and Google Play submission.
Do not optimize for shortcuts, fake features, or demo-only code.

## Non-negotiable constraints
- Use a single cross-platform codebase.
- Prefer React Native with Expo unless the user explicitly changes the stack.
- TypeScript only — no `any` without a comment explaining why.
- Do not replace the chosen stack unless the user explicitly approves it.
- Keep the app realistic and production-oriented.
- Do not add unnecessary complexity or over-engineer.

## Development environment
- The primary development environment is Cursor + Codex on WSL (Windows Subsystem for Linux).
- **iOS simulators do not run on WSL.** Use EAS Build with a `development` profile for iOS testing, or use a physical Mac for local simulator work.
- **Android emulators work on WSL** via Android Studio — use these for fast local iteration.
- For real-device testing, use Expo Dev Client builds via EAS.

## Product rules
- Follow the app specification (APP.md) exactly.
- Do not invent major features that are not specified.
- Do not silently change product scope, target user, monetization model, or branding.
- If something important is ambiguous, make the smallest reasonable assumption, document it clearly, and move on. Stop and ask only if the ambiguity affects core product scope or architecture — not for implementation details.
- If a decision is high-impact and truly irreversible (e.g. data model, auth approach, navigation structure), stop and ask before proceeding.

## Working style
- Think like a senior mobile engineer shipping a product, not like a demo generator.
- Prefer small, high-confidence steps.
- Keep changes reviewable.
- Before large changes, write a short plan inline or in `PLANS.md`.
- For complex features or major refactors, create or update `PLANS.md` first, then implement from that plan.

### PLANS.md format
When creating or updating `PLANS.md`, include:
1. **Problem** — one sentence on what needs to change and why.
2. **Approach** — the proposed solution and key decisions made.
3. **Steps** — a short ordered list of implementation steps.
4. **Open questions / risks** — anything that could go wrong or needs a follow-up decision.

Keep it concise. A plan is a contract, not an essay.

## Project structure
- Follow the existing folder structure. Do not reorganize without a clear reason.
- If starting fresh with no existing structure, use a feature-based layout:
  ```
  src/
    features/       # one folder per product feature
    components/     # shared, reusable UI
    hooks/          # shared custom hooks
    utils/          # pure functions and helpers
    navigation/     # navigators and route config
    services/       # API clients, storage, external integrations
    store/          # Zustand stores (auth, user, ui)
    types/          # shared TypeScript types and interfaces
    i18n/           # translations (cs.json, en.json) and i18n config
    constants/      # app-wide constants (cities, sport config, etc.)
  ```
- Co-locate tests, styles, and sub-components with the feature they belong to.

## Localization (i18n)
- Use `expo-localization` for detecting the device language.
- Use `i18next` + `react-i18next` for all user-facing strings.
- No hardcoded user-facing strings anywhere — everything goes through the `t()` function from day one.
- Translation files live in `src/i18n/` — one JSON file per language (`cs.json`, `en.json`).
- Set up i18n in Milestone 0 scaffolding so it is never retrofitted.

## Client infrastructure
These patterns are non-negotiable. Set them up in Milestone 0 and use them consistently in every feature.

### State management — Zustand
- Use `zustand` for all global state: auth state, user profile, selected city, language, notification preferences.
- Keep stores small and focused — one per domain (e.g. `useAuthStore`, `useUserStore`, `useUIStore`).
- Persist critical state (selected city, language preference) to `expo-secure-store` using Zustand's `persist` middleware.
- Do not use React Context for shared state beyond the top-level providers (React Query, i18n, navigation).

### Data fetching and caching — TanStack Query (React Query)
- Use `@tanstack/react-query` for all server state: feed, event detail, player lists, chat history, profile data.
- Every screen that loads data must use `useQuery` or `useInfiniteQuery` — never raw `fetch` in `useEffect`.
- Configure `staleTime` sensibly: feed = 30 seconds, event detail = 10 seconds, profile = 5 minutes.
- Use `useMutation` with `onMutate` for optimistic updates on join/leave/thumbs-up.
- Invalidate relevant queries after mutations (e.g. invalidate feed after creating an event).
- This eliminates: blank screen on tab switch, loading flicker on back-navigation, stale data after actions.

### Networking and offline resilience
- Use `@react-native-community/netinfo` to monitor connectivity.
- Show a persistent top-of-screen banner when offline: "You're offline. Some features may be unavailable."
- All mutations (join, leave, send message, create event) must retry with exponential backoff on transient network failures.
- Do not show a generic "Something went wrong" error for network issues — distinguish network errors from server errors and show appropriate copy for each.
- On app foreground: if device is online, silently refetch active queries (React Query handles this with `refetchOnWindowFocus` equivalent via `AppState` listener).

### Auth token lifecycle
- Supabase access tokens expire after ~1 hour. The client must handle this invisibly.
- On app launch: call `supabase.auth.getSession()` to auto-refresh if needed.
- Set up `supabase.auth.onAuthStateChange` listener to catch `TOKEN_REFRESHED` and `SIGNED_OUT` events globally.
- If a refresh fails (refresh token expired): redirect to login with a clear message ("Your session expired. Please log in again."), do not show a crash or cryptic error.
- **expo-secure-store 2KB limit on Android:** Store only the refresh token in `expo-secure-store`. Hold the access token in memory. On app relaunch, use the persisted refresh token to obtain a new access token. This avoids the Android storage size limit for large session objects.

### Supabase Realtime connection management
- Subscribe to Realtime channels on screen mount; unsubscribe on unmount.
- On app foreground (from background): reconnect all active subscriptions — Realtime websockets silently die during background transitions.
- Implement a reconnection strategy: if a channel status becomes `CHANNEL_ERROR` or `TIMED_OUT`, attempt reconnection with backoff.
- Limit concurrent Realtime subscriptions to avoid hitting Supabase connection limits. Only subscribe to event-specific channels when viewing that event's detail or chat.

### Push token re-registration
- Re-register the Expo push token on **every app launch**, not just on login. Tokens can rotate silently (OS updates, app reinstalls).
- On launch: get current token, compare with stored token in Zustand, upsert to `device_tokens` if changed.

### Image loading — expo-image
- Use `expo-image` (not `<Image>` from React Native) for all image rendering: profile photos, avatars in lists, organizer photos.
- `expo-image` provides: automatic disk caching, blur hash placeholders, progressive loading, memory management.
- Set a default placeholder (e.g. a subtle gradient or initials) for missing profile photos.

### Date and time — date-fns
- Use `date-fns` with `date-fns-tz` for all date/time formatting and timezone conversion.
- All dates are stored as UTC `timestamptz` in Supabase. The client converts to the device's local timezone for display using `date-fns-tz`.
- Create a shared utility (`src/utils/dates.ts`) with standard formatters: `formatEventDate`, `formatEventTime`, `formatRelativeTime`, `formatChatTimestamp`.
- Never use `new Date().toLocaleString()` — it produces inconsistent output across devices.

### Form handling — react-hook-form
- Use `react-hook-form` for all forms: create event, profile setup, availability, venue creation, report submission.
- Define Zod schemas for validation (use `@hookform/resolvers/zod` for integration).
- Inline error messages on fields — never silent validation failures.
- Keyboard-aware layout on every form screen using `KeyboardAvoidingView` or `react-native-keyboard-aware-scroll-view`.

### Haptic feedback — expo-haptics
- Use `expo-haptics` for subtle feedback on key actions:
  - `Haptics.notificationAsync(Success)` — join event confirmed, thumbs up given, event created
  - `Haptics.impactAsync(Light)` — tab switch, pull-to-refresh trigger
  - `Haptics.notificationAsync(Warning)` — skill level warning dialog
- Two lines of code per interaction. Massive impact on perceived quality.

### Crash reporting and analytics — Sentry
- Use `@sentry/react-native` (Expo-compatible) for crash reporting and error tracking.
- Initialize in `App.tsx` on startup. Configure source maps via EAS Build.
- Capture: unhandled JS exceptions, native crashes, API errors (4xx/5xx), Realtime connection failures.
- Do NOT send PII to Sentry — scrub user data from error payloads.
- Use breadcrumbs for navigation events and key actions (event created, event joined) to aid debugging.
- For basic product analytics (screen views, key action counts), use `expo-insights` or PostHog React Native SDK.

## Dependencies

### Required dependencies (install in Milestone 0)
| Package | Purpose |
|---|---|
| `@supabase/supabase-js` | Supabase client |
| `@tanstack/react-query` | Data fetching, caching, mutations |
| `zustand` | Global state management |
| `react-hook-form` | Form state and validation |
| `@hookform/resolvers` | Zod integration for react-hook-form |
| `zod` | Schema validation |
| `expo-localization` | Detect device language |
| `i18next` | i18n framework |
| `react-i18next` | React bindings for i18next |
| `expo-secure-store` | Secure token storage |
| `expo-constants` | Runtime env var access |
| `expo-image` | Cached image loading |
| `expo-haptics` | Haptic feedback |
| `expo-linking` | Deep link handling |
| `date-fns` | Date formatting |
| `date-fns-tz` | Timezone conversion |
| `@react-native-community/netinfo` | Network status monitoring |
| `@sentry/react-native` | Crash reporting |

### Additional dependencies (add when needed)
| Package | Purpose | Install in |
|---|---|---|
| `expo-notifications` | Push notification handling | Milestone 9 |
| `expo-location` | GPS for city detection | Milestone 2 |
| `expo-camera` / `expo-image-picker` | Profile photo capture | Milestone 2 |
| `expo-calendar` | Add events to device calendar | Milestone 5 |

- Prefer well-known, actively maintained libraries.
- Do not add a new production dependency unless it clearly improves speed, quality, or maintainability over a reasonable hand-rolled solution.
- Before adding a dependency, check: Is it Expo-compatible? Is it actively maintained? Does it have TypeScript types?

## Code quality
- Write clean, readable, strongly typed code.
- Prefer simple architecture and predictable state management.
- Avoid dead code, placeholders, fake mocks in production paths, and TODO spam.
- Keep components modular and reusable.
- Use clear, intention-revealing names — avoid abbreviations unless universally obvious.
- Do not duplicate logic when a shared utility, hook, or component is more appropriate.
- Add code comments only when the *why* is non-obvious. Do not comment the *what*.

## Error handling
- Surface errors to the user in a clear, actionable way (e.g. toast, inline message). Do not silently swallow them.
- Distinguish between **network errors** ("You're offline — check your connection"), **server errors** ("Something went wrong — try again"), and **validation errors** (inline field messages).
- Log errors with enough context to debug, but never log sensitive user data.
- Use typed error handling — avoid bare `catch (e: any)`.
- Send unexpected errors to Sentry with breadcrumb context.

## UX and product quality
- Mobile UX must feel polished.
- Prioritize clarity, speed, and reliability.
- Handle loading, empty, error, and offline states on every screen.
- Use accessible labels (`accessibilityLabel`, `accessibilityHint`) and sensible touch targets (minimum 44×44pt).
- Avoid default-feeling UI when a better simple solution is easy to achieve.
- All user-facing strings go through i18n.
- Use `KeyboardAvoidingView` on every screen with text inputs — not just chat.
- Use haptic feedback on key actions (see Client Infrastructure above).

## Expo and native modules
- Stay in Expo managed workflow by default.
- If a feature requires a bare workflow or a native module not supported by Expo, flag it explicitly before proceeding.
- Prefer Expo SDK APIs and Expo-compatible libraries. Check `expo-doctor` compatibility before adding new native dependencies.

## Security and data handling
- Never hardcode secrets, API keys, tokens, passwords, or credentials — not even in comments or example values.
- Use environment variables for secrets; use `expo-constants` or a `.env` approach consistent with the project.
- Never commit real environment variable values. Commit `.env.example` with placeholders only, including `EXPO_PUBLIC_*` values.
- Do not log sensitive user data (PII, tokens, passwords).
- Do not send PII to Sentry or any analytics service.
- Validate and sanitize inputs. Handle failures safely and explicitly.

## Testing and validation
Before declaring a task done:
- Run lint: `npm run lint`
- Run typecheck: `npm run typecheck`
- Run tests if they exist: `npm test`
- Run Expo doctor if dependencies changed: `npx expo-doctor`
- If tests do not exist for changed core logic, add targeted tests where reasonable.
- Verify the app still builds.

If command names differ from defaults, detect and use the repo's actual scripts.

## Definition of done
A task is done only when:
- the requested behavior works correctly,
- the code is consistent with these repo rules,
- obvious edge cases (empty state, error state, loading state, offline state) are handled,
- all validation steps were run and passed,
- and a short summary of what changed is provided.

"It compiles" is not done. "It works in the happy path" is not done. Done means done.

## Output format for each substantial task
After substantial work, report:

```
### Summary
[One sentence on what changed and why]

### Files changed
[List of files added, modified, or deleted]

### Commands run
[Lint / typecheck / test output — pass or fail, with any relevant details]

### Assumptions and risks
[Any assumptions made, open questions, or known risks]
```

## What to avoid
- Giant speculative refactors.
- Rewriting working code without a strong, stated reason.
- Introducing backend requirements that were not requested.
- Fake or stubbed implementations presented as complete.
- Skipping validation and claiming success.
- Reorganizing folder structure mid-feature without a plan.
- Adding dependencies to solve problems that don't exist yet.

## App Store readiness
The app must be submittable to the App Store and Google Play at any point — not retrofitted at the end.
- Set `bundleIdentifier` (iOS) and `package` (Android) from day one. Never change them after the first build.
- All required permission usage description strings must be in `app.json` / `app.config.js` from the first build that uses those permissions (`NSLocationWhenInUseUsageDescription`, `NSCameraUsageDescription`, `NSPhotoLibraryUsageDescription`, `NSCalendarsFullAccessUsageDescription`).
- Apple Sign In must be implemented if any other OAuth provider (e.g. Google) is offered.
- Account deletion from within the app is required by Apple. Do not skip this.
- Push notification permission must be requested with a meaningful usage description.
- Never ship placeholder content, lorem ipsum, or hardcoded demo data in a production build.
- Use EAS Build for all store builds. Use `development`, `preview`, and `production` profiles in `eas.json` from the start.
- App icons and splash screens must be provided at all required sizes using Expo's asset pipeline.
- Privacy Policy URL must be referenced in `app.json` and accessible at a real URL before submission.
- Configure associated domains (iOS) and app links (Android) for deep linking from day one.

## README maintenance
`README.md` must exist and stay accurate at all times.

The README must always include:
- **What the app is** — one paragraph, plain language
- **Tech stack** — React Native + Expo + Supabase, with versions
- **Prerequisites** — Node version, Expo CLI, EAS CLI, environment variables needed
- **Development environment** — WSL setup notes, iOS limitations, Android emulator instructions
- **Environment setup** — how to create `.env` and what each variable is for (no actual values)
- **How to run locally** — exact commands from clone to running on a simulator/device
- **How to run on a real device** — Expo Dev Client or EAS dev build instructions
- **Supabase setup** — how to apply migrations, seed data, and deploy Edge Functions
- **Build and submit** — EAS build commands for development, preview, and production profiles
- **Project structure** — brief description of the `src/` folder layout
- **Client infrastructure** — brief notes on React Query, Zustand, Sentry, auth refresh strategy
- **Key decisions** — a short bullet list of non-obvious architectural choices

Update the README whenever any of the above changes. Do not let it drift from reality.

## Git hygiene
- Make focused commits with clear, imperative messages (`Add login screen`, not `stuff`).
- Do not commit broken builds knowingly.
- Make a checkpoint commit before any major refactor.
- Keep PRs/commits scoped — one logical change per commit where possible.

## If the repo is empty
If starting from an empty repo:
1. Scaffold the minimal correct project structure using `npx create-expo-app` or equivalent.
2. Apply the folder structure from the **Project structure** section.
3. Install all Milestone 0 dependencies from the table above.
4. Set up i18n (`i18next` + `react-i18next` + `expo-localization`) with initial translation files.
5. Set up React Query provider, Zustand stores (auth, user), Sentry initialization.
6. Set up Supabase client with auth state listener and token refresh.
7. Set up `@react-native-community/netinfo` provider with offline banner component.
8. Create shared utilities: `src/utils/dates.ts`, `src/utils/supabase.ts`.
9. Configure deep link URI scheme in `app.json`.
10. Keep setup conventional and minimal — no optional extras unless they clearly support the requested app.
11. Run `npx expo-doctor` and resolve any issues before writing product code.
