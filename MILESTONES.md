# Hrayem — Build Milestones

This file defines the build order for Hrayem MVP. Work through milestones sequentially.
Do not start a milestone until all previous milestones are complete and validated.
Each milestone ends with a checkpoint — a working, testable state of the app.

---

## Why this order

The sequence is designed so that:
- Every milestone builds on a solid, tested foundation
- Each stage produces something real you can open and interact with
- High-risk, hard-to-change pieces (auth, data model, navigation) are locked in early
- Features that depend on each other are never built in the wrong order

---

## Milestone 0 — Project foundation
> Goal: a clean, runnable project skeleton that will never need to be restructured.

- [ ] Scaffold with `npx create-expo-app` (TypeScript template)
- [ ] Apply the `src/` folder structure from `agents.md`
- [ ] Configure `app.json`: app name (Hrayem), `bundleIdentifier`, `package`, version 1.0.0, build 1
- [ ] Add all permission usage description strings (`NSLocationWhenInUseUsageDescription`, `NSCameraUsageDescription`, `NSPhotoLibraryUsageDescription`, push notifications)
- [ ] Set up ESLint + Prettier + TypeScript strict mode
- [ ] Set up EAS: `eas.json` with `development`, `preview`, `production` profiles
- [ ] Set up `.env` with Supabase env vars; add `.env` to `.gitignore`; commit `.env.example`
- [ ] Set up `expo-constants` for runtime env var access
- [ ] Install and configure Supabase JS client (`@supabase/supabase-js`)
- [ ] Write `README.md` with setup instructions (Milestone 0 scope only)
- [ ] Run `npx expo-doctor` — all checks pass
- [ ] App opens on iOS simulator with default screen

**Checkpoint:** App runs on simulator. Project structure is final. `expo-doctor` is clean. README covers setup.

---

## Milestone 1 — Supabase foundation
> Goal: database schema is live, migrations are versioned, seed data is in.

- [ ] Write all migration files in order:
  - `profiles`, `device_tokens`, `sports`, `user_sports`
  - `events`, `event_players`
  - `chat_messages`, `no_show_reports`, `notification_log`
- [ ] Apply all Postgres constraints and `CHECK` clauses exactly as specified in `BACKEND.md`
- [ ] Write and apply all indexes from `BACKEND.md` section 8
- [ ] Write and apply all triggers from `BACKEND.md` section 9 (`set_updated_at`, `handle_new_user`, `increment_no_shows`)
- [ ] Create `event_feed_view` from `BACKEND.md` section 3
- [ ] Enable RLS on all tables with policies from `BACKEND.md` section 4
- [ ] Run seed data (`sports` table)
- [ ] Verify: query the `event_feed_view` — returns empty result, no errors
- [ ] Verify: insert a test user via Supabase dashboard — `profiles` row is auto-created

**Checkpoint:** Full schema is live. RLS is enabled. Seed data is in. No raw table writes accepted from client for gated tables. All queries return expected shapes.

---

## Milestone 2 — Authentication
> Goal: a user can register, log in, and be remembered across app restarts.

- [ ] Auth screens: Login, Register, Forgot Password
- [ ] Support: email + password, Apple Sign In, Google Sign In
- [ ] Post-registration: profile setup screen (first name, last name, photo, city, language)
- [ ] GPS permission request on profile setup; auto-fill city from coordinates
- [ ] Store session securely using Supabase Auth + `expo-secure-store`
- [ ] Session persistence: user stays logged in across restarts
- [ ] Auth state routing: unauthenticated → auth screens; authenticated → home
- [ ] Logout clears session and device token
- [ ] Forgot password sends reset email
- [ ] All auth error states handled with clear user-facing messages

**Checkpoint:** Full auth loop works end-to-end. Register → profile setup → home. Close and reopen app — still logged in. Logout → back to login. Apple Sign In and Google Sign In work on a real device.

---

## Milestone 3 — Navigation shell
> Goal: all top-level screens exist and are reachable; navigation structure is final.

- [ ] Bottom tab navigator: Home feed, Create event (+), My games, Profile
- [ ] Stack navigators within each tab as needed
- [ ] All screens exist as stubs (correct title, correct layout, placeholder content)
- [ ] Navigation types are fully typed (React Navigation TypeScript setup)
- [ ] Deep link structure defined (for push notification taps — implement routing now even if notifications come later)

**Checkpoint:** Every screen in `APP.md` section 10 is reachable by tapping through the app. No navigation errors. Types are clean. This structure does not change after this milestone.

---

## Milestone 4 — Event creation and feed
> Goal: a user can create an event and see it in the feed.

- [ ] Create event screen — full form with all fields from `APP.md` section 6.1
  - Sport selector (icon-based)
  - Court status toggle
  - Date + time pickers (native, stored as UTC)
  - Venue name
  - Player count stepper (2–20)
  - Skill range picker
  - Optional description with character counter
  - Disabled submit until all required fields valid
- [ ] `POST /v1/events` Edge Function — create event + insert organizer as confirmed
- [ ] Home feed screen — queries `event_feed_view`
  - Filter by user's city, all sports, next 7 days by default
  - Sport + date range filters
  - Event cards with all fields from `APP.md` section 10.3
  - Pull to refresh
  - Empty state
- [ ] Event detail screen — full read-only view from `APP.md` section 10.4
  - Organizer shown with no-show count
  - Confirmed players list with skill badges
  - All event info displayed

**Checkpoint:** Create an event → see it in the feed → tap it → see full detail. Data is real, from Supabase. Organizer is shown correctly. Filters work.

---

## Milestone 5 — Joining, leaving, and waitlist
> Goal: the core game-joining loop works, including race condition safety and waitlist promotion.

- [ ] "I want to play" button on event detail
  - Shows correct state: Join / Confirmed / Waitlisted / Organizer
  - Skill level warning dialog if outside range
- [ ] `POST /v1/events/:id/join` Edge Function — with `FOR UPDATE` lock, UPSERT, status logic
- [ ] `POST /v1/events/:id/leave` Edge Function — with waitlist promotion
- [ ] Event detail updates in real-time when players join/leave (Supabase Realtime subscription on `event_players`)
- [ ] Event status (`active` → `full`) updates in real-time on detail screen
- [ ] Waitlist position shown to waitlisted player ("You're on the waitlist — #2")
- [ ] My games screen — Upcoming tab shows events I'm confirmed for or organizing

**Checkpoint:** Two test accounts. Account A creates event (2 total players). Account B joins — both see "Confirmed". Account B leaves — spot opens. Create a 1-player-remaining event, have two accounts race to join — only one gets confirmed, the other is waitlisted. Waitlist position shows correctly.

---

## Milestone 6 — Organizer controls
> Goal: organizers can fully manage their events.

- [ ] Edit event (date, time, venue, description, skill range) — not allowed after `finished`
- [ ] Remove a player from event (player notified, waitlist promoted)
- [ ] Cancel event — all confirmed + waitlisted players notified
- [ ] My games screen — "Organizing" tab / visual distinction from "Playing"
- [ ] `POST /v1/events/:id/cancel` Edge Function
- [ ] `POST /v1/events/:id/leave` handles organizer-removing-player case

**Checkpoint:** Organizer can edit, remove a player (waitlist promotes), and cancel (all players notified). Organizer cannot remove themselves. Cancelled events disappear from feed but remain in My Games (Past tab).

---

## Milestone 7 — Scheduled jobs and statistics
> Goal: events finish automatically; player stats update; reminders send; no-show window opens.

- [ ] `finish-event` Supabase cron job (every 10 minutes):
  - Pass 1: send 2-hour reminders (only once per event — `reminder_sent` flag)
  - Pass 2: finish events past `ends_at`, set `no_show_window_end`, upsert `user_sports` stats
- [ ] `games_played` and `hours_played` increment correctly on finish
- [ ] My games Past tab shows finished events
- [ ] Profile screen shows updated stats per sport
- [ ] `report-no-show` Edge Function — organizer marks player as no-show within 24h window
- [ ] My games Past tab — organizer sees "Report no-show" action within window
- [ ] `no_shows` counter visible on player profile and event detail player list

**Checkpoint:** Create an event set to end 1 minute from now. Wait for cron to fire. Event moves to finished. Stats increment for confirmed players. Organizer can report a no-show. No-show count increments on that player's profile. Wait 24h (or test with a short window): report button disappears.

---

## Milestone 8 — Chat
> Goal: confirmed players can message each other in real-time.

- [ ] Chat screen — standard layout from `APP.md` section 10.6
- [ ] `POST /v1/events/:id/messages` Edge Function — access check, insert, Realtime broadcast
- [ ] Supabase Realtime subscription on `chat_messages` for the event
- [ ] Messages appear instantly for all participants
- [ ] Chat button only visible + active for confirmed players + organizer
- [ ] Waitlisted players cannot access chat
- [ ] Keyboard-aware layout (input stays above keyboard on iOS and Android)
- [ ] Timestamps on messages

**Checkpoint:** Two confirmed accounts open the same event chat simultaneously. Messages from one appear instantly on the other. A waitlisted account cannot see or access the chat button. Chat history loads on re-open.

---

## Milestone 9 — Push notifications
> Goal: all notification types from `APP.md` section 9 are working.

- [ ] Register Expo push token on login; upsert to `device_tokens`; delete on logout
- [ ] Notification permission request with meaningful usage description
- [ ] Push fan-out helper in Edge Functions (sends to all `device_tokens` for a user)
- [ ] Implement all 8 notification types:
  - Someone joined my event
  - My spot is confirmed
  - Promoted from waitlist
  - Event is now full
  - New chat message (background only)
  - 2-hour reminder (from cron)
  - Event cancelled
  - I was removed from an event
- [ ] Tapping a notification navigates to the correct screen (deep linking from Milestone 3)
- [ ] Notification preferences screen — on/off per type
- [ ] Log all sent notifications to `notification_log`

**Checkpoint:** Test every notification type on a real device (not simulator — push requires real device). Each one arrives, has correct copy, and tapping it opens the right screen.

---

## Milestone 10 — Polish and hardening
> Goal: the app feels finished. Every screen handles every state. Nothing is embarrassing.

- [ ] Every screen has a correct loading state (skeleton or spinner — not a blank flash)
- [ ] Every screen has a correct empty state with helpful copy
- [ ] Every screen has a correct error state with a retry action where applicable
- [ ] All forms validate inline with clear error messages — no silent failures
- [ ] Network errors surface as toasts or inline messages — never silent
- [ ] All touch targets ≥ 44×44pt
- [ ] All interactive elements have `accessibilityLabel` and `accessibilityHint`
- [ ] CZ / EN language switching works correctly across all screens
- [ ] No hardcoded strings — all user-facing text goes through i18n
- [ ] Profile photo upload works: resize → compress → upload → display
- [ ] Account deletion flow works end-to-end (Settings → confirm → account gone)
- [ ] App icons and splash screens at all required sizes
- [ ] Remove all `console.log` statements from production paths
- [ ] Run full lint + typecheck — zero errors, zero warnings
- [ ] Test on a real iOS device and a real Android device

**Checkpoint:** Walk through every screen in `APP.md` section 10 as a real user. Every state (loading, empty, error, happy path) behaves correctly. No placeholder content anywhere. App icons show correctly on home screen.

---

## Milestone 11 — Pre-submission
> Goal: the app is ready to submit to the App Store and Google Play.

- [ ] `README.md` is complete and accurate for all milestones
- [ ] All environment variables documented in `.env.example`
- [ ] EAS build succeeds for `production` profile (iOS + Android)
- [ ] No demo data, lorem ipsum, or placeholder content in production build
- [ ] Privacy Policy URL set in `app.json` and live at that URL
- [ ] App Store metadata ready: name, subtitle, description, keywords, screenshots
- [ ] `npx expo-doctor` — all checks pass on production build config
- [ ] TestFlight build uploaded and tested on at least 2 real iOS devices
- [ ] Android APK tested on at least 1 real Android device

**Checkpoint:** A person who has never seen the code can clone the repo, follow the README, and run the app. The production EAS build installs and runs without issues on a real device. Ready to submit.

---

## Quick reference — what each milestone unlocks

| Milestone | What becomes possible |
|---|---|
| 0 | Project runs |
| 1 | Database is live and correct |
| 2 | Real users can sign up |
| 3 | All screens exist; navigation is final |
| 4 | Events can be created and browsed |
| 5 | Players can join, leave, and waitlist |
| 6 | Organizers can manage events |
| 7 | Stats work; no-show system works |
| 8 | Players can chat |
| 9 | Notifications work on real devices |
| 10 | App feels finished |
| 11 | App Store ready |
