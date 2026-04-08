# Hrayem — Product Specification
## MVP v1.0

---

## 1. Product Overview

**Hrayem** is a mobile app for racket sport players who want to find opponents or partners for a specific sport, place, date, and time — without the friction of coordinating through social media groups or messaging apps.

The app connects players by availability, skill level, and location. Court booking is handled outside the app in MVP; future versions will integrate directly with venue reservation systems as a B2B product for sports facilities.

**Long-term vision:** The player app is the community and distribution layer. Once venues are active in the app, sports facilities can claim their venue profile and manage court reservations directly through Hrayem — replacing expensive legacy reservation systems. The player app comes first; the B2B platform follows naturally.

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
2. Select a venue from the venue list (or add a new one)
3. Publish → event appears in the feed
4. **Share the event link** with friends (WhatsApp, iMessage, etc.) — they can open it directly in the app
5. Manage: see who joined, chat with them, remove players if needed

### 3.3 Profile and reputation
- Players see each other's skill level, games played, no-show count, and thumbs-up percentage before joining
- Organizer can report no-shows after the event; count is permanent on the player's profile
- After an event finishes, confirmed players can give each other a thumbs up — building positive reputation over time

### 3.4 First interaction with a sport
When a user creates or joins an event for a sport they have never interacted with:
1. A modal asks: "What's your skill level at [sport]?" with the 4 options (Beginner / Intermediate / Advanced / Pro)
2. The user selects a level → `user_sports` row is created with that skill level
3. The user can change their skill level at any time from the Profile screen (per-sport edit)

This replaces the silent `skill_level = 1` default. The user always self-declares their skill level on first contact with a sport.

### 3.5 Signal availability (passive matchmaking)
Not every player has a specific time and court booked. Many just want to play this week. The availability signal lets the demand side of the marketplace be visible:
1. From the Home screen, tap "I'm available"
2. Select a sport, a date (or date range within the next 7 days), and optionally a preferred time window
3. Your availability appears in the "Available players" tab on the Home feed
4. Other players or organizers can see who's available and create events that match

This is lightweight — no commitments, no booking. Just a signal. Expired availability (past dates) is automatically cleaned up.

### 3.6 Post-game: thumbs up and play-again
After an event finishes (within the 48h chat window):
1. Each confirmed player sees a "Rate your experience" prompt in the event detail or My Games (Past tab)
2. For each other confirmed player, they can give a **thumbs up** (or skip — no negative option)
3. Thumbs up are anonymous and aggregated as a percentage on the player's sport profile
4. If two players **mutually** give each other a thumbs up across any event, they become **play-again connections** — a subtle indicator appears next time they're both in the same event or availability list

This turns strangers into a loose community without the complexity of a full social graph. No messaging, no following — just a signal that says "I enjoyed playing with this person."

---

## 4. Authentication and Session Management

- Email + password
- Apple Sign In (required for App Store approval)
- Google Sign In
- Forgot password flow (email reset link)
- JWT-based sessions managed via Supabase Auth

### 4.1 Profile completion gate
After registration (email/password, Apple, or Google), the user is routed to the profile setup screen. The user **cannot access the main app** until all required fields are filled:
- First name
- Last name
- City (from curated list; auto-suggested via GPS)
- Preferred language (CZ / EN)

Profile photo is optional during setup but encouraged.

This gate exists because `profiles.first_name` and `profiles.last_name` are required for the app to function (event cards, player lists, chat). The profile row is created on signup with these fields as `NULL`; the profile setup screen fills them in. The app checks for profile completeness on every auth-gated screen.

### 4.2 Terms of Service and Privacy Policy consent
During registration, the user must accept the Terms of Service and Privacy Policy before their account is created:
- A checkbox with links to both documents: "I agree to the [Terms of Service] and [Privacy Policy]"
- Registration button is disabled until the checkbox is checked
- Consent is recorded server-side: timestamp + version of the terms accepted (see BACKEND.md `consent_log`). If email confirmation delays the first authenticated session, the accepted versions are captured during registration and the `consent_log` row is materialized immediately after the user's first successful sign-in, before they can proceed into the app.
- If the terms are updated in the future, users are prompted to accept the new version on their next app launch before proceeding

This is required for GDPR compliance in the Czech Republic / EU.

### 4.3 Session resilience
Users expect to stay logged in indefinitely. The app must handle token expiration invisibly:
- On app launch: silently refresh the access token using the stored refresh token
- During use: catch any 401 response, refresh the token, and retry the original request — all invisible to the user
- If the refresh token itself has expired (e.g. after 30+ days of inactivity): redirect to login with a clear message ("Your session expired. Please log in again.") — never show a crash or a blank screen
- See BACKEND.md section 16 (Client Infrastructure) for implementation details

---

## 5. User Profile

### 5.1 Fields
- First name, last name (required; set during profile setup)
- Profile photo (uploaded, stored in Supabase Storage; optional)
- City (selected from curated list; see section 8.1)
- Preferred language (CZ / EN)

### 5.2 Sport profile (per sport)
Each sport the user has interacted with shows:

| Field | Description |
|---|---|
| Skill level | One of 4 levels: Beginner / Intermediate / Advanced / Pro — **editable by the user at any time** from the Profile screen |
| Games played | Auto-incremented by the server when an event is marked finished |
| Hours played | Auto-calculated from event duration by the server when an event is marked finished |
| Thumbs up % | Percentage of games where at least one co-player gave the user a thumbs up. Only shown after 3+ games played (avoids 100% from 1 game). |
| No-shows | Incremented by organizer report; permanently visible |

Sport profile entries are created on first interaction (joining or creating an event for that sport) with the skill level the user self-declares (see section 3.4). `games_played`, `hours_played`, `no_shows`, and thumbs-up stats are server-controlled — the client never writes to them directly. `skill_level` is the only field the user can update.

---

## 6. Events

### 6.1 Creating an event

| Field | Type | Notes |
|---|---|---|
| Sport | Select | Badminton / Padel / Squash |
| Court status | Select | "I have a court reserved" / "To be arranged" |
| Date + time | DateTime picker | Start and end; stored as UTC |
| Venue | Venue picker | Search existing venues or add a new one (see section 8.3) |
| Total players | Number | 2–20 |
| Skill range | Range picker | Min–Max from the 4 levels |
| Description | Text (optional) | Max 500 characters |

The organizer is automatically counted as a confirmed player — they hold one spot in the total. "Total players" means all humans including the organizer.

**Venue selection:** Events are linked to a structured venue record, not free text. The city is derived from the venue's city. See section 8.3 for the venue system.

### 6.2 Skill level enforcement
If a player's skill level for that sport falls outside the event's required range, tapping "I want to play" shows a soft warning:

> "This game is set for [Intermediate–Advanced] players. Your level is [Beginner]. You can still join, but the organizer set this range to find players at a similar level. Continue?"

The player can still proceed. This is informational, not a hard block.

**UI clarification for organizers:** When setting the skill range during event creation, show helper text:

> "Players outside this range will see a warning but can still join."

This prevents organizers from expecting hard enforcement.

### 6.3 Joining an event
- Single tap: "I want to play"
- If the user has no `user_sports` row for this sport → show the skill level selection modal (section 3.4) before proceeding
- Result: **Confirmed** (spot available) or **Waitlisted** (event full)
- Order is strict FIFO by original join timestamp — preserved even if a player leaves and rejoins

### 6.4 Waitlist promotion
When a confirmed player leaves:
1. First waitlisted player is automatically promoted to confirmed
2. Push notification sent: "A spot opened up — you're now confirmed for [event]"

### 6.5 Cancellation and no-show rules
- Players can cancel up to **24 hours before** the event start → no penalty
- Cancellation within 24 hours is still allowed but flagged internally (`late_cancel` — reserved for future use, e.g. reliability scoring)
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
| `finished` | Event time has passed; organizer can report no-shows (24h window); chat remains open; thumbs-up window open |
| `cancelled` | Organizer cancelled; all confirmed + waitlisted players notified; chat remains read-only |

Status transitions to `finished` and sending the 2-hour reminder are handled server-side by a scheduled job — never triggered by the client.

### 6.7 Chat behavior after event ends
- **Finished events:** Chat remains open for **48 hours after the event ends**. Players can still send messages (e.g. "Great game!", "Same time next week?"). After 48 hours, the chat becomes read-only — history is preserved but no new messages can be sent.
- **Cancelled events:** Chat becomes read-only immediately on cancellation. History is preserved.

### 6.8 Post-game actions (within 48h of event end)
After an event finishes, each confirmed player can:
1. **Give thumbs up** to other confirmed players — one tap per player, anonymous, no undo
2. **View who played** — full confirmed player list remains visible
3. **Chat** — within the 48h window

The thumbs-up prompt appears as a card in the My Games (Past tab) and optionally on the event detail screen.

### 6.9 Event sharing
Every event has a **shareable deep link** (e.g. `https://hrayem.cz/event/{id}`).
- **Share button** on the event detail screen opens the native share sheet with the link + a short text: "[Sport] at [Venue] on [Date] — join me on Hrayem!"
- If the recipient has the app installed: the link opens the event detail screen directly
- If the recipient does not have the app: the link opens a simple **web fallback page** showing event details + "Download Hrayem" buttons for App Store and Google Play
- This is the primary organic growth mechanism — players sharing games with friends

See BACKEND.md section 16.6 for deep link and universal link configuration.

### 6.10 Organizer capabilities
- Edit: date, time, venue, description, skill range, player count (not allowed once event is finished or cancelled)
- **Player count edit constraint:** Cannot reduce `player_count_total` below the current number of confirmed players
- Remove a player (player is notified; next waitlisted player is automatically promoted)
- Cancel event (all confirmed + waitlisted players notified via push)
- Report no-shows for confirmed players (up to 24h after event end)
- The organizer cannot leave their own event — they must cancel it

### 6.11 Player roles per event

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
- Chat history persists until the event is hard-deleted (cancelled events retain read-only history)
- Chat remains writable for 48 hours after event finishes, then becomes read-only
- Push notification on new message (delivered only when app is in background)

---

## 8. Location and Venues

### 8.1 Curated city list
The app uses a **curated list of Czech cities** enforced in the database for writes and mirrored in `src/constants/cities.ts` for the client picker. The database list is authoritative; the client mirror must stay in sync. This prevents mismatches like "Ostrava" vs "ostrava" vs "Ostrava-Poruba" that would break feed filtering.

MVP city list (mirrored in code and the database today; server-driven expansion can be added later without changing the product scope):
- Ostrava
- Praha (Prague)
- Brno
- Plzeň
- Olomouc
- Liberec
- České Budějovice
- Hradec Králové
- Pardubice
- Zlín
- Opava
- Frýdek-Místek
- Havířov
- Karviná

### 8.2 Location detection
- On first launch (profile setup): request GPS permission; auto-detect nearest city from coordinates and pre-select it in the city picker
- User can manually select a different city at any time in profile settings
- Feed filters events by the user's selected city
- No map view in MVP

### 8.3 Venues
Instead of free-text venue names, Hrayem uses a **structured `venues` table**. This is critical for two reasons:
1. **Data quality now:** Prevents the same place being entered 5 different ways, which breaks search and aggregation.
2. **B2B readiness later:** When a sports facility wants to claim their venue and manage reservations, the data already exists — clean, with usage history.

**How it works in MVP:**
- When creating an event, the organizer **searches existing venues** by name (filtered to their city)
- If the venue doesn't exist, they can **add a new one** (name + city + optional address)
- New venues are crowdsourced — created by any authenticated user
- Venues are **not verified** in MVP; a future `is_verified` flag will be set when a facility claims their profile
- The event's city is derived from the venue's city (not entered separately)

**Venue fields (MVP):**
- Name (required; 1–100 characters)
- City (required; from curated list)
- Address (optional; free text, max 200 characters)

### 8.4 Future: venue profiles and B2B
Post-MVP, venues become first-class entities with facility-owner accounts, court availability calendars, pricing, photos, and direct booking integration. The structured venue data from MVP is the foundation.

### 8.5 Future: radius-based filtering
Post-MVP, city-based filtering can be replaced or supplemented with radius-based filtering using GPS coordinates.

---

## 9. Player Availability

### 9.1 Concept
Many players don't have a court booked or a fixed time — they just want to play sometime this week. Availability signals make this demand visible to other players and organizers.

### 9.2 How it works
- Any player can post their availability: sport, date (or date range, max 7 days out), and an optional preferred time window (e.g. "evening")
- **Date ranges in UX, individual dates in storage:** If a user selects Monday–Wednesday, the client expands this into 3 individual availability records (one per date) with the same time preference and note. This keeps the backend schema simple while the UX feels natural.
- Availability is visible in a dedicated "Available players" tab on the Home screen
- Availability is filtered by the viewer's city and optionally by sport
- Expired availability (past dates) is automatically removed by the server
- One availability per (user, sport, date) — updating replaces the old one
- No commitments — it's a signal, not a booking

### 9.3 What availability shows
- Player name, photo, skill level badge for that sport
- Sport icon
- Date(s) available
- Preferred time window (if set)
- Games played count (credibility signal)
- Play-again indicator if the viewer has a mutual connection with this player (see section 3.6)

### 9.4 Actions
- Organizers see available players and can create an event that matches
- Players see each other's availability and can reach out by creating an event
- No direct messaging from availability — the path is always: see availability → create event → they join

---

## 10. Notifications (Push)

All push notifications are triggered server-side (Edge Functions + scheduled jobs). The client registers an Expo push token on **every app launch** (tokens can rotate silently); multiple devices are supported.

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

Notification preferences are in scope for MVP.

Users can toggle each notification type on or off in Settings:
- Someone joined my event
- My spot is confirmed
- I was promoted from waitlist
- Event is now full
- New chat message
- Event reminder
- Event was cancelled
- I was removed from an event

Preferences affect future push notifications only. They do not affect in-app UI state.

---

## 11. Screens

### 11.1 Splash screen
- Hrayem logo, centered, on brand background
- **Version check:** on launch, check `app_config.minimum_app_version_ios` (or `_android`) from Supabase. If the running version is below the minimum, show the force update screen (section 11.15) instead of proceeding.
- Transitions to login or home (if session active and version is current)

### 11.2 Auth screens
- Login: email + password, Apple Sign In, Google Sign In
- Register: email + password, then profile setup
  - **Terms checkbox:** "I agree to the [Terms of Service] and [Privacy Policy]" — required before registration proceeds
- Forgot password: email input → reset link sent
- Profile setup (post-registration): first name, last name, city (curated picker with GPS suggestion), language
- Profile photo upload is offered during setup but skippable
- **The user cannot proceed to the main app until first name, last name, and city are set**

### 11.3 Home feed
Two tabs at the top:

**Tab 1: "Upcoming games" (default)**
- Default filter: user's city, all sports, next 7 days
- Filters: sport (multi-select), date range
- **Infinite scroll pagination** — loads 20 events at a time, loads more on scroll
- **Foreground refresh:** when the app returns from background, the feed silently refreshes without showing a loading spinner (stale-while-revalidate via React Query)
- Event card shows:
  - Sport icon + color accent
  - Date and time (local timezone, formatted via `date-fns-tz`)
  - Venue name (from venue record)
  - Skill range badge
  - Player count fill indicator (e.g. `2/4`)
  - Court status badge ("Court reserved" / "To be arranged")
  - Event status if full or waitlisted
- Empty state: "No games found. Be the first to create one."
- Pull to refresh (with haptic feedback on trigger)

**Tab 2: "Available players"**
- Shows players who have signaled availability in the user's city
- Filtered by sport (multi-select) and date range
- Each card shows: player name, photo, sport, skill badge, date(s), time preference, games played
- Play-again indicator (🔄 or similar) if the viewer has a mutual connection with this player
- Empty state: "No players available right now. Post your availability!"
- "I'm available" CTA button at the bottom of this tab

### 11.4 Event detail
- Full event info (sport, date, time, venue name + address, description)
- **Share button** — opens native share sheet with event deep link (see section 6.9)
- **Add to calendar button** — adds the event to the device's native calendar (sport, venue, date/time). Uses `expo-calendar`. Reduces no-shows by making the event feel real and committed. Available for confirmed players and organizer.
- Organizer profile snippet (name, photo, no-show count for that sport, thumbs-up %)
- Confirmed player list with avatars, skill badges, and play-again indicator for mutual connections
- Waitlist count shown (not individual names)
- Skill requirement clearly displayed, with note: "Players outside this range can still join"
- CTA: "I want to play" / "Leave game" / "You're waitlisted (#N)"
- Chat button (visible and active only for confirmed players + organizer)
- Organizer-only: edit button, remove player actions, cancel event
- Report button (see section 12)
- **Post-game (finished events):** thumbs-up card for each co-player (within 48h)

### 11.5 Create event
- Single scrollable form with clearly labeled sections
- **Keyboard-aware layout** — form scrolls to keep active input above keyboard
- Sport selector: icon-based (Badminton / Padel / Squash)
- Court status toggle
- Date + time pickers (native OS pickers)
- **Venue picker:** search field that queries existing venues in the user's city; if no match, "Add new venue" option that opens an inline form (name, address)
- Player count stepper (2–20)
- Skill range: dual-handle slider or segmented picker, with helper text
- Optional description field with character counter
- "Create" button — disabled until all required fields valid (validated via `react-hook-form` + Zod schema)
- **Haptic feedback** on successful event creation

### 11.6 Add venue (inline or modal)
- Triggered from the venue picker when no existing venue matches
- Fields: Venue name (required), Address (optional)
- City is pre-filled from the user's city (inherited by the event)
- "Save" creates the venue and selects it for the event in one step
- No verification badge in MVP — all user-created venues are unverified

### 11.7 Chat
- Standard chat UI: messages bottom-up, own messages right-aligned
- Participant name + avatar shown on each message (avatars loaded via `expo-image` with caching)
- Timestamps on messages (formatted via `date-fns`)
- Text input + send button
- Keyboard-aware layout (input stays above keyboard)
- For finished events: show a banner "Chat closes [time remaining]" during the 48h window; after 48h, hide input and show "Chat is now read-only"
- For cancelled events: hide input, show "This event was cancelled. Chat is read-only."
- **Realtime reconnection:** if the websocket drops (background/foreground transitions), automatically reconnect and fetch missed messages

### 11.8 My games
- Two tabs: Upcoming / Past
- **Upcoming:** events I'm confirmed for or organizing, sorted by date; each card has an "Add to calendar" shortcut if not already added
- **Past:** completed events; shows:
  - Organizer can report no-shows within 24h window
  - **Thumbs-up prompt** for each co-player (within 48h window) — simple row of player avatars with a thumbs-up button under each (haptic feedback on tap)
  - Clear visual distinction: "Organizing" vs "Playing"

### 11.9 Profile
- Photo, full name, city
- Language toggle (CZ / EN)
- Per-sport section:
  - Skill level badge — **tappable to change skill level** (opens picker with Beginner / Intermediate / Advanced / Pro)
  - Games played
  - Hours played
  - Thumbs-up % (shown after 3+ games; otherwise "Play more games to see your rating")
  - No-show count
- **Play-again connections list** — players you have a mutual thumbs-up with, grouped by sport; tapping a player opens their profile snippet
- Edit profile button (name, photo, city)

### 11.10 Player profile snippet (viewed from event detail, availability list, or connections)
- Photo, name, city
- Per-sport stats: skill level, games played, hours played, thumbs-up %, no-show count
- Play-again indicator if mutual connection exists
- "Report player" in overflow menu (see section 12)

### 11.11 Post availability screen
- Accessed from the "I'm available" button on the Home feed (Available players tab)
- Sport selector
- Date picker (single date or date range, max 7 days from today)
- Optional time preference: Morning / Afternoon / Evening / Any (segmented picker)
- Optional note (max 200 characters, e.g. "Looking for an advanced doubles partner")
- "Post" button (validated via `react-hook-form`)
- If availability already exists for that sport + date, it's updated (not duplicated)
- If a date range is selected (e.g. Mon–Wed), the client expands it into individual rows per date in a single batch upsert

### 11.12 Settings
- Language (CZ / EN)
- Location (city picker from curated list)
- Notification preferences (on/off per type)
- Log out
- Delete account (with explicit confirmation dialog — required for App Store)

### 11.13 Account deletion flow
- Deleting an account is irreversible
- All future events organized by the user are cancelled
- The user is removed from future events they joined
- The user is signed out on all devices
- Their profile photo is deleted
- Their availability signals are deleted
- Past participation, messages, thumbs-up records, and audit records remain for integrity, but are displayed as "Deleted User" with no avatar

### 11.14 Skill level selection modal
- Triggered on first interaction with a sport (create or join an event for a sport with no `user_sports` row)
- Shows the sport name and icon
- Four options: Beginner / Intermediate / Advanced / Pro — each with a short description:
  - **Beginner:** "I'm just starting out or play very casually"
  - **Intermediate:** "I play regularly and know the fundamentals"
  - **Advanced:** "I'm competitive and play at a high level"
  - **Pro:** "I compete in tournaments or play professionally"
- User must select one before proceeding
- Selection creates the `user_sports` row and continues the original action (create/join)

### 11.15 Force update screen
- Shown when the app version is below `minimum_app_version_ios` / `_android` from `app_config`
- Blocking — no way to dismiss or bypass
- Message: "A new version of Hrayem is available. Please update to continue."
- Single button: "Update" — opens the App Store or Google Play listing
- This prevents users on old, incompatible versions from hitting broken APIs after a breaking backend change

### 11.16 Offline banner
- A persistent, non-dismissable banner at the top of the screen when the device has no internet connection
- Message: "You're offline. Some features may be unavailable."
- Disappears automatically when connectivity is restored
- Does not block navigation or reading cached data — users can still browse cached feed, view cached event details, read cached chat history

---

## 12. Reporting and Trust

### 12.1 MVP scope
Full moderation (blocking, banning, admin panel) is post-MVP. However, the app must have a basic reporting mechanism from day one to maintain a safe, welcoming environment.

### 12.2 Report flow
- Any authenticated user can report an event or a player
- Report reasons (predefined, single-select):
  - Inappropriate content
  - Spam or fake event
  - Abusive behavior
  - Other (with optional free-text field, max 300 characters)
- Reports are stored in a `reports` table (see BACKEND.md)
- Reports are reviewed manually by the team (email notification to an admin address on each new report)
- A user cannot report the same target (event or player) more than once

### 12.3 No-show abuse protection
To prevent organizers from creating fake events to inflate no-show counts:
- No-show reports are only allowed for events with **2 or more confirmed players** (excluding the organizer)
- This means an organizer cannot create a solo event and report a phantom player
- This constraint is enforced server-side in the `report-no-show` Edge Function

### 12.4 UI placement
- Event detail screen: "Report event" option in overflow menu (⋯)
- Player profile snippet: "Report player" option in overflow menu
- After reporting: confirmation message "Thanks for helping keep Hrayem safe. We'll review this."

---

## 13. Design Direction

**Tone:** Modern, sporty, energetic, clean. Trustworthy without being corporate.

**Not:** Gamified, cluttered, infantile, dated.

**Key visual principles:**
- Each sport has a distinct icon and color accent used consistently across cards, badges, and headers
- Skill levels displayed as color-coded badges (Beginner → Pro, distinct colors)
- Player count shown as a fill indicator (e.g. `●●○○` or `2/4`) — immediately scannable
- Event status (open / full / waitlist) must be visually immediate — never buried in text
- Play-again connections shown as a subtle, warm indicator (e.g. small 🔄 icon or colored ring around avatar) — not aggressive or gamified
- Thumbs-up percentage shown as a simple number with a 👍 icon — understated, not a leaderboard
- Profile photos rendered with `expo-image` — blur placeholders while loading, cached on disk
- Minimum touch targets: 44×44pt on all interactive elements
- Accessible labels (`accessibilityLabel`, `accessibilityHint`) on all interactive elements
- Smooth, native-feeling transitions; no janky or web-style navigation
- Haptic feedback on key actions (join confirmed, thumbs up, event created, pull-to-refresh)

**Typography and spacing:**
- Clear visual hierarchy on event cards: sport + time → venue → skill/players → secondary info
- Generous whitespace — feed app, not a dashboard
- No unnecessary decoration or chrome

**Emotions the app should evoke:**
- "This is simple."
- "I found someone to play with in 30 seconds."
- "I can trust the people here."
- "I keep running into great players."

---

## 14. App Store Readiness

The app must be built ready for App Store (iOS) and Google Play submission from the start — not retrofitted later.

### App Store metadata
- **App name:** Hrayem
- **Subtitle:** Od hráčů pro hráče
- **Slogan (in-app):** Od hráčů pro hráče *(used on splash screen and any marketing surfaces within the app)*

### Required for App Store approval
- **Apple Sign In** must be offered if any other third-party login (Google) is offered — already included in auth
- **Privacy Policy URL** — must be provided at submission; include a placeholder link in the app and in `app.json`
- **Terms of Service URL** — linked from the registration screen
- **Account deletion** — Apple requires the ability to delete an account from within the app; the delete account flow in Settings satisfies this
- **Push notification permissions** — must be requested with a clear usage description explaining why notifications are needed
- **Location permission** — must include a clear `NSLocationWhenInUseUsageDescription` string explaining the use case
- **Photo library / camera permission** — required for profile photo upload
- **Calendar permission** — required for "Add to calendar" feature; include `NSCalendarsFullAccessUsageDescription` explaining that the app adds game events to the user's calendar
- **No placeholder or lorem ipsum content** — all demo data must be removed before submission
- **Associated domains** (iOS) and **app links** (Android) must be configured for deep linking

### `app.json` / `app.config.js` must include
- `bundleIdentifier` (iOS) and `package` (Android) — set from day one, never changed after first release
- `version` and `buildNumber` / `versionCode` — increment correctly on every release
- All permission usage description strings
- Privacy Policy URL
- App icons and splash screens for all required sizes (use Expo's asset pipeline)
- Deep link scheme and associated domain configuration

### Build and release process
- Use EAS Build (Expo Application Services) for both iOS and Android builds
- Use EAS Submit for App Store and Play Store submission
- Maintain separate `development`, `preview`, and `production` build profiles in `eas.json`
- Never use a development build for store submission
- Configure Sentry source map upload in EAS Build for production profiles

---

## 15. Launch Strategy

### 15.1 Community seeding (pre-launch requirement)
The cold start problem kills marketplace apps. Before submitting to the App Store:
- Identify **10–15 active racket sport players** in Ostrava (badminton clubs, padel courts, squash leagues)
- Onboard them as founding users; have them create real events in the app
- **The feed must show 5–10 real upcoming games** the day the app goes live for organic users
- These founding users also seed the venue list with real, correctly-named venues

This is not optional. An empty feed on day one means a dead app.

### 15.2 Venue seeding
Before launch, pre-populate the `venues` table with the most popular sports venues in Ostrava (and other launch cities). Source venues from Google Maps, local sports directories, and the founding user community.

### 15.3 Web fallback page
Before launch, deploy a simple static page at the deep link domain (e.g. `hrayem.cz`) that:
- Shows event details when accessed via an event link (server-rendered or fetched client-side)
- Includes "Download on App Store" and "Get it on Google Play" buttons
- Serves as the Privacy Policy and Terms of Service host

---

## 16. Future Features (Post-MVP)

These are explicitly out of scope for MVP. Do not implement or scaffold them unless instructed.

- Post-game detailed ratings (skill accuracy, sportsmanship, reliability — replacing simple thumbs-up)
- Advanced search filters and player recommendations
- **B2B venue reservation system** — sports facilities claim their venue profile, manage court calendars, pricing, and availability directly through Hrayem; web dashboard for facility managers
- Automated game statistics and charts
- Monetization (premium accounts, promoted events, booking fees for facilities)
- Player-to-player messaging (outside of event chat)
- Recurring events
- Player blocking and advanced moderation (admin panel, bans)
- Radius-based location filtering (replacing city-based)
- Leaderboards and player benchmarks by city / sport
- Dispute mechanism for no-show reports
- Verified venue profiles with photos, amenities, and reviews

---

## 17. Out of Scope for MVP

- Payment processing of any kind
- Court booking / reservation management
- Player-to-player direct messaging
- Admin / moderation panel (reports are handled manually)
- Analytics dashboard
- Web version (beyond the simple deep link fallback page)
- Venue owner accounts
