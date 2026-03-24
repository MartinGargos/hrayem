# Hrayem — Build Milestones

This file defines the build order for Hrayem MVP. Work through milestones sequentially.
Do not start a milestone until all previous milestones are complete and validated.
Each milestone ends with a checkpoint — a working, testable state of the app.

---

## Why this order

The sequence is designed so that:
- Every milestone builds on a solid, tested foundation
- Each stage produces something real you can open and interact with
- High-risk, hard-to-change pieces (auth, data model, navigation, client infrastructure) are locked in early
- Features that depend on each other are never built in the wrong order
- The venues table is established early (Milestone 1) because it's a structural decision that affects events, the feed, and the future B2B product
- Client infrastructure (React Query, Zustand, Sentry, networking) is scaffolded in Milestone 0 so every feature built after uses it consistently

---

## Milestone 0 — Project foundation and client infrastructure
> Goal: a clean, runnable project skeleton with all infrastructure wired up. Nothing structural changes after this.

### Project scaffold
- [ ] Scaffold with `npx create-expo-app` (TypeScript template)
- [ ] Apply the `src/` folder structure from `AGENTS.md` (including `src/store/`, `src/i18n/`, `src/constants/`, `src/utils/`)
- [ ] Configure `app.json`: app name (Hrayem), `bundleIdentifier`, `package`, version 1.0.0, build 1
- [ ] Add all permission usage description strings (`NSLocationWhenInUseUsageDescription`, `NSCameraUsageDescription`, `NSPhotoLibraryUsageDescription`, `NSCalendarsFullAccessUsageDescription`, push notifications)
- [ ] Configure deep link URI scheme in `app.json`: `scheme: "hrayem"`; add `associatedDomains` (iOS) and `intentFilters` (Android) for `hrayem.app`
- [ ] Set up ESLint + Prettier + TypeScript strict mode
- [ ] Set up EAS: `eas.json` with `development`, `preview`, `production` profiles
- [ ] Set up `.env` with all env vars from `BACKEND.md` section 13; add `.env` to `.gitignore`; commit `.env.example` (including `EXPO_PUBLIC_SENTRY_DSN`, `EXPO_PUBLIC_TERMS_VERSION`, `EXPO_PUBLIC_PRIVACY_VERSION`)
- [ ] Set up `expo-constants` for runtime env var access

### Install all Milestone 0 dependencies
- [ ] `@supabase/supabase-js` — Supabase client
- [ ] `@tanstack/react-query` — data fetching, caching, mutations
- [ ] `zustand` — global state management
- [ ] `react-hook-form` + `@hookform/resolvers` + `zod` — form handling and validation
- [ ] `i18next` + `react-i18next` + `expo-localization` — i18n
- [ ] `expo-secure-store` — secure token storage
- [ ] `expo-image` — cached image loading
- [ ] `expo-haptics` — haptic feedback
- [ ] `expo-linking` — deep link handling
- [ ] `date-fns` + `date-fns-tz` — date formatting and timezone conversion
- [ ] `@react-native-community/netinfo` — network status monitoring
- [ ] `@sentry/react-native` — crash reporting

### Client infrastructure wiring
- [ ] **Supabase client** (`src/services/supabase.ts`): initialize with env vars; set up `onAuthStateChange` listener that updates Zustand auth store on `TOKEN_REFRESHED`, `SIGNED_OUT`, `SIGNED_IN`
- [ ] **Auth token strategy**: store only refresh token in `expo-secure-store` (Android 2KB limit); hold access token in memory via Zustand; on app launch, read refresh token → call `supabase.auth.refreshSession({ refresh_token })` to get a fresh access token
- [ ] **React Query provider**: wrap app in `QueryClientProvider`; configure default `staleTime: 30_000`, `gcTime: 1_800_000`, `retry: 2`
- [ ] **Zustand stores**: create `useAuthStore` (session state, refresh token, push token), `useUserStore` (profile, selected city, language), `useUIStore` (offline status)
- [ ] **Network monitoring** (`src/components/OfflineBanner.tsx`): initialize `@react-native-community/netinfo` listener; update `useUIStore.isOffline`; render persistent top banner when offline
- [ ] **Sentry initialization**: call `Sentry.init()` in App.tsx with DSN from env; configure source maps upload in `eas.json` production profile; verify test error is captured
- [ ] **Date utilities** (`src/utils/dates.ts`): create `formatEventDate`, `formatEventTime`, `formatRelativeTime`, `formatChatTimestamp` using `date-fns` + `date-fns-tz`
- [ ] **i18n setup**: create `src/i18n/cs.json`, `src/i18n/en.json` with initial structure; configure language detection from device via `expo-localization`
- [ ] Create `src/constants/cities.ts` with the curated Czech city list from `APP.md` section 8.1

### Final checks
- [ ] Write `README.md` with setup instructions (Milestone 0 scope only), including WSL dev environment notes and client infrastructure overview
- [ ] Run `pnpm run doctor` — all checks pass
- [ ] App opens on Android emulator (WSL) or via EAS dev build (iOS)

**Checkpoint:** App runs on a device or emulator. React Query is wired (verify: a dummy `useQuery` caches correctly). Zustand stores exist. Sentry captures a test error in the dashboard. Offline banner appears when network is disabled. Date formatters produce correct local-timezone output. i18n switches between CZ and EN. Deep link scheme is registered. `expo-doctor` is clean. README covers setup.

---

## Milestone 1 — Supabase foundation
> Goal: database schema is live, migrations are versioned, seed data is in. Venues table and app config ready from day one.

- [ ] Write all migration files in order:
  - `profiles` (with nullable `first_name`, `last_name`; `profile_complete` flag), `device_tokens`, `sports`, `venues`, `user_sports`
  - `events` (with `venue_id` FK, `chat_closed_at`), `event_players`
  - `chat_messages`, `no_show_reports`, `post_game_thumbs`, `player_availability`
  - `notification_log`, `notification_preferences`
  - `reports`
  - `app_config`, `consent_log`
- [ ] Apply all Postgres constraints and `CHECK` clauses exactly as specified in `BACKEND.md`
- [ ] Write and apply all indexes from `BACKEND.md` section 8 (including venues, thumbs, availability indexes)
- [ ] Write and apply all triggers from `BACKEND.md` section 9:
  - `set_updated_at` (applied to: profiles, events, user_sports, event_players, device_tokens, notification_preferences, venues, app_config)
  - `handle_new_user` (creates profile row with NULLs on signup)
  - `check_profile_complete` (auto-sets `profile_complete` when required fields are filled)
  - `handle_no_show_report` (increments no-show counter)
- [ ] Create `event_feed_view` from `BACKEND.md` section 3.1 (joins venues, includes organizer stats)
- [ ] Enable RLS on all tables with policies from `BACKEND.md` section 4, including:
  - `user_sports` column-level restriction (client can only update `skill_level`)
  - `profiles` protected columns (`is_deleted`, `profile_complete` not client-writable)
  - `venues` insert-only for authenticated users
  - `player_availability` own-rows CRUD
  - `post_game_thumbs` read for all authenticated, write via service role only
  - `app_config` read for any authenticated, write service role only
  - `consent_log` read own rows, insert own rows only
- [ ] Run seed data (`sports` table + `app_config` minimum version values)
- [ ] Seed initial venues for Ostrava (known sports facilities — see `APP.md` section 15.2)
- [ ] Verify: query the `event_feed_view` — returns empty result, no errors
- [ ] Verify: insert a test user → `profiles` row auto-created with `profile_complete = false`
- [ ] Verify: update `first_name`, `last_name`, `city` → `profile_complete` flips to `true`
- [ ] Verify: attempt to update `games_played` on `user_sports` via anon key → rejected by RLS
- [ ] Verify: authenticated user can insert a venue but cannot update or delete it
- [ ] Verify: `app_config` readable by authenticated user, not writable

**Checkpoint:** Full schema is live including `app_config` and `consent_log`. RLS is enabled and tested. Venues table is seeded. `app_config` has minimum version values. All queries return expected shapes.

---

## Milestone 2 — Authentication and session resilience
> Goal: a user can register, log in, stay logged in reliably, and accept terms. Profile setup gates access to the main app.

### Auth screens
- [ ] Login screen: email + password, Apple Sign In, Google Sign In
- [ ] Register screen: email + password
  - **Terms checkbox:** "I agree to the [Terms of Service] and [Privacy Policy]" with tappable links — registration button disabled until checked
  - On successful registration: insert row into `consent_log` with current `EXPO_PUBLIC_TERMS_VERSION` and `EXPO_PUBLIC_PRIVACY_VERSION`
- [ ] Forgot Password screen: email input → reset link sent

### Profile setup
- [ ] Post-registration: profile setup screen (first name, last name, city picker, language picker, optional photo)
- [ ] GPS permission request on profile setup; auto-detect nearest city and pre-select in picker
- [ ] **Profile completion gate:** user cannot access main app until `profile_complete = true`
  - On every authenticated route, check the profile; if incomplete, redirect to setup screen
- [ ] All forms use `react-hook-form` + Zod validation with inline error messages
- [ ] Keyboard-aware layout on profile setup form

### Session resilience
- [ ] **Token storage strategy:** store refresh token in `expo-secure-store`; hold access token in Zustand (memory only)
- [ ] **App launch flow:** read refresh token from secure store → `supabase.auth.refreshSession({ refresh_token })` → obtain a fresh access token → populate Zustand
- [ ] **Silent token refresh:** `onAuthStateChange` listener catches `TOKEN_REFRESHED` and updates Zustand — user never sees a login screen mid-session
- [ ] **Expired refresh token handling:** if no refresh token exists or `refreshSession()` fails → redirect to login with clear message ("Your session expired. Please log in again.") — no crash, no blank screen
- [ ] **401 retry:** if any API call returns 401, trigger `supabase.auth.refreshSession()`, then retry the original request once
- [ ] Session persistence test: close and reopen app after 5 minutes — user is still logged in without any flash

### Push token
- [ ] **Push token re-registration on every app launch:** call `Notifications.getExpoPushTokenAsync()`, compare with token in Zustand, upsert to `device_tokens` if changed
- [ ] On logout: delete the token row from `device_tokens` and clear from Zustand

### Force update and terms check (on launch)
- [ ] **Version check on launch:** query `app_config` for `minimum_app_version_{platform}`; if running version is below → show force update screen (section 11.15 of APP.md); block all navigation
- [ ] **Terms version check on launch:** query `consent_log` for the user's latest accepted version; if it's below `EXPO_PUBLIC_TERMS_VERSION` → show terms re-consent screen before proceeding

### Auth state routing
- [ ] Unauthenticated → auth screens
- [ ] Authenticated + terms outdated → terms re-consent screen
- [ ] Authenticated + incomplete profile → profile setup
- [ ] Authenticated + complete → home
- [ ] Logout clears session, device token, and all Zustand stores
- [ ] All auth error states handled with clear user-facing messages
- [ ] All strings on auth screens go through i18n

**Checkpoint:** Full auth loop works end-to-end. Register → accept terms (consent logged) → profile setup → home. Close app for 5 minutes → reopen → still logged in, no flash. Force-close app → reopen → still logged in (refresh token flow works). Set `minimum_app_version_ios` above current → force update screen blocks. Apple Sign In and Google Sign In work on real device. Logout → back to login, all state cleared.

---

## Milestone 3 — Navigation shell
> Goal: all top-level screens exist and are reachable; navigation structure is final.

- [ ] Bottom tab navigator: Home feed, Create event (+), My games, Profile
- [ ] Stack navigators within each tab as needed
- [ ] Home feed has two sub-tabs: "Upcoming games" (default) and "Available players"
- [ ] All screens exist as stubs (correct title, correct layout, placeholder content via i18n keys)
- [ ] Navigation types are fully typed (React Navigation TypeScript setup)
- [ ] Deep link routing implemented: `hrayem://event/{id}` and `hrayem.app/event/{id}` → Event detail screen (store pending deep link in Zustand if user isn't logged in; navigate after auth)
- [ ] Profile completion gate enforced on all main screens
- [ ] **App foreground refresh:** set up `AppState` listener that triggers React Query refetch on app foreground (`active` state); all stale queries refresh silently in background

**Checkpoint:** Every screen in `APP.md` section 11 is reachable by tapping through the app. Home feed has both tabs. Deep link `hrayem://event/test-id` navigates to event detail stub. Background/foreground transition triggers data refetch. No navigation errors. Types are clean. This structure does not change after this milestone.

---

## Milestone 4 — Venue system, event creation, feed, and sharing
> Goal: venues are searchable, events reference venues, the feed shows real data with pagination, and events are shareable.

- [ ] **Venue picker component:**
  - Search field queries `venues` table filtered by user's city (via React Query `useQuery` with debounced search term)
  - Shows matching venues as user types
  - If no match: "Add new venue" option opens inline form (name, address) — validated via `react-hook-form`
  - New venue is inserted via direct PostgREST (allowed by RLS insert policy)
  - Selected venue auto-fills venue name on event card
- [ ] Create event screen — full form with all fields from `APP.md` section 6.1
  - All fields validated via `react-hook-form` + Zod schema
  - Sport selector (icon-based)
  - Court status toggle
  - Date + time pickers (native, stored as UTC, displayed via `date-fns-tz`)
  - **Venue picker** (replaces free-text venue name)
  - Player count stepper (2–20)
  - Skill range picker with helper text
  - Optional description with character counter
  - Keyboard-aware layout on the entire form
  - Disabled submit until all required fields valid
  - **Haptic feedback** on successful event creation
- [ ] **Skill level selection modal** — if user has no `user_sports` row for the selected sport, show the modal before allowing event creation
- [ ] `POST /v1/events` Edge Function — create event with `venue_id`; denormalize city from venue; insert organizer as confirmed; return `SKILL_LEVEL_REQUIRED` if no sport profile
- [ ] Home feed screen — queries `event_feed_view` via **React Query `useInfiniteQuery`**
  - "Upcoming games" tab: filter by user's city, all sports, next 7 days by default
  - **Infinite scroll pagination:** load 20 events per page, load more on scroll, stop when page returns < 20
  - Sport + date range filters (changing filters invalidates and re-fetches the query)
  - Event cards show venue name (from venue record), all fields from `APP.md` section 11.3
  - All dates/times formatted via `date-fns-tz` (local timezone)
  - All profile photos rendered via `expo-image` (disk-cached, blur placeholder)
  - Pull to refresh (with haptic feedback on trigger)
  - Empty state
  - **Foreground refresh:** when app returns from background, feed silently refreshes (stale-while-revalidate — no loading spinner, old data shows until new data arrives)
- [ ] Event detail screen — full read-only view from `APP.md` section 11.4
  - Data fetched via React Query `useQuery` (cached; instant on back-navigation)
  - Venue name + address from venue record
  - Organizer shown with no-show count and games played for that sport
  - Confirmed players list with skill badges (avatars via `expo-image`)
  - Skill range note visible
  - **Share button:** opens native share sheet with `https://hrayem.app/event/{id}` + share text (see APP.md section 6.9)
- [ ] **Deep link handling:** `hrayem.app/event/{id}` opens event detail screen; if user has app → direct open; if not → web fallback page (deployed in Milestone 11)
- [ ] All strings go through i18n

**Checkpoint:** Create an event by selecting a venue → event appears in feed with correct venue name → tap to see full detail with venue address. Feed paginates (create 25+ events, verify infinite scroll loads more). Share button opens share sheet with correct link. Deep link from another app opens event detail. Add a new venue during event creation → it's available for future events. Skill level modal appears on first sport interaction. Filters work. Background/foreground: feed refreshes without spinner.

---

## Milestone 5 — Joining, leaving, and waitlist
> Goal: the core game-joining loop works, including race condition safety and waitlist promotion.

- [ ] "I want to play" button on event detail
  - Shows correct state: Join / Confirmed / Waitlisted / Organizer
  - **Skill level modal** triggered if no `user_sports` row
  - Skill level soft warning dialog if outside range (clear copy from APP.md section 6.2)
  - **Haptic feedback** on join confirmation
- [ ] `POST /v1/events/:id/join` Edge Function — with `FOR UPDATE` lock, UPSERT, status logic, `SKILL_LEVEL_REQUIRED` response
- [ ] `POST /v1/events/:id/leave` Edge Function — with waitlist promotion
- [ ] **Add to calendar:** "Add to calendar" button on event detail and My Games Upcoming tab; uses `expo-calendar` to create a native calendar event with sport, venue name, date/time; request calendar permission with clear usage description; available for confirmed players and organizer
- [ ] **Optimistic updates:** use React Query `useMutation` with `onMutate` — button state updates immediately; rolls back on server error
- [ ] Real-time player list updates (Supabase Realtime on `event_players`; subscribe on mount, unsubscribe on unmount)
- [ ] Waitlist count shown (not individual identities)
- [ ] Event status (`active` → `full`) updates in real-time
- [ ] Waitlist position shown to waitlisted player
- [ ] My games screen — Upcoming tab shows events I'm confirmed for or organizing (via React Query)

**Checkpoint:** Two test accounts. Account A creates event (2 total). Account B joins — both see "Confirmed" (B's button updates optimistically before server confirms). Account B leaves — spot opens. Two accounts race to join a 1-spot event — only one confirmed, other waitlisted. Skill level modal and soft warning work correctly. Real-time updates work across devices. "Add to calendar" creates a correct native calendar event with sport, venue, and time.

---

## Milestone 6 — Organizer controls
> Goal: organizers can fully manage their events.

- [ ] `PATCH /v1/events/:id` Edge Function (edit-event) — all constraints:
  - Cannot edit `finished` or `cancelled` events
  - Cannot reduce `player_count_total` below confirmed count
  - Venue change updates denormalized city
  - All validation from `create-event`
- [ ] Edit event screen — pre-filled form (via `react-hook-form` `defaultValues`); venue picker for venue changes; keyboard-aware layout
- [ ] Remove a player from event (player notified, waitlist promoted)
- [ ] Cancel event — all players notified; chat immediately read-only
- [ ] My games screen — "Organizing" vs "Playing" visual distinction
- [ ] `POST /v1/events/:id/cancel` Edge Function
- [ ] After mutations: invalidate relevant React Query caches (event detail, feed, my games)

**Checkpoint:** Organizer can edit all editable fields including venue. Cannot reduce player count below confirmed. Can remove a player (waitlist promotes). Can cancel (all notified, chat read-only). Organizer cannot remove themselves.

---

## Milestone 7 — Scheduled jobs, statistics, and post-game actions
> Goal: events finish automatically; stats update; no-show and thumbs-up systems work.

- [ ] `finish-event` Supabase cron job (every 10 minutes):
  - Pass 1: send 2-hour reminders (`reminder_sent` flag)
  - Pass 2: finish events past `ends_at`; set `no_show_window_end`, `chat_closed_at`; upsert `user_sports` stats
  - Pass 3: clean up expired `player_availability` rows
- [ ] `games_played` and `hours_played` increment correctly on finish
- [ ] My games Past tab shows finished events
- [ ] Profile screen shows updated stats per sport
- [ ] **Skill level editing:** profile screen allows tapping the skill badge to change level
- [ ] `report-no-show` Edge Function — within 24h window; validates ≥ 2 confirmed (excl. organizer)
- [ ] My games Past tab — organizer sees "Report no-show" action within window
- [ ] `no_shows` counter visible on player profile and event detail
- [ ] **Post-game thumbs up:**
  - `POST /v1/events/:id/thumbs-up` Edge Function — validates event finished, within 48h, both users confirmed, no self-thumbs, no duplicates
  - My Games Past tab shows thumbs-up prompt: row of co-player avatars with 👍 button under each
  - **Haptic feedback** on thumbs-up tap
  - Event detail (finished) also shows thumbs-up card
  - Thumbs up is one-tap, no undo, anonymous to the recipient
  - **Optimistic update:** button immediately shows as tapped (via `useMutation` + `onMutate`)
- [ ] **Thumbs-up percentage** displayed on profile per sport (only after 3+ games)
- [ ] **Play-again connections:**
  - Compute mutual thumbs-up check (query from `BACKEND.md` section 3.3)
  - Show play-again indicator (subtle icon/ring) next to connected players on: event detail player list, availability list, profile screen connections section
  - Profile screen shows "Play again" section listing all mutual connections grouped by sport

**Checkpoint:** Create event ending 1 minute from now. Cron fires → event finishes → stats increment. Organizer can report no-show (only if ≥ 2 others confirmed). Two test users give each other thumbs up (haptic fires, button updates instantly) → play-again indicator appears on both profiles and in shared events. Thumbs-up % shows correctly after 3+ games. Expired availability is cleaned up.

---

## Milestone 8 — Chat
> Goal: confirmed players can message each other in real-time, with correct lifecycle behavior.

- [ ] Chat screen — standard layout from `APP.md` section 11.7
- [ ] `POST /v1/events/:id/messages` Edge Function — access check, chat window check, insert, Realtime broadcast
- [ ] RLS verified: only organizer + confirmed players can read/subscribe
- [ ] **Supabase Realtime subscription** on `chat_messages` for the event:
  - Subscribe on screen mount; unsubscribe on unmount
  - On app foreground: check channel status; reconnect if `CHANNEL_ERROR` or `TIMED_OUT`; fetch missed messages via React Query refetch
- [ ] Messages appear instantly for all participants
- [ ] Chat button only visible for confirmed + organizer
- [ ] Waitlisted players cannot access chat
- [ ] Keyboard-aware layout (input stays above keyboard on iOS and Android)
- [ ] Timestamps on messages (formatted via `date-fns`)
- [ ] Avatars rendered via `expo-image` (cached)
- [ ] **Finished events:** 48h countdown banner; after 48h, read-only
- [ ] **Cancelled events:** immediate read-only

**Checkpoint:** Two confirmed accounts open the same event chat simultaneously. Messages from one appear instantly on the other. Put the app in background for 2 minutes, return → messages sent during background are visible (reconnection + catch-up works). Waitlisted account cannot access chat. After event finishes, chat stays writable for 48h then becomes read-only. Cancelled event chat is immediately read-only.

---

## Milestone 9 — Push notifications, rate limiting, and availability
> Goal: notifications work, endpoints are protected, and the availability system is live.

- [ ] Push token registration: already set up in Milestone 2 (re-registers on every launch); verify it works end-to-end
- [ ] Notification permission request with meaningful usage description
- [ ] Push fan-out helper in Edge Functions (sends to all `device_tokens` for a user; respects `notification_preferences`)
- [ ] Implement all 8 notification types from `APP.md` section 10
- [ ] Tapping a notification navigates to the correct screen (deep linking from Milestone 3)
- [ ] Notification preferences screen — on/off per type
- [ ] Persist settings in `notification_preferences`
- [ ] Log all sent notifications to `notification_log`
- [ ] **Rate limiting:** Set up Upstash Redis; implement sliding window rate limiter in a shared Edge Function utility; apply to all write endpoints per `BACKEND.md` section 12
- [ ] Verify: exceeding rate limit returns HTTP 429 with `RATE_LIMITED` error code
- [ ] **Player availability system:**
  - "I'm available" screen (APP.md section 11.11): form via `react-hook-form`, sport picker, date picker, time preference, optional note
  - Post availability → row(s) in `player_availability` (direct PostgREST via React Query `useMutation`, allowed by RLS)
  - Date range selection expands to individual rows per date (client-side batch upsert)
  - Update existing availability for same sport + date (UPSERT)
  - Delete own availability
  - "Available players" tab on Home feed: queries `player_availability` via React Query, filtered by city + sport
  - Each card shows player info, skill badge, dates, time preference, games played (avatars via `expo-image`)
  - Play-again indicator on availability cards for mutual connections
  - Empty state with CTA to post availability

**Checkpoint:** Push notifications work on real device for all 8 types. Each has correct copy and tapping opens the right screen. Notification preferences toggle works. Rate limiting returns 429. Post availability → appears in Available players tab for same-city users. Update and delete availability work. Play-again indicator shows on availability cards. Expired availability disappears after cron runs.

---

## Milestone 10 — Polish, reporting, and hardening
> Goal: the app feels finished. Every screen handles every state. Nothing is embarrassing.

### Reporting
- [ ] `POST /v1/reports` Edge Function — validates, inserts, sends admin email
- [ ] "Report event" in overflow menu on event detail
- [ ] "Report player" in overflow menu on player profile snippet
- [ ] Confirmation message after reporting
- [ ] Duplicate report prevention

### State handling
- [ ] Every screen has correct loading state (skeleton or spinner — not blank flash)
- [ ] Every screen has correct empty state with helpful copy
- [ ] Every screen has correct error state with retry action
- [ ] **Offline state:** cached data displays correctly when offline; write actions show "You're offline" message; offline banner visible
- [ ] All forms validate inline with clear error messages (react-hook-form + Zod)
- [ ] Network errors distinguished from server errors — appropriate copy for each
- [ ] All touch targets ≥ 44×44pt
- [ ] All interactive elements have `accessibilityLabel` and `accessibilityHint`

### Polish
- [ ] CZ / EN language switching works across all screens (all strings through i18n)
- [ ] No hardcoded strings (audit all components for raw text)
- [ ] All keyboard inputs have keyboard-aware layout (not just chat)
- [ ] Haptic feedback on all key actions: join confirmed, thumbs up, event created, pull-to-refresh, tab switch
- [ ] Profile photo upload: resize → compress → upload → display (via `expo-image` with cache invalidation)
- [ ] Account deletion end-to-end (including availability, thumbs-up, consent_log cleanup)
- [ ] App icons and splash screens at all required sizes
- [ ] Remove all `console.log` from production paths
- [ ] Verify Sentry is capturing errors in production build (trigger a test error, confirm it appears in dashboard)
- [ ] Full lint + typecheck — zero errors, zero warnings
- [ ] Test on a real iOS device and a real Android device

**Checkpoint:** Walk through every screen as a real user. Every state (loading, empty, error, offline, happy path) behaves correctly. Reporting works (admin receives email). Offline banner appears and cached data is readable. No placeholder content anywhere. App icons correct on home screen. Sentry shows captured errors.

---

## Milestone 11 — Pre-submission and launch readiness
> Goal: the app is ready to submit, deep links work, and the community is seeded for launch.

### Documentation and config
- [ ] `README.md` is complete and accurate (including WSL notes, Upstash setup, venue seeding, Sentry setup, client infrastructure overview)
- [ ] All environment variables documented in `.env.example` (including `EXPO_PUBLIC_SENTRY_DSN`, `EXPO_PUBLIC_TERMS_VERSION`, `EXPO_PUBLIC_PRIVACY_VERSION`)
- [ ] Privacy Policy URL set in `app.json` and live at `hrayem.app/privacy`
- [ ] Terms of Service URL live at `hrayem.app/terms`

### Deep linking and web fallback
- [ ] Deploy `apple-app-site-association` to `hrayem.app/.well-known/` (iOS universal links)
- [ ] Deploy `assetlinks.json` to `hrayem.app/.well-known/` (Android app links)
- [ ] Deploy web fallback page at `hrayem.app/event/{id}` — shows event details + "Download Hrayem" buttons for users without the app
- [ ] Verify: share an event link via WhatsApp/iMessage → recipient with app installed opens event detail directly; recipient without app sees fallback page

### Production build
- [ ] EAS build succeeds for `production` profile (iOS + Android)
- [ ] Sentry source map upload configured in EAS Build for production profile
- [ ] No demo data, lorem ipsum, or placeholder content in production build
- [ ] App Store metadata ready: name, subtitle, description, keywords, screenshots
- [ ] `npx expo-doctor` — all checks pass
- [ ] TestFlight build tested on ≥ 2 real iOS devices
- [ ] Android APK tested on ≥ 1 real Android device

### Security and resilience verification
- [ ] Verify rate limiting active on all production Edge Functions
- [ ] Verify RLS column restrictions enforced in production (attempt to cheat `games_played` → must fail)
- [ ] Verify force update: set `minimum_app_version_ios` / `_android` above current in Supabase → blocking screen appears on app launch
- [ ] Verify session resilience: leave app closed for 1+ hour → reopen → user is still logged in (token refresh works)
- [ ] Verify push token re-registration: uninstall/reinstall app → notifications still arrive (token updated on launch)

### Community seeding (REQUIRED before public launch)
- [ ] 10–15 founding users recruited in Ostrava (from badminton, padel, squash communities)
- [ ] Founding users have created profiles, tested the full flow
- [ ] **≥ 5 real upcoming events** visible in the feed on launch day
- [ ] Venues table seeded with all major sports facilities in Ostrava
- [ ] At least 3–5 players have posted availability signals
- [ ] **Launch checklist verified:** a new user downloading the app on day one will see real events, real venues, and real available players — not an empty screen

**Checkpoint:** A person who has never seen the code can clone the repo, follow the README, and run the app. The production build works on real devices. Deep links work end-to-end. Force update works. Session survives overnight. Sentry captures errors with source maps. The feed is alive with real events and real players on day one. Ready to submit.

---

## Quick reference — what each milestone unlocks

| Milestone | What becomes possible |
|---|---|
| 0 | Project runs; React Query + Zustand + Sentry + networking wired; i18n ready; deep link scheme registered |
| 1 | Database is live with all tables including app_config and consent_log; RLS verified |
| 2 | Real users can sign up with terms consent; session survives app restarts; force update works; push token re-registers |
| 3 | All screens exist (including availability tab); deep link routing works; foreground refresh active |
| 4 | Venues searchable; events reference real venues; feed paginates; events are shareable via deep links |
| 5 | Players can join/leave with optimistic updates; Realtime player list works |
| 6 | Organizers can edit (including venue), manage, and cancel events |
| 7 | Stats work; no-shows work; thumbs-up and play-again connections work with haptics |
| 8 | Players can chat with Realtime reconnection on foreground |
| 9 | Notifications work on real devices; rate limiting protects endpoints; availability system live |
| 10 | App feels finished; reporting works; offline/error/loading states polished; Sentry verified |
| 11 | Deep links + web fallback deployed; community seeded; App Store ready; feed is alive on day one |
