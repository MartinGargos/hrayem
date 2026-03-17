# Hrayem — Backend Specification
## MVP v1.0

---

## 1. Stack

| Layer | Technology |
|---|---|
| Platform | Supabase (Postgres + Auth + Realtime + Storage + Edge Functions) |
| Auth | Supabase Auth — email/password, Apple Sign In, Google Sign In (OAuth) |
| API | Supabase PostgREST (standard CRUD reads) + Edge Functions (all business logic writes) |
| Real-time | Supabase Realtime (chat, event player list, event status changes) |
| File storage | Supabase Storage (profile photos) |
| Push notifications | Expo Push Notification Service (EPNS), triggered via Edge Functions |
| Auth tokens | JWT — managed by Supabase Auth; short-lived access tokens + refresh tokens |

**Design principle:** PostgREST handles all simple reads. Edge Functions handle all writes that involve business logic, state transitions, or side effects. Never expose raw table writes for these operations — the client never writes directly to `events`, `event_players`, `chat_messages`, or `no_show_reports`.

---

## 2. Data Model

### 2.1 `profiles`
Extends Supabase `auth.users`. Created automatically on registration via a Postgres trigger on `auth.users`.

```sql
id              uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE
first_name      text NOT NULL CHECK (char_length(first_name) BETWEEN 1 AND 50)
last_name       text NOT NULL CHECK (char_length(last_name) BETWEEN 1 AND 50)
photo_url       text                         -- Supabase Storage public URL
city            text
latitude        double precision
longitude       double precision
language        text NOT NULL DEFAULT 'cs' CHECK (language IN ('cs', 'en'))
is_deleted      boolean NOT NULL DEFAULT false   -- soft delete; see section 10
created_at      timestamptz NOT NULL DEFAULT now()
updated_at      timestamptz NOT NULL DEFAULT now()
```

`updated_at` is kept current via a shared Postgres trigger (see section 9).

---

### 2.2 `device_tokens`
Users may be logged in on multiple devices. One row per device.

```sql
id          uuid PRIMARY KEY DEFAULT gen_random_uuid()
user_id     uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE
token       text NOT NULL
platform    text NOT NULL CHECK (platform IN ('ios', 'android'))
created_at  timestamptz NOT NULL DEFAULT now()
updated_at  timestamptz NOT NULL DEFAULT now()
UNIQUE (user_id, token)
```

On login: upsert the device's Expo push token. On logout: delete the row for that token.
Push notifications fan out to all `device_tokens` rows for a given `user_id`.

---

### 2.3 `sports`
Seeded at deploy time. Not user-editable. Adding a new sport = one new row, zero code changes.

```sql
id          uuid PRIMARY KEY DEFAULT gen_random_uuid()
slug        text UNIQUE NOT NULL     -- 'badminton' | 'padel' | 'squash'
name_cs     text NOT NULL
name_en     text NOT NULL
icon_name   text NOT NULL            -- maps to a bundled icon asset name in the app
color_hex   text NOT NULL            -- primary brand color for this sport
sort_order  int NOT NULL DEFAULT 0   -- controls display order in UI
is_active   boolean NOT NULL DEFAULT true  -- toggle sport visibility without deleting
created_at  timestamptz NOT NULL DEFAULT now()
```

---

### 2.4 `user_sports`
One row per (user × sport). Created on first interaction. Never deleted — only updated.

```sql
id              uuid PRIMARY KEY DEFAULT gen_random_uuid()
user_id         uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE
sport_id        uuid NOT NULL REFERENCES sports(id)
skill_level     smallint NOT NULL CHECK (skill_level BETWEEN 1 AND 4)
                -- 1 = Beginner, 2 = Intermediate, 3 = Advanced, 4 = Pro
games_played    int NOT NULL DEFAULT 0
hours_played    numeric(8, 2) NOT NULL DEFAULT 0
no_shows        int NOT NULL DEFAULT 0
updated_at      timestamptz NOT NULL DEFAULT now()
UNIQUE (user_id, sport_id)
```

`games_played` and `hours_played` are incremented exclusively by the `finish-event` Edge Function when an event transitions to `finished` (see section 5.5). The client never writes to these counters directly.

---

### 2.5 `events`

```sql
id                  uuid PRIMARY KEY DEFAULT gen_random_uuid()
sport_id            uuid NOT NULL REFERENCES sports(id)
organizer_id        uuid NOT NULL REFERENCES profiles(id)
starts_at           timestamptz NOT NULL     -- full datetime in UTC; client displays in local TZ
ends_at             timestamptz NOT NULL
venue_name          text NOT NULL CHECK (char_length(venue_name) BETWEEN 1 AND 100)
city                text NOT NULL
reservation_type    text NOT NULL CHECK (reservation_type IN ('reserved', 'to_be_arranged'))
player_count_total  smallint NOT NULL CHECK (player_count_total BETWEEN 2 AND 20)
skill_min           smallint NOT NULL CHECK (skill_min BETWEEN 1 AND 4)
skill_max           smallint NOT NULL CHECK (skill_max BETWEEN 1 AND 4)
description         text CHECK (char_length(description) <= 500)
status              text NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active', 'full', 'finished', 'cancelled'))
reminder_sent       boolean NOT NULL DEFAULT false   -- prevents duplicate reminder pushes
no_show_window_end  timestamptz    -- set to ends_at + 24h when status → finished
created_at          timestamptz NOT NULL DEFAULT now()
updated_at          timestamptz NOT NULL DEFAULT now()

CONSTRAINT skill_range_valid CHECK (skill_min <= skill_max)
CONSTRAINT event_duration_valid CHECK (ends_at > starts_at)
```

**Why `timestamptz` instead of split date/time columns:** A single `timestamptz` is stored in UTC and correctly handles daylight saving time, midnight-spanning events, and timezone-aware comparisons. Split `date` + `time` columns create silent bugs at timezone boundaries.

**Spot counting:** Derived at query time — `COUNT(*) FROM event_players WHERE event_id = X AND status = 'confirmed'`. The organizer is always inserted as a `confirmed` player on event creation, so spot counts always include them accurately.

---

### 2.6 `event_players`

```sql
id              uuid PRIMARY KEY DEFAULT gen_random_uuid()
event_id        uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE
user_id         uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE
status          text NOT NULL CHECK (status IN ('confirmed', 'waitlisted', 'removed'))
joined_at       timestamptz NOT NULL DEFAULT now()
-- joined_at is set once on first join and never updated on subsequent status changes.
-- This preserves correct FIFO ordering across leave/rejoin cycles.
UNIQUE (event_id, user_id)
```

**Re-joining:** If a player leaves and rejoins, the row is updated via `UPSERT` (status changes, `joined_at` stays). This means a player who leaves and rejoins retains their original queue position on the waitlist — they do not jump ahead of others who joined later.

Waitlist order: `joined_at ASC WHERE status = 'waitlisted'`.

---

### 2.7 `chat_messages`

```sql
id          uuid PRIMARY KEY DEFAULT gen_random_uuid()
event_id    uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE
user_id     uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE
body        text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 1000)
sent_at     timestamptz NOT NULL DEFAULT now()
is_deleted  boolean NOT NULL DEFAULT false  -- soft delete; body treated as null in UI
```

Chat access (read + write) is enforced at the Edge Function level rather than purely via RLS, because a per-row RLS subquery ("is this user confirmed for this event?") is expensive at scale and creates N+1 risks on list reads.

---

### 2.8 `no_show_reports`
Immutable audit log. One row per (event × reported player). Cannot be undone.

```sql
id              uuid PRIMARY KEY DEFAULT gen_random_uuid()
event_id        uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE
reported_user   uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE
reported_by     uuid NOT NULL REFERENCES profiles(id)
sport_id        uuid NOT NULL REFERENCES sports(id)  -- denormalized for trigger simplicity
created_at      timestamptz NOT NULL DEFAULT now()
UNIQUE (event_id, reported_user)
```

On insert: a Postgres trigger increments `user_sports.no_shows` for `(reported_user, sport_id)`.

---

### 2.9 `notification_log`
Audit trail for all sent push notifications. Used for debugging delivery failures and future per-type muting.

```sql
id              uuid PRIMARY KEY DEFAULT gen_random_uuid()
user_id         uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE
event_id        uuid REFERENCES events(id) ON DELETE SET NULL
type            text NOT NULL
                -- 'join_confirmed' | 'waitlist_promoted' | 'event_cancelled' |
                -- 'event_full' | 'chat_message' | 'event_reminder' |
                -- 'player_joined' | 'player_removed'
payload         jsonb          -- full push payload snapshot for debugging
status          text NOT NULL DEFAULT 'sent' CHECK (status IN ('sent', 'failed'))
created_at      timestamptz NOT NULL DEFAULT now()
```

---

## 3. Derived Views

### 3.1 `event_feed_view`
Used by the home feed. Joins event + sport + organizer + live spot counts. Avoids N+1 on the client.

```sql
CREATE VIEW event_feed_view AS
SELECT
  e.id,
  e.sport_id,
  s.slug              AS sport_slug,
  s.name_cs           AS sport_name_cs,
  s.name_en           AS sport_name_en,
  s.icon_name         AS sport_icon,
  s.color_hex         AS sport_color,
  e.organizer_id,
  p.first_name        AS organizer_first_name,
  p.photo_url         AS organizer_photo_url,
  e.starts_at,
  e.ends_at,
  e.venue_name,
  e.city,
  e.reservation_type,
  e.player_count_total,
  e.skill_min,
  e.skill_max,
  e.description,
  e.status,
  COUNT(ep.id) FILTER (WHERE ep.status = 'confirmed')  AS spots_taken,
  COUNT(ep.id) FILTER (WHERE ep.status = 'waitlisted') AS waitlist_count,
  e.created_at
FROM events e
JOIN sports s ON s.id = e.sport_id AND s.is_active = true
JOIN profiles p ON p.id = e.organizer_id AND p.is_deleted = false
LEFT JOIN event_players ep ON ep.event_id = e.id
WHERE e.status IN ('active', 'full')
GROUP BY e.id, s.id, p.id;
```

---

## 4. Row-Level Security (RLS)

All tables have RLS enabled. The `service_role` key (used only by Edge Functions) bypasses RLS.

| Table | Read | Write |
|---|---|---|
| `profiles` | Any authenticated user; `is_deleted = false` only | Own row only |
| `device_tokens` | Own rows only | Own rows only |
| `sports` | Any authenticated user (`is_active = true`) | Service role only |
| `user_sports` | Any authenticated user | Own rows only |
| `events` | Any authenticated user | Service role only (via Edge Functions) |
| `event_players` | Any authenticated user | Service role only (via Edge Functions) |
| `chat_messages` | Own rows (writes); read enforced in Edge Function | Service role only (via Edge Functions) |
| `no_show_reports` | Organizer of event only | Service role only (via Edge Functions) |
| `notification_log` | Own rows only | Service role only |

**Key principle:** RLS is a safety net. All business logic lives in Edge Functions using `service_role`. Never rely on RLS alone for complex access rules.

---

## 5. Edge Functions

All Edge Functions:
- Require a valid JWT (`Authorization: Bearer <token>`) — no anonymous calls accepted
- Use `service_role` internally for atomic DB operations (bypasses RLS safely)
- Return consistent error shapes: `{ "error": { "code": "...", "message": "..." } }`
- Are versioned under `/v1/`

---

### 5.1 `POST /v1/events` — `create-event`

```
Input:  sport_id, starts_at, ends_at, venue_name, city, reservation_type,
        player_count_total, skill_min, skill_max, description?
Auth:   JWT
```

Logic:
1. Validate all fields; enforce `skill_min <= skill_max`, `ends_at > starts_at`, `starts_at > now()`
2. Upsert `user_sports` for `(organizer, sport_id)` — create with `skill_level = 1` if first interaction
3. Insert into `events`
4. Insert organizer into `event_players` as `confirmed` — organizer always holds one spot
5. Return the created event

---

### 5.2 `POST /v1/events/:id/join` — `join-event`

```
Input:  event_id (path)
Auth:   JWT
```

**Race condition protection:** Uses `SELECT ... FOR UPDATE` on the event row. Two simultaneous joins cannot both pass the capacity check — only one will acquire the lock first.

Logic:
1. `SELECT * FROM events WHERE id = $1 FOR UPDATE`
2. Validate event is `active` or `full`; validate `starts_at > now()`
3. Validate player is not the organizer (already in as confirmed)
4. Check existing `event_players` row → if already `confirmed` or `waitlisted`, return `ALREADY_JOINED`
5. Count confirmed: `SELECT COUNT(*) FROM event_players WHERE event_id = $1 AND status = 'confirmed'`
6. If `spots_taken < player_count_total`: upsert `confirmed`; else upsert `waitlisted`
7. `joined_at` set only on first insert; preserved on upsert (re-join preserves queue position)
8. If newly confirmed and event now full: update `events.status = 'full'`; notify organizer "Event is now full"
9. Notify organizer: "Someone joined your event"
10. Notify player: "You're confirmed!" or "You're on the waitlist — position #N"
11. Upsert `user_sports` for `(player, sport_id)` if not exists
12. Log to `notification_log`

---

### 5.3 `POST /v1/events/:id/leave` — `leave-event`

```
Input:  event_id (path), target_user_id? (if organizer removing someone else)
Auth:   JWT (must be target player OR organizer)
```

Logic:
1. Validate caller is the target player or the organizer
2. Validate target is not the organizer (organizer must cancel the event instead)
3. `SELECT * FROM events WHERE id = $1 FOR UPDATE`
4. Upsert `event_players.status = 'removed'`
5. If leaving player was `confirmed`:
   - Find first waitlisted: `ORDER BY joined_at ASC LIMIT 1`
   - If found: upsert to `confirmed`; notify "A spot opened — you're confirmed!"
   - Update event `status` back to `active` if it was `full`
6. If organizer removed the player: notify removed player "You were removed from the event"
7. Log to `notification_log`

---

### 5.4 `POST /v1/events/:id/cancel` — `cancel-event`

```
Input:  event_id (path)
Auth:   JWT (must be organizer)
```

Logic:
1. Validate caller is organizer
2. Validate event is not already `finished` or `cancelled`
3. Update `events.status = 'cancelled'`
4. Fetch all `confirmed` + `waitlisted` players (excluding organizer)
5. Send push to all: "The [sport] game at [venue] on [date] was cancelled"
6. Log to `notification_log`

---

### 5.5 `finish-event` — scheduled cron (every 10 minutes)

Logic (all writes in a single transaction per event):

**Pass 1 — Reminders:**
- Find `active` or `full` events where `starts_at` is within `now() + 1h50m` to `now() + 2h10m` AND `reminder_sent = false`
- Send push to all confirmed players + organizer: "Reminder: [sport] at [venue] starts in 2 hours"
- Set `events.reminder_sent = true`

**Pass 2 — Finish:**
- Find `active` or `full` events where `ends_at < now()`
- Set `status = 'finished'`
- Set `no_show_window_end = ends_at + interval '24 hours'`
- For each confirmed player (including organizer):
  - Upsert `user_sports (user_id, sport_id)`:
    - `games_played += 1`
    - `hours_played += EXTRACT(EPOCH FROM (ends_at - starts_at)) / 3600`

---

### 5.6 `POST /v1/events/:id/no-show` — `report-no-show`

```
Input:  event_id (path), reported_user_id
Auth:   JWT (must be organizer)
```

Logic:
1. Validate caller is organizer
2. Validate `now() < no_show_window_end`
3. Validate reported user had `status = 'confirmed'` (never waitlisted)
4. Check for duplicate: `UNIQUE (event_id, reported_user)` will reject if already reported
5. Insert into `no_show_reports` (with denormalized `sport_id`)
6. Postgres trigger fires → `user_sports.no_shows += 1` for `(reported_user, sport_id)`

---

### 5.7 `POST /v1/events/:id/messages` — `send-message`

```
Input:  event_id (path), body
Auth:   JWT
```

Logic:
1. Validate caller has `status = 'confirmed'` in `event_players` OR is organizer
2. Validate event is not `cancelled`
3. Validate `body` length (1–1000 chars)
4. Insert into `chat_messages`
5. Supabase Realtime broadcasts to subscribers
6. Send push to all other confirmed players + organizer (if app backgrounded): "New message in [sport] at [venue]"
7. Log to `notification_log`

---

## 6. Real-time Subscriptions

| Channel | Table | Filter | Events | Screen |
|---|---|---|---|---|
| `event:{id}:chat` | `chat_messages` | `event_id = {id}` | `INSERT` | Chat screen |
| `event:{id}:players` | `event_players` | `event_id = {id}` | `INSERT`, `UPDATE` | Event detail |
| `event:{id}:status` | `events` | `id = {id}` | `UPDATE` | Event detail, My games |

All subscriptions require a valid JWT. RLS gates which users can subscribe to which channels — a non-confirmed player cannot subscribe to the chat channel.

---

## 7. Storage

**Bucket:** `avatars`

| Property | Value |
|---|---|
| Visibility | Public read |
| Write access | Authenticated; own folder only — `avatars/{user_id}/` |
| Max file size | 5 MB |
| Accepted MIME types | `image/jpeg`, `image/png`, `image/webp` |
| Client pre-processing | Resize + crop to 512×512px, compress to ≤ 200 KB before upload |
| Filename | `avatars/{user_id}/avatar.{ext}` — overwrite on update, single file per user |

On account deletion: storage folder deleted as part of the deletion Edge Function.

---

## 8. Key Indexes

```sql
-- Home feed: city + sport + status + time
CREATE INDEX idx_events_feed ON events (city, sport_id, status, starts_at)
  WHERE status IN ('active', 'full');

-- Cron: events to finish
CREATE INDEX idx_events_finish ON events (ends_at, status)
  WHERE status IN ('active', 'full');

-- Cron: events to remind (partial — only unsent reminders)
CREATE INDEX idx_events_remind ON events (starts_at, status, reminder_sent)
  WHERE status IN ('active', 'full') AND reminder_sent = false;

-- Waitlist ordering (partial — only waitlisted rows)
CREATE INDEX idx_event_players_waitlist ON event_players (event_id, joined_at)
  WHERE status = 'waitlisted';

-- Confirmed players (spot counting, chat access checks)
CREATE INDEX idx_event_players_confirmed ON event_players (event_id, user_id)
  WHERE status = 'confirmed';

-- Chat feed
CREATE INDEX idx_chat_messages_event ON chat_messages (event_id, sent_at)
  WHERE is_deleted = false;

-- User sport stats
CREATE INDEX idx_user_sports_lookup ON user_sports (user_id, sport_id);

-- Push fan-out
CREATE INDEX idx_device_tokens_user ON device_tokens (user_id);
```

---

## 9. Shared Postgres Triggers

### 9.1 `updated_at` auto-update
```sql
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply to: profiles, events, user_sports, event_players, device_tokens
CREATE TRIGGER trg_profiles_updated_at
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
-- (repeat for each table)
```

### 9.2 `create_profile_on_signup`
```sql
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO profiles (id, language)
  VALUES (NEW.id, 'cs');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trg_create_profile
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();
```

### 9.3 `increment_no_shows`
```sql
CREATE OR REPLACE FUNCTION handle_no_show_report()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO user_sports (user_id, sport_id, skill_level, no_shows)
  VALUES (NEW.reported_user, NEW.sport_id, 1, 1)
  ON CONFLICT (user_id, sport_id)
  DO UPDATE SET
    no_shows   = user_sports.no_shows + 1,
    updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trg_no_show_report
  AFTER INSERT ON no_show_reports
  FOR EACH ROW EXECUTE FUNCTION handle_no_show_report();
```

---

## 10. Account Deletion and GDPR

When a user requests account deletion (required for App Store compliance and GDPR):

1. Set `profiles.is_deleted = true`
2. Anonymize PII: `first_name = 'Deleted'`, `last_name = 'User'`, `photo_url = null`, `city = null`, `latitude = null`, `longitude = null`
3. Delete all `device_tokens` rows (stops all future push delivery immediately)
4. Delete the `auth.users` row (cascades to `profiles`)
5. Delete `avatars/{user_id}/` from Storage
6. `event_players` rows are retained — displayed as "Deleted User" in UI (event integrity)
7. `no_show_reports` rows are retained for audit integrity

**Soft-deleted events** (`status = 'cancelled'`) are never hard-deleted. Chat history, player records, and no-show reports must remain queryable for data integrity.

---

## 11. API Conventions

| Convention | Value |
|---|---|
| Timestamp format | ISO 8601 UTC — `2025-06-15T14:00:00Z` |
| ID format | UUID v4 |
| Pagination | `?limit=20&offset=0`; default 20, max 100 |
| Error shape | `{ "error": { "code": "EVENT_FULL", "message": "human-readable" } }` |
| Edge Function prefix | `/v1/` |
| Language | `Accept-Language: cs` or `en` header — used for push notification copy |

**Standard error codes:**
```
AUTH_REQUIRED            — missing or expired JWT
ALREADY_JOINED           — player already confirmed or waitlisted
EVENT_NOT_FOUND          — event does not exist or is cancelled
EVENT_FINISHED           — event has already ended
NOT_ORGANIZER            — action requires organizer role
NO_SHOW_WINDOW_CLOSED    — 24h reporting window has passed
DUPLICATE_REPORT         — no-show already filed for this player in this event
CANNOT_REMOVE_ORGANIZER  — organizer cannot be removed; must cancel event
SKILL_LEVEL_REQUIRED     — user has no sport profile for this sport yet
VALIDATION_ERROR         — input failed schema validation (see message for details)
```

---

## 12. Rate Limiting

| Endpoint | Limit |
|---|---|
| `join-event` | 10 req / min / user |
| `leave-event` | 10 req / min / user |
| `send-message` | 30 req / min / user |
| `report-no-show` | 20 req / min / user |
| Auth endpoints | Managed by Supabase Auth built-in limits |

HTTP 429 returned on excess. Enforced via Supabase's built-in rate limiting.

---

## 13. Environment Variables

```bash
# Client (EXPO_PUBLIC_ prefix — safe to bundle in app binary)
EXPO_PUBLIC_SUPABASE_URL
EXPO_PUBLIC_SUPABASE_ANON_KEY

# Edge Functions only — never exposed to client
SUPABASE_SERVICE_ROLE_KEY
EXPO_PUSH_ACCESS_TOKEN      # for authenticated Expo push API requests
```

---

## 14. Seed Data

Run once on initial deploy:

```sql
INSERT INTO sports (slug, name_cs, name_en, icon_name, color_hex, sort_order) VALUES
  ('badminton', 'Badminton', 'Badminton', 'sport-badminton', '#4CAF50', 1),
  ('padel',     'Padel',     'Padel',     'sport-padel',     '#2196F3', 2),
  ('squash',    'Squash',    'Squash',    'sport-squash',    '#FF5722', 3);
```

To add a new sport in future: insert one row + deploy the icon asset. No migrations, no code changes required.

---

## 15. Future Considerations (Out of Scope for MVP)

Do not scaffold or stub these.

| Feature | Likely implementation |
|---|---|
| Post-game ratings | `event_ratings` table; triggered after `finished` |
| Venue profiles | `venues` table; `events.venue_id` FK replaces free-text `venue_name` |
| Court reservation | `reservations` table; webhook integration with venue systems |
| Player recommendations | Similarity query on `user_sports` + event history |
| Notification muting | `notification_preferences` table per user per type |
| Player blocking | `user_blocks` table; filtered from feed and join eligibility |
| Full-text search | Postgres `tsvector` on `venue_name` + `description` |
| Analytics | Read replica or separate OLAP pipeline — never query production DB |
| Monetization | `subscriptions` table; Stripe webhook handler |
