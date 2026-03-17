# Hrayem — Product Specification
## MVP v1.0

---

## 1. Product Overview

**Hrayem** is a mobile app for racket sport players who want to find opponents or partners for a specific sport, place, date, and time — without the friction of coordinating through social media groups or messaging apps.

The app connects players by availability, skill level, and location. Court booking is handled outside the app in MVP; future versions will integrate directly with venue reservation systems.

**Slogan:** Od hráčů pro hráče *(From players, for players)*

**Platforms:** iOS (primary), Android (secondary)
**Minimum iOS version:** 16.0
**Minimum Android version:** API 26 (Android 8.0)
**Regions:** Czech Republic — starting with Ostrava, expandable to all cities
**Languages:** Czech (default), English — auto-detected from OS language, switchable in settings
**Racket sports in MVP:** Badminton, Padel, Squash

---

## 2. Target User

- Men and women, all ages (primary: 18–50, active lifestyle)
- Plays badminton, padel, or squash
- Needs to find a player for a specific time slot
- Wants a clean, trustworthy environment — not another WhatsApp group
- Uses iPhone (primary target device)
- Values simplicity: finds a match, joins, shows up

---

## 3. Core User Flows

### 3.1 Find and join a game
1. Open app → see feed of upcoming events near me
2. Filter by sport and/or date
3. Tap event → see details, players, skill requirement
4. Tap "I want to play" → confirmed or waitlisted
5. Chat with other confirmed players
6. Show up and play

### 3.2 Create a game
1. Tap "+" → fill in sport, date, time, venue, player count, skill range
2. Publish → event appears in the feed
3. Manage: see who joined, chat with them, remove players if needed

### 3.3 Profile and reputation
- Players see each other's skill level, games played, and no-show count before joining
- Organizer can report no-shows after the event; count is permanent on the player's profile

---

## 4. Authentication

- Email + password
- Apple Sign In (required for App Store approval)
- Google Sign In
- Forgot password flow (email reset link)
- JWT-based sessions managed via Supabase Auth

---

## 5. User Profile

### 5.1 Fields
- First name, last name
- Profile photo (uploaded, stored in Supabase Storage)
- City / location (auto-detected via GPS on first launch, editable)
- Preferred language (CZ / EN)

### 5.2 Sport profile (per sport)
Each sport the user has interacted with shows:

| Field | Description |
|---|---|
| Skill level | One of 4 levels: Beginner / Intermediate / Advanced / Pro |
| Games played | Auto-incremented by the server when an event is marked finished |
| Hours played | Auto-calculated from event duration by the server when an event is marked finished |
| No-shows | Incremented by organizer report; permanently visible |

Sport profile entries are created on first interaction (joining or creating an event for that sport). These counters are server-controlled — the client never writes to them directly.

---

## 6. Events

### 6.1 Creating an event

| Field | Type | Notes |
|---|---|---|
| Sport | Select | Badminton / Padel / Squash |
| Court status | Select | "I have a court reserved" / "To be arranged" |
| Date + time | DateTime picker | Start and end; stored as UTC |
| Venue name | Text | Free text; no map integration in MVP |
| Total players | Number | 2–20 |
| Skill range | Range picker | Min–Max from the 4 levels |
| Description | Text (optional) | Max 500 characters |

The organizer is automatically counted as a confirmed player — they hold one spot in the total. "Total players" means all humans including the organizer.

### 6.2 Skill level enforcement
If a player's skill level for that sport falls outside the event's required range, tapping "I want to play" shows a soft warning:

> "This game is set for a different skill level. Are you sure you want to continue?"

The player can still proceed. This is informational, not a hard block.

### 6.3 Joining an event
- Single tap: "I want to play"
- Result: **Confirmed** (spot available) or **Waitlisted** (event full)
- Order is strict FIFO by original join timestamp — preserved even if a player leaves and rejoins

### 6.4 Waitlist promotion
When a confirmed player leaves:
1. First waitlisted player is automatically promoted to confirmed
2. Push notification sent: "A spot opened up — you're now confirmed for [event]"

### 6.5 Cancellation and no-show rules
- Players can cancel up to **120 minutes before** the event start → no penalty
- Cancellation within 120 minutes is still allowed but flagged internally (reserved for future use)
- After the event ends, the organizer has **24 hours** to report no-shows
- Reporting a no-show increments that player's `no_shows` counter permanently for that sport

### 6.6 Event status lifecycle

```
active ──→ full ──→ finished
  └──────────────→ cancelled
```

| Status | Meaning |
|---|---|
| `active` | Open, spots still available |
| `full` | No spots; waitlist only |
| `finished` | Event time has passed; organizer can report no-shows (24h window) |
| `cancelled` | Organizer cancelled; all confirmed + waitlisted players notified |

Status transitions to `finished` and sending the 2-hour reminder are handled server-side by a scheduled job — never triggered by the client.

### 6.7 Organizer capabilities
- Edit: date, time, venue, description, skill range (not allowed once event is finished)
- Remove a player (player is notified; next waitlisted player is automatically promoted)
- Cancel event (all confirmed + waitlisted players notified via push)
- Report no-shows for confirmed players (up to 24h after event end)
- The organizer cannot leave their own event — they must cancel it

### 6.8 Player roles per event

| Role | Description |
|---|---|
| Organizer | Creator; has edit, remove, cancel, and no-show report permissions |
| Confirmed | Has a guaranteed spot; can access event chat |
| Waitlisted | Queued; promoted automatically when a spot opens; cannot access chat |

---

## 7. Chat

- Every event has a dedicated chat room
- Access: organizer + confirmed players only — waitlisted players cannot read or write
- Features: text messages only in MVP
- Real-time delivery via Supabase Realtime
- Chat history persists until the event is hard-deleted (cancelled events retain history)
- Push notification on new message (delivered only when app is in background)

---

## 8. Location

- On first launch: request GPS permission; auto-detect and set city from coordinates
- User can manually override their city at any time in profile settings
- Feed filters events by selected city
- No map view in MVP; venue is a free-text field only

---

## 9. Notifications (Push)

All push notifications are triggered server-side (Edge Functions + scheduled jobs). The client registers an Expo push token on login; multiple devices are supported.

| Trigger | Recipient |
|---|---|
| Someone joins my event | Organizer |
| My spot is confirmed | Joining player |
| I was promoted from waitlist | Promoted player |
| Event is now full | Organizer |
| New chat message | All confirmed players + organizer (except sender) |
| Event reminder | All confirmed players + organizer (2 hours before start) |
| Event was cancelled | All confirmed + waitlisted players |
| I was removed from an event | Removed player |

Users can toggle notification types on/off in settings.

---

## 10. Screens

### 10.1 Splash screen
- Hrayem logo, centered, on brand background
- Transitions to login or home (if session active)

### 10.2 Auth screens
- Login: email + password, Apple Sign In, Google Sign In
- Register: email + password, then profile setup
- Forgot password: email input → reset link sent
- Profile setup (post-registration): name, photo, city, language

### 10.3 Home feed — "Upcoming games"
- Default filter: user's city, all sports, next 7 days
- Filters: sport (multi-select), date range
- Event card shows:
  - Sport icon + color accent
  - Date and time (local timezone)
  - Venue name
  - Skill range badge
  - Player count fill indicator (e.g. `2/4`)
  - Court status badge ("Court reserved" / "To be arranged")
  - Event status if full or waitlisted
- Empty state: "No games found. Be the first to create one."
- Pull to refresh

### 10.4 Event detail
- Full event info (sport, date, time, venue, description)
- Organizer profile snippet (name, photo, no-show count)
- Confirmed player list with avatars and skill badges
- Waitlist count shown (not individual names)
- Skill requirement clearly displayed
- CTA: "I want to play" / "Leave game" / "You're waitlisted (#N)"
- Chat button (visible and active only for confirmed players + organizer)
- Organizer-only: edit button, remove player actions, cancel event

### 10.5 Create event
- Single scrollable form with clearly labeled sections
- Sport selector: icon-based (Badminton / Padel / Squash)
- Court status toggle
- Date + time pickers (native OS pickers)
- Player count stepper (2–20)
- Skill range: dual-handle slider or segmented picker
- Optional description field with character counter
- "Create" button — disabled until all required fields are valid

### 10.6 Chat
- Standard chat UI: messages bottom-up, own messages right-aligned
- Participant name + avatar shown on each message
- Timestamps on messages
- Text input + send button
- Keyboard-aware layout (input stays above keyboard)

### 10.7 My games
- Two tabs: Upcoming / Past
- Upcoming: events I'm confirmed for or organizing, sorted by date
- Past: completed events; organizer can report no-shows within 24h window
- Clear visual distinction: "Organizing" vs "Playing"

### 10.8 Profile
- Photo, full name, city
- Language toggle (CZ / EN)
- Per-sport section: skill level badge, games played, hours played, no-show count
- Edit profile button

### 10.9 Settings
- Language (CZ / EN)
- Location (city override)
- Notification preferences (on/off per type)
- Log out
- Delete account (with explicit confirmation dialog — required for App Store)

---

## 11. Design Direction

**Tone:** Modern, sporty, energetic, clean. Trustworthy without being corporate.

**Not:** Gamified, cluttered, infantile, dated.

**Key visual principles:**
- Each sport has a distinct icon and color accent used consistently across cards, badges, and headers
- Skill levels displayed as color-coded badges (Beginner → Pro, distinct colors)
- Player count shown as a fill indicator (e.g. `●●○○` or `2/4`) — immediately scannable
- Event status (open / full / waitlist) must be visually immediate — never buried in text
- Minimum touch targets: 44×44pt on all interactive elements
- Accessible labels (`accessibilityLabel`, `accessibilityHint`) on all interactive elements
- Smooth, native-feeling transitions; no janky or web-style navigation

**Typography and spacing:**
- Clear visual hierarchy on event cards: sport + time → venue → skill/players → secondary info
- Generous whitespace — feed app, not a dashboard
- No unnecessary decoration or chrome

**Emotions the app should evoke:**
- "This is simple."
- "I found someone to play with in 30 seconds."
- "I can trust the people here."

---

## 12. App Store Readiness

The app must be built ready for App Store (iOS) and Google Play submission from the start — not retrofitted later.

### App Store metadata
- **App name:** Hrayem
- **Subtitle:** Od hráčů pro hráče
- **Slogan (in-app):** Od hráčů pro hráče *(used on splash screen and any marketing surfaces within the app)*

### Required for App Store approval
- **Apple Sign In** must be offered if any other third-party login (Google) is offered — already included in auth
- **Privacy Policy URL** — must be provided at submission; include a placeholder link in the app and in `app.json`
- **Account deletion** — Apple requires the ability to delete an account from within the app; the delete account flow in Settings satisfies this
- **Push notification permissions** — must be requested with a clear usage description explaining why notifications are needed (not just "for notifications")
- **Location permission** — must include a clear `NSLocationWhenInUseUsageDescription` string explaining the use case (finding nearby games)
- **Photo library / camera permission** — required for profile photo upload; include `NSPhotoLibraryUsageDescription` and `NSCameraUsageDescription`
- **No placeholder or lorem ipsum content** — all demo data must be removed before submission

### `app.json` / `app.config.js` must include
- `bundleIdentifier` (iOS) and `package` (Android) — set from day one, never changed after first release
- `version` and `buildNumber` / `versionCode` — increment correctly on every release
- All permission usage description strings
- Privacy Policy URL
- App icons and splash screens for all required sizes (use Expo's asset pipeline)

### Build and release process
- Use EAS Build (Expo Application Services) for both iOS and Android builds
- Use EAS Submit for App Store and Play Store submission
- Maintain separate `development`, `preview`, and `production` build profiles in `eas.json`
- Never use a development build for store submission

---

## 13. Future Features (Post-MVP)

These are explicitly out of scope for MVP. Do not implement or scaffold them unless instructed.

- Post-game player ratings (skill accuracy, reliability)
- Advanced search filters and player recommendations
- Court reservation integration with venues
- Automated game statistics and charts
- Monetization (premium accounts, promoted events, B2B venue model)
- Player-to-player messaging (outside of event chat)
- Recurring events
- Player blocking and reporting

---

## 14. Out of Scope for MVP

- Payment processing of any kind
- Court booking
- Player-to-player direct messaging
- Admin / moderation panel
- Analytics dashboard
- Web version
