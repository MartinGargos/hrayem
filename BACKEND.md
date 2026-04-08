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
| Rate limiting | Upstash Redis (accessed from Edge Functions via REST API) |

**Design principle:** PostgREST handles all simple reads. Edge Functions handle all writes that involve business logic, state transitions, or side effects. Never expose raw table writes for these operations — the client never writes directly to `events`, `event_players`, `chat_messages`, `no_show_reports`, or server-controlled columns on `user_sports`.

---

## 2. Data Model

The curated MVP city set is enforced in the database via `private.cities`, a private lookup table seeded in migrations. That database catalog is the authoritative allowed-write source; the client picker mirrors it in `src/constants/cities.ts`. Any public table that stores a city value references `private.cities` so client or service-role writes cannot drift outside the supported set.

### 2.1 `profiles`
Extends Supabase `auth.users`. Created automatically on registration via a Postgres trigger on `auth.users`.

```sql
id              uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE
first_name      text CHECK (first_name IS NULL OR char_length(first_name) BETWEEN 1 AND 50)
last_name       text CHECK (last_name IS NULL OR char_length(last_name) BETWEEN 1 AND 50)
photo_url       text                         -- Supabase Storage public URL
city            text REFERENCES private.cities(name)
latitude        double precision
longitude       double precision
language        text NOT NULL DEFAULT 'cs' CHECK (language IN ('cs', 'en'))
is_deleted      boolean NOT NULL DEFAULT false   -- soft delete; see section 10
profile_complete boolean NOT NULL DEFAULT false  -- true once first_name, last_name, city are set
created_at      timestamptz NOT NULL DEFAULT now()
updated_at      timestamptz NOT NULL DEFAULT now()
```

**Why `first_name` and `last_name` are nullable:** The profile row is created automatically by a trigger on `auth.users` at registration time, before the user has filled in the profile setup screen. The fields are populated during profile setup. The app gates access to the main screens behind `profile_complete = true`.

**`profile_complete` is server-computed:** An `UPDATE` trigger on `profiles` sets `profile_complete = true` whenever `first_name IS NOT NULL AND last_name IS NOT NULL AND city IS NOT NULL`. The client never writes `profile_complete` directly.

`updated_at` is kept current via a shared Postgres trigger (see section 9).

---

### 2.2 `device_tokens`
Users may be logged in on multiple devices. One row per device.

```sql
id          uuid PRIMARY KEY DEFAULT gen_random_uuid()
user_id     uuid REFERENCES profiles(id) ON DELETE SET NULL
token       text NOT NULL
platform    text NOT NULL CHECK (platform IN ('ios', 'android'))
ownership_key text NOT NULL         -- opaque per-install ownership proof, stored only on that app install
created_at  timestamptz NOT NULL DEFAULT now()
updated_at  timestamptz NOT NULL DEFAULT now()
UNIQUE (token)
```

The Expo push token is treated as the device identity for MVP, so the same token must never stay attached to multiple users over time. The client also stores a small opaque per-install ownership key in secure local storage and sends it on every claim/delete RPC. That keeps same-device account switches working while preventing another authenticated user from stealing or deleting a token row just by knowing the raw Expo token. For migration durability, the current owner of an existing row may refresh that row onto the new ownership key on the next launch.

On login/app launch: claim the device's Expo push token. On logout or permission loss: delete the row for that token.
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

### 2.4 `venues`
Crowdsourced by users. One record per physical location. Designed to be claimed by facility owners in a future B2B phase.

```sql
id              uuid PRIMARY KEY DEFAULT gen_random_uuid()
name            text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 100)
city            text NOT NULL REFERENCES private.cities(name)
address         text CHECK (address IS NULL OR char_length(address) <= 200)
created_by      uuid REFERENCES profiles(id) ON DELETE SET NULL
is_verified     boolean NOT NULL DEFAULT false  -- future: set true when facility claims venue
created_at      timestamptz NOT NULL DEFAULT now()
updated_at      timestamptz NOT NULL DEFAULT now()
```

**Why this exists from day one:** Free-text venue names lead to "SportCentrum Ostrava", "Sport Centrum", "Sportcentrum — Ostrava" all being different entries. This kills data quality, breaks search, and makes it impossible to tell a facility "47 games were organized at your courts last month." The structured table fixes this now and becomes the foundation for the B2B venue reservation product later.

**Uniqueness:** There is no hard unique constraint on `(name, city)` because real venues can have similar names. Deduplication is handled through search-first UX (the client shows existing matches before allowing "Add new") and manual cleanup as needed.

---

### 2.5 `user_sports`
One row per (user × sport). Created on first interaction with user-declared skill level. Updated over time and deleted only if the owning profile is deleted.

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

**Write access rules:**
- `skill_level`: Writable by the owning user (via RLS — see section 4).
- `games_played`, `hours_played`: Written exclusively by the `finish-event` cron job. Never by the client.
- `no_shows`: Written exclusively by the `increment_no_shows` Postgres trigger on `no_show_reports` insert. Never by the client.

**RLS enforces column-level safety** — see section 4 for the specific policy that restricts client writes to `skill_level` only.

**Thumbs-up percentage** is computed at query time from the `post_game_thumbs` table (see section 3.2), not stored on this row. This avoids denormalization drift.

---

### 2.6 `events`

```sql
id                  uuid PRIMARY KEY DEFAULT gen_random_uuid()
sport_id            uuid NOT NULL REFERENCES sports(id)
organizer_id        uuid REFERENCES profiles(id) ON DELETE SET NULL
venue_id            uuid NOT NULL REFERENCES venues(id)
starts_at           timestamptz NOT NULL     -- full datetime in UTC; client displays in local TZ
ends_at             timestamptz NOT NULL
city                text NOT NULL REFERENCES private.cities(name)  -- denormalized from venue; used for feed index
reservation_type    text NOT NULL CHECK (reservation_type IN ('reserved', 'to_be_arranged'))
player_count_total  smallint NOT NULL CHECK (player_count_total BETWEEN 2 AND 20)
skill_min           smallint NOT NULL CHECK (skill_min BETWEEN 1 AND 4)
skill_max           smallint NOT NULL CHECK (skill_max BETWEEN 1 AND 4)
description         text CHECK (char_length(description) <= 500)
status              text NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active', 'full', 'finished', 'cancelled'))
reminder_sent       boolean NOT NULL DEFAULT false   -- prevents duplicate reminder pushes
no_show_window_end  timestamptz    -- set to ends_at + 24h when status → finished
chat_closed_at      timestamptz    -- set to ends_at + 48h when status → finished; NULL = chat open
created_at          timestamptz NOT NULL DEFAULT now()
updated_at          timestamptz NOT NULL DEFAULT now()

CONSTRAINT skill_range_valid CHECK (skill_min <= skill_max)
CONSTRAINT event_duration_valid CHECK (ends_at > starts_at)
```

**Why `venue_id` instead of free-text `venue_name`:** See section 2.4. The venue record provides the name, city, and address. `events.city` is denormalized from `venues.city` at creation time for index performance on the feed query. If the venue record were ever updated, existing events retain their original city.

**Why `timestamptz` instead of split date/time columns:** A single `timestamptz` is stored in UTC and correctly handles daylight saving time, midnight-spanning events, and timezone-aware comparisons. Split `date` + `time` columns create silent bugs at timezone boundaries.

**Spot counting:** Derived at query time — `COUNT(*) FROM event_players WHERE event_id = X AND status = 'confirmed'`. The organizer is always inserted as a `confirmed` player on event creation, so spot counts always include them accurately.

**Chat window:** `chat_closed_at` is set to `ends_at + 48 hours` when the event finishes. The `send-message` Edge Function checks this timestamp. `NULL` means the chat is open (for active/full events). For cancelled events, `chat_closed_at` is set to `now()` (immediate close).

---

### 2.7 `event_players`

```sql
id              uuid PRIMARY KEY DEFAULT gen_random_uuid()
event_id        uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE
user_id         uuid REFERENCES profiles(id) ON DELETE SET NULL
status          text NOT NULL CHECK (status IN ('confirmed', 'waitlisted', 'removed'))
joined_at       timestamptz NOT NULL DEFAULT now()
updated_at      timestamptz NOT NULL DEFAULT now()
-- joined_at is set once on first join and never updated on subsequent status changes.
-- This preserves correct FIFO ordering across leave/rejoin cycles.
UNIQUE (event_id, user_id)
```

**Re-joining:** If a player leaves and rejoins, the row is updated via `UPSERT` (status changes, `joined_at` stays). This means a player who leaves and rejoins retains their original queue position on the waitlist — they do not jump ahead of others who joined later.

**Design trade-off documented:** Preserving `joined_at` on rejoin means a player who left and came back may be ahead of someone who stayed committed. This is a deliberate simplicity trade-off — resetting `joined_at` would be more "fair" but harder to explain to users. At MVP scale this is unlikely to cause issues.

Waitlist order: `joined_at ASC WHERE status = 'waitlisted'`.

---

### 2.8 `chat_messages`

```sql
id          uuid PRIMARY KEY DEFAULT gen_random_uuid()
event_id    uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE
user_id     uuid REFERENCES profiles(id) ON DELETE SET NULL
body        text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 1000)
sent_at     timestamptz NOT NULL DEFAULT now()
is_deleted  boolean NOT NULL DEFAULT false  -- soft delete; body treated as null in UI
```

Chat history must remain readable after account deletion. If the original sender no longer exists, the UI renders the message as coming from "Deleted User" with no avatar.

Chat reads are enforced by RLS so that history loading and Supabase Realtime subscriptions use the same access rules. Chat writes remain service-role only via the `send-message` Edge Function.

---

### 2.9 `no_show_reports`
Immutable audit log. One row per (event × reported player). Cannot be undone.

```sql
id              uuid PRIMARY KEY DEFAULT gen_random_uuid()
event_id        uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE
reported_user   uuid REFERENCES profiles(id) ON DELETE SET NULL
reported_by     uuid REFERENCES profiles(id) ON DELETE SET NULL
sport_id        uuid NOT NULL REFERENCES sports(id)  -- denormalized for trigger simplicity
created_at      timestamptz NOT NULL DEFAULT now()
UNIQUE (event_id, reported_user)
```

On insert: a Postgres trigger increments `user_sports.no_shows` for `(reported_user, sport_id)`.

**Abuse protection:** The `report-no-show` Edge Function validates that the event had at least 2 confirmed players *excluding the organizer* before allowing a no-show report. This prevents organizers from creating fake solo events to inflate others' no-show counts.

---

### 2.10 `post_game_thumbs`
Anonymous positive-only feedback between co-players after an event finishes. One thumbs-up per (event × from_user × to_user).

```sql
id          uuid PRIMARY KEY DEFAULT gen_random_uuid()
event_id    uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE
from_user   uuid REFERENCES profiles(id) ON DELETE SET NULL
to_user     uuid REFERENCES profiles(id) ON DELETE SET NULL
sport_id    uuid NOT NULL REFERENCES sports(id)  -- denormalized for stats queries
created_at  timestamptz NOT NULL DEFAULT now()

UNIQUE (event_id, from_user, to_user)
CONSTRAINT no_self_thumbs CHECK (from_user != to_user)
```

**Why `ON DELETE SET NULL` (not CASCADE):** If a player deletes their account, the thumbs-up records they gave and received must survive. CASCADE would silently reduce other players' thumbs-up percentages when someone deletes their account. With SET NULL, the record remains — the percentage calculation counts the row regardless of whether the giver still exists.

**How thumbs-up % is computed (see section 3.2):** For a given `(user, sport)`, count the number of distinct finished events where at least one co-player gave them a thumbs up (`to_user = :user`), divided by total finished events for that sport. Rows where `from_user IS NULL` (deleted account) still count — the recipient's reputation is preserved. Only displayed after 3+ games.

**Play-again connections:** Two players are "connected" if they have mutual thumbs-up entries across *any* event for that sport. Connections are only computed between non-null users. Computed at query time: `EXISTS (SELECT 1 FROM post_game_thumbs t1 JOIN post_game_thumbs t2 ON t1.from_user = t2.to_user AND t1.to_user = t2.from_user AND t1.sport_id = t2.sport_id WHERE t1.from_user = :user_a AND t1.to_user = :user_b AND t1.sport_id = :sport)`.

---

### 2.11 `player_availability`
Lightweight signal — "I want to play [sport] on [date]". No commitments, no bookings.

```sql
id              uuid PRIMARY KEY DEFAULT gen_random_uuid()
user_id         uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE
sport_id        uuid NOT NULL REFERENCES sports(id)
city            text NOT NULL REFERENCES private.cities(name)  -- denormalized from user's city for feed query
available_date  date NOT NULL
time_pref       text CHECK (time_pref IS NULL OR time_pref IN ('morning', 'afternoon', 'evening', 'any'))
note            text CHECK (note IS NULL OR char_length(note) <= 200)
created_at      timestamptz NOT NULL DEFAULT now()

UNIQUE (user_id, sport_id, available_date)
```

**Date ranges in the UX vs single dates in the schema:** The product spec (APP.md) allows users to select a date range (e.g. Monday–Wednesday). The schema stores one row per date. **The client is responsible for expanding a date range into individual rows** — selecting Monday–Wednesday inserts 3 rows with the same `time_pref` and `note`. This keeps the schema simple, the unique constraint clean, and the feed query straightforward. The client should perform this expansion in a single batch upsert.

**Cleanup:** The `finish-event` cron job (section 5.5) also deletes rows where `available_date < CURRENT_DATE` as part of its regular sweep.

---

### 2.12 `notification_log`
Audit trail for all sent push notifications. Used for debugging delivery failures and verifying notification preference behavior.

```sql
id              uuid PRIMARY KEY DEFAULT gen_random_uuid()
user_id         uuid REFERENCES profiles(id) ON DELETE SET NULL
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

### 2.13 `notification_preferences`
Per-user push notification settings. In scope for MVP.

```sql
user_id         uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE
type            text NOT NULL
                CHECK (type IN (
                  'player_joined',
                  'join_confirmed',
                  'waitlist_promoted',
                  'event_full',
                  'chat_message',
                  'event_reminder',
                  'event_cancelled',
                  'player_removed'
                ))
is_enabled      boolean NOT NULL DEFAULT true
updated_at      timestamptz NOT NULL DEFAULT now()
PRIMARY KEY (user_id, type)
```

If a row does not exist for a given `(user_id, type)`, treat it as `is_enabled = true`.

---

### 2.14 `reports`
User-submitted reports for events or players. Reviewed manually in MVP.

```sql
id              uuid PRIMARY KEY DEFAULT gen_random_uuid()
reporter_id     uuid REFERENCES profiles(id) ON DELETE SET NULL
target_type     text NOT NULL CHECK (target_type IN ('event', 'player'))
target_event_id uuid REFERENCES events(id) ON DELETE SET NULL
target_user_id  uuid REFERENCES profiles(id) ON DELETE SET NULL
reason          text NOT NULL CHECK (reason IN (
                  'inappropriate_content',
                  'spam_or_fake',
                  'abusive_behavior',
                  'other'
                ))
detail          text CHECK (detail IS NULL OR char_length(detail) <= 300)
status          text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'reviewed', 'dismissed'))
created_at      timestamptz NOT NULL DEFAULT now()

CONSTRAINT report_has_target CHECK (
  (target_type = 'event' AND target_event_id IS NOT NULL) OR
  (target_type = 'player' AND target_user_id IS NOT NULL)
)
```

```sql
CREATE UNIQUE INDEX idx_reports_dedupe ON reports (
  reporter_id,
  target_type,
  COALESCE(target_event_id, '00000000-0000-0000-0000-000000000000'::uuid),
  COALESCE(target_user_id, '00000000-0000-0000-0000-000000000000'::uuid)
);
```

On insert: an Edge Function sends an email notification to a configured admin email address for manual review. No automated actions in MVP.

---

### 2.15 `app_config`
Key-value configuration table. Used for force update checks and other runtime config that should not require a code deploy to change.

```sql
key         text PRIMARY KEY
value       text NOT NULL
updated_at  timestamptz NOT NULL DEFAULT now()
```

**Seed data:**
```sql
INSERT INTO app_config (key, value) VALUES
  ('minimum_app_version_ios', '1.0.0'),
  ('minimum_app_version_android', '1.0.0');
```

The client reads `minimum_app_version_{platform}` on every app launch, before it decides whether to show login or the authenticated app shell. If the running app version is below this value, a blocking "Please update" screen is shown. To force an update after a breaking API change, increment this value in Supabase — no code deploy needed.

RLS: readable by `anon` and `authenticated` so the launch-time force-update gate can run before login. Writable by service role only.

---

### 2.16 `consent_log`
Records when a user accepted the Terms of Service and Privacy Policy. Required for GDPR compliance.

```sql
id              uuid PRIMARY KEY DEFAULT gen_random_uuid()
user_id         uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE
terms_version   text NOT NULL     -- e.g. '2025-06-01' — version identifier of the accepted terms
privacy_version text NOT NULL     -- e.g. '2025-06-01'
accepted_at     timestamptz NOT NULL DEFAULT now()
ip_address      text              -- optional; for legal compliance
```

On registration: the client sends the current terms/privacy version. When the user already has an authenticated session, the client inserts the `consent_log` row immediately. If email confirmation delays authentication, the accepted versions are first captured in auth metadata and the app materializes the `consent_log` row immediately after the user's first successful sign-in, before app access continues.

If the terms are updated (new version deployed), the client checks on launch whether the user has a `consent_log` row matching the current version. If not, the user is prompted to accept the new terms before proceeding.

RLS: own rows only (read). Insert: any authenticated user (own `user_id` only).

---

## 3. Derived Views

### 3.1 `event_feed_view`
Used by the home feed. Joins event + sport + venue + organizer + live spot counts + organizer stats. Avoids N+1 on the client.

The view must be created with `security_invoker = true` and granted only to `authenticated` (plus `service_role`). This keeps the feed on the same access model as the underlying tables. Waitlist and confirmed counts are exposed through a narrow private aggregate function so the feed can show safe totals without exposing raw `event_players` waitlist rows.

Event detail must **not** read from `event_feed_view`. Use a separate detail read surface (for example `event_detail_view`) that keeps the same safe aggregate counts but is keyed by event visibility rules, not by feed eligibility. This allows deep-linked or shared event detail to remain readable after an event leaves the feed.

```sql
CREATE OR REPLACE FUNCTION private.event_player_counts(target_event_id uuid)
RETURNS TABLE (spots_taken bigint, waitlist_count bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    COUNT(*) FILTER (WHERE ep.status = 'confirmed')::bigint AS spots_taken,
    COUNT(*) FILTER (WHERE ep.status = 'waitlisted')::bigint AS waitlist_count
  FROM public.event_players ep
  WHERE ep.event_id = target_event_id;
$$;

CREATE VIEW event_feed_view
WITH (security_invoker = true) AS
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
  COALESCE(us.no_shows, 0) AS organizer_no_shows,
  COALESCE(us.games_played, 0) AS organizer_games_played,
  e.venue_id,
  v.name              AS venue_name,
  v.address           AS venue_address,
  e.starts_at,
  e.ends_at,
  e.city,
  e.reservation_type,
  e.player_count_total,
  e.skill_min,
  e.skill_max,
  e.description,
  e.status,
  COALESCE(ep_counts.spots_taken, 0) AS spots_taken,
  COALESCE(ep_counts.waitlist_count, 0) AS waitlist_count,
  e.created_at
FROM events e
JOIN sports s ON s.id = e.sport_id AND s.is_active = true
JOIN venues v ON v.id = e.venue_id
JOIN profiles p ON p.id = e.organizer_id AND p.is_deleted = false
LEFT JOIN user_sports us ON us.user_id = e.organizer_id AND us.sport_id = e.sport_id
LEFT JOIN LATERAL private.event_player_counts(e.id) ep_counts ON true
WHERE e.status IN ('active', 'full')
;
```

### 3.2 Thumbs-up percentage (computed at query time)

For a given `(user_id, sport_id)`:

```sql
-- Games where the user received at least one thumbs-up
SELECT
  COUNT(DISTINCT t.event_id) AS games_with_thumbs,
  us.games_played AS total_games
FROM user_sports us
LEFT JOIN post_game_thumbs t ON t.to_user = us.user_id AND t.sport_id = us.sport_id
WHERE us.user_id = :user_id AND us.sport_id = :sport_id
GROUP BY us.games_played;

-- Thumbs-up % = games_with_thumbs / total_games * 100
-- Only shown if total_games >= 3
```

This is computed on the client or in a server function when loading a player profile, not stored denormalized.

### 3.3 Play-again connection check

```sql
-- Check if user_a and user_b have a mutual thumbs-up for a sport
SELECT EXISTS (
  SELECT 1
  FROM post_game_thumbs t1
  JOIN post_game_thumbs t2
    ON t1.from_user = t2.to_user
    AND t1.to_user = t2.from_user
    AND t1.sport_id = t2.sport_id
  WHERE t1.from_user = :user_a
    AND t1.to_user = :user_b
    AND t1.sport_id = :sport_id
) AS is_connected;
```

For bulk lookups (e.g. player list on event detail), this can be batched into a single query.

---

## 4. Row-Level Security (RLS)

All tables have RLS enabled. The `service_role` key (used only by Edge Functions) bypasses RLS.

| Table | Read | Write |
|---|---|---|
| `profiles` | Any authenticated user; `is_deleted = false` only | Own row only; **`is_deleted` and `profile_complete` columns are excluded** — these are server-managed |
| `device_tokens` | Own rows only | Authenticated install-bound claim/delete RPCs; raw token alone is not enough to reassign or delete a row |
| `sports` | Any authenticated user (`is_active = true`) | Service role only |
| `venues` | Any authenticated user | Insert: any authenticated user; Update/Delete: service role only |
| `user_sports` | Any authenticated user | **Own rows, `skill_level` column only** — see policy below |
| `events` | Any authenticated user | Service role only (via Edge Functions) |
| `event_players` | Any authenticated user can read `confirmed` rows only; each user can always read their own row. Waitlisted identities stay hidden from everyone else, including the organizer. | Service role only (via Edge Functions) |
| `chat_messages` | Organizer or confirmed player of that event only | Service role only (via Edge Functions) |
| `no_show_reports` | Organizer of event only | Service role only (via Edge Functions) |
| `post_game_thumbs` | Any authenticated user (thumbs are anonymous but readable for connection checks) | Service role only (via Edge Function) |
| `player_availability` | Any authenticated user (filtered by city in queries) | Own rows: insert, update, delete |
| `notification_log` | Own rows only | Service role only |
| `notification_preferences` | Own rows only | Own rows only |
| `reports` | Own rows only (reporter can see their own reports) | Service role only (via Edge Function) |
| `app_config` | Any user (`anon` + `authenticated`) | Service role only |
| `consent_log` | Own rows only | Insert own rows only; no update or delete |

### 4.1 `user_sports` write policy — column-level restriction

```sql
CREATE POLICY user_sports_update_own_skill ON user_sports
  FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (
    user_id = auth.uid()
    AND games_played = (SELECT games_played FROM user_sports WHERE id = user_sports.id)
    AND hours_played = (SELECT hours_played FROM user_sports WHERE id = user_sports.id)
    AND no_shows     = (SELECT no_shows     FROM user_sports WHERE id = user_sports.id)
  );
```

### 4.2 `profiles` write policy — protected columns

```sql
CREATE POLICY profiles_update_own ON profiles
  FOR UPDATE
  TO authenticated
  USING (id = auth.uid())
  WITH CHECK (
    id = auth.uid()
    AND is_deleted = (SELECT is_deleted FROM profiles WHERE id = profiles.id)
  );
```

`profile_complete` remains protected because the `check_profile_complete` trigger recomputes it on every profile update before the write is committed. The client cannot persist an arbitrary value for that column.

### 4.3 `venues` write policy — insert only

```sql
CREATE POLICY venues_insert_authenticated ON venues
  FOR INSERT
  TO authenticated
  WITH CHECK (created_by = auth.uid());

-- No UPDATE or DELETE policy for authenticated users.
-- Venue edits/merges are admin operations handled via service role.
```

**Key principle:** RLS must be strong enough for all direct reads and Supabase Realtime subscriptions. Edge Functions still own all business-logic writes and any sensitive server-side orchestration.

---

## 5. Edge Functions

All Edge Functions:
- Require a valid JWT (`Authorization: Bearer <token>`) — no anonymous calls accepted
- Use `service_role` internally for atomic DB operations (bypasses RLS safely)
- Return consistent error shapes: `{ "error": { "code": "...", "message": "..." } }`
- Are versioned under `/v1/`
- Apply rate limiting via Upstash Redis (see section 12)

---

### 5.1 `POST /v1/events` — `create-event`

```
Input:  sport_id, venue_id, starts_at, ends_at, reservation_type,
        player_count_total, skill_min, skill_max, description?
Auth:   JWT
```

Logic:
1. Validate all fields; enforce `skill_min <= skill_max`, `ends_at > starts_at`, `starts_at > now()`
2. Validate `venue_id` exists; read `venues.city` to set `events.city` (denormalized)
3. Check if user has a `user_sports` row for `(organizer, sport_id)`:
   - If not: return `SKILL_LEVEL_REQUIRED`
4. Insert into `events` (with city from venue)
5. Insert organizer into `event_players` as `confirmed`
6. Return the created event

---

### 5.2 `POST /v1/events/:id/join` — `join-event`

```
Input:  event_id (path)
Auth:   JWT
```

**Race condition protection:** Uses `SELECT ... FOR UPDATE` on the event row.

Logic:
1. `SELECT * FROM events WHERE id = $1 FOR UPDATE`
2. Validate event is `active` or `full`; validate `starts_at > now()`
3. Validate player is not the organizer
4. Check if user has a `user_sports` row for this sport:
   - If not: return `SKILL_LEVEL_REQUIRED`
5. Check existing `event_players` row → if already `confirmed` or `waitlisted`, return `ALREADY_JOINED`
6. Count confirmed: `SELECT COUNT(*) FROM event_players WHERE event_id = $1 AND status = 'confirmed'`
7. If `spots_taken < player_count_total`: upsert `confirmed`; else upsert `waitlisted`
8. `joined_at` set only on first insert; preserved on upsert
9. If newly confirmed and event now full: update `events.status = 'full'`; notify organizer "Event is now full"
10. Notify organizer: "Someone joined your event"
11. Notify player: "You're confirmed!" or "You're on the waitlist — position #N"
12. Log to `notification_log`

---

### 5.3 `POST /v1/events/:id/leave` — `leave-event`

```
Input:  event_id (path), target_user_id? (if organizer removing someone else)
Auth:   JWT (must be target player OR organizer)
```

Logic:
1. Validate caller is the target player or the organizer
2. Validate target is not the organizer (must cancel instead)
3. `SELECT * FROM events WHERE id = $1 FOR UPDATE`
4. Upsert `event_players.status = 'removed'`
5. If leaving player was `confirmed`:
   - Find first waitlisted: `ORDER BY joined_at ASC LIMIT 1`
   - If found: upsert to `confirmed`; notify "A spot opened — you're confirmed!"
   - Update event `status` back to `active` if it was `full`
6. If organizer removed the player: notify removed player
7. Log to `notification_log`

Organizer-facing UI may call `POST /v1/events/:id/remove-player` with a required `target_user_id`; it reuses the same transaction and promotion rules as `leave-event`, but it never defaults the target to the caller.

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
4. Set `events.chat_closed_at = now()`
5. Notify all `confirmed` + `waitlisted` players
6. Log to `notification_log`

---

### 5.5 `finish-event` — scheduled cron (every 10 minutes)

Logic (all writes in a single transaction per event):

**Pass 1 — Reminders:**
- Find `active` or `full` events where `starts_at` is within `now() + 1h50m` to `now() + 2h10m` AND `reminder_sent = false`
- Send push to all confirmed players + organizer
- Set `events.reminder_sent = true`

**Pass 2 — Finish:**
- Find `active` or `full` events where `ends_at < now()`
- Set `status = 'finished'`
- Set `no_show_window_end = ends_at + interval '24 hours'`
- Set `chat_closed_at = ends_at + interval '48 hours'`
- For each confirmed player (including organizer):
  - Upsert `user_sports (user_id, sport_id)`:
    - `games_played += 1`
    - `hours_played += EXTRACT(EPOCH FROM (ends_at - starts_at)) / 3600`

**Pass 3 — Cleanup expired availability:**
- `DELETE FROM player_availability WHERE available_date < CURRENT_DATE`

---

### 5.6 `POST /v1/events/:id/no-show` — `report-no-show`

```
Input:  event_id (path), reported_user_id
Auth:   JWT (must be organizer)
```

Logic:
1. Validate caller is organizer
2. Validate `now() < no_show_window_end`
3. Validate reported user had `status = 'confirmed'`
4. **Abuse check:** Validate ≥ 2 confirmed players excluding organizer
5. Check for duplicate: `UNIQUE (event_id, reported_user)` rejects
6. Insert into `no_show_reports` (with denormalized `sport_id`)
7. Postgres trigger fires → `user_sports.no_shows += 1`

---

### 5.7 `POST /v1/events/:id/messages` — `send-message`

```
Input:  event_id (path), body
Auth:   JWT
```

Logic:
1. Validate caller is confirmed or organizer
2. Validate event is not `cancelled`
3. **Chat window check:** If `chat_closed_at IS NOT NULL AND now() > chat_closed_at`, return `CHAT_CLOSED`
4. Validate `body` length (1–1000 chars)
5. Insert into `chat_messages`
6. Supabase Realtime broadcasts to subscribers
7. Push to all other confirmed players + organizer (background only)
8. Log to `notification_log`

---

### 5.8 `PATCH /v1/events/:id` — `edit-event`

```
Input:  event_id (path), any subset of: venue_id, starts_at, ends_at,
        reservation_type, player_count_total, skill_min, skill_max, description
Auth:   JWT (must be organizer)
```

Logic:
1. Validate caller is organizer
2. Validate event is `active` or `full`
3. Validate all provided fields
4. If `venue_id` is provided: validate venue exists; update `events.city` from venue
5. If `player_count_total` is provided: ensure new total ≥ current confirmed count
6. If `skill_min` / `skill_max` are provided: validate `skill_min <= skill_max`
7. If `starts_at` / `ends_at` are provided: validate `ends_at > starts_at` and `starts_at > now()`
8. Update the event row
9. If capacity increased and event was `full`: check and update to `active` if applicable
10. Return the updated event

---

### 5.9 `POST /v1/reports` — `submit-report`

```
Input:  target_type ('event' | 'player'), target_event_id?, target_user_id?,
        reason, detail?
Auth:   JWT
```

Logic:
1. Validate target exists and is not already reported by this user
2. Insert into `reports` with `status = 'pending'`
3. Send email notification to admin address
4. Return success

---

### 5.10 `POST /v1/events/:id/thumbs-up` — `give-thumbs-up`

```
Input:  event_id (path), to_user_id
Auth:   JWT
```

Logic:
1. Validate event is `finished`
2. Validate `now() < chat_closed_at` (thumbs-up window = same as chat window = 48h)
3. Validate caller was a confirmed player in this event
4. Validate `to_user_id` was a confirmed player in this event
5. Validate `to_user_id != caller` (no self-thumbs)
6. Check for duplicate: `UNIQUE (event_id, from_user, to_user)` rejects
7. Insert into `post_game_thumbs` (with denormalized `sport_id` from event)
8. Return success (no notification — thumbs are anonymous and silent)

---

### 5.11 `POST /v1/account/delete` — `delete-account`

```
Input:  none
Auth:   JWT
```

Logic:
1. Validate caller is authenticated
2. Delete all `device_tokens` rows owned by the caller
3. Cancel all future `active` / `full` events organized by the caller; notify affected players
4. Remove the caller from future joined events; promote waitlisted players where applicable
5. Delete all `player_availability` rows for the caller
6. Delete `avatars/{user_id}/` from Storage
7. Delete the caller's `auth.users` row
8. Return a small cleanup summary payload

---

## 6. Real-time Subscriptions

| Channel | Table | Filter | Events | Screen |
|---|---|---|---|---|
| `event:{id}:chat` | `chat_messages` | `event_id = {id}` | `INSERT` | Chat screen |
| `event:{id}:players` | `event_players` | `event_id = {id}` | `INSERT`, `UPDATE` | Event detail (confirmed rows + viewer's own row only) |
| `event:{id}:status` | `events` | `id = {id}` | `UPDATE` | Event detail, My games |

All subscriptions require a valid JWT. RLS gates which users can subscribe to which channels, so waitlisted identities remain private while the event-detail aggregates continue to expose only waitlist count and the current viewer's own position.

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

-- Cron: events to remind
CREATE INDEX idx_events_remind ON events (starts_at, status, reminder_sent)
  WHERE status IN ('active', 'full') AND reminder_sent = false;

-- Waitlist ordering
CREATE INDEX idx_event_players_waitlist ON event_players (event_id, joined_at)
  WHERE status = 'waitlisted';

-- Confirmed players
CREATE INDEX idx_event_players_confirmed ON event_players (event_id, user_id)
  WHERE status = 'confirmed';

-- Chat feed
CREATE INDEX idx_chat_messages_event ON chat_messages (event_id, sent_at)
  WHERE is_deleted = false;

-- User sport stats
CREATE INDEX idx_user_sports_lookup ON user_sports (user_id, sport_id);

-- Push fan-out
CREATE INDEX idx_device_tokens_user ON device_tokens (user_id);

-- Reports: admin lookup
CREATE INDEX idx_reports_status ON reports (status, created_at)
  WHERE status = 'pending';

-- Venues: search by city + name
CREATE INDEX idx_venues_city_name ON venues (city, name);

-- Thumbs-up: stats computation and connection checks
CREATE INDEX idx_thumbs_to_user ON post_game_thumbs (to_user, sport_id);
CREATE INDEX idx_thumbs_from_user ON post_game_thumbs (from_user, to_user, sport_id);

-- Availability: feed query
CREATE INDEX idx_availability_feed ON player_availability (city, sport_id, available_date);

-- Availability: cleanup
CREATE INDEX idx_availability_date ON player_availability (available_date);
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

-- Apply to: profiles, events, user_sports, event_players, device_tokens,
--           notification_preferences, venues, app_config
CREATE TRIGGER trg_profiles_updated_at BEFORE UPDATE ON profiles FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_events_updated_at BEFORE UPDATE ON events FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_user_sports_updated_at BEFORE UPDATE ON user_sports FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_event_players_updated_at BEFORE UPDATE ON event_players FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_device_tokens_updated_at BEFORE UPDATE ON device_tokens FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_notification_preferences_updated_at BEFORE UPDATE ON notification_preferences FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_venues_updated_at BEFORE UPDATE ON venues FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_app_config_updated_at BEFORE UPDATE ON app_config FOR EACH ROW EXECUTE FUNCTION set_updated_at();
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

**Note:** This creates a profile row with `first_name = NULL`, `last_name = NULL`, `city = NULL`, `profile_complete = false`.

### 9.3 `set_profile_complete`
```sql
CREATE OR REPLACE FUNCTION check_profile_complete()
RETURNS TRIGGER AS $$
BEGIN
  NEW.profile_complete := (
    NEW.first_name IS NOT NULL
    AND NEW.last_name IS NOT NULL
    AND NEW.city IS NOT NULL
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_check_profile_complete
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION check_profile_complete();
```

### 9.4 `increment_no_shows`
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

When a user requests account deletion:

1. Delete all `device_tokens` rows for the user
2. Cancel all future `active` / `full` events they organize; notify affected players
3. Remove the user from future events they joined; promote waitlisted if applicable
4. Delete all `player_availability` rows for the user
5. Delete `avatars/{user_id}/` from Storage
6. Delete the `auth.users` row
7. `profiles` cascades from `auth.users`; `user_sports`, `notification_preferences`, `player_availability`, `consent_log` cascade from profile
8. Historical records remain intact via `ON DELETE SET NULL`: `event_players`, `chat_messages`, `no_show_reports`, `post_game_thumbs`, `reports`
9. In UI, any NULL user reference is rendered as `"Deleted User"` with no avatar
10. `post_game_thumbs` rows where the deleted user was `from_user` or `to_user` are preserved with NULL — other players' thumbs-up percentages are unaffected because the calculation counts rows by `to_user` regardless of whether `from_user` still exists

**Soft-deleted events** (`status = 'cancelled'`) are never hard-deleted. Past chat history, player records, and no-show reports remain queryable.

---

## 11. API Conventions

| Convention | Value |
|---|---|
| Timestamp format | ISO 8601 UTC — `2025-06-15T14:00:00Z` |
| ID format | UUID v4 |
| Pagination | `?limit=20&offset=0`; default 20, max 100 |
| Error shape | `{ "error": { "code": "EVENT_FULL", "message": "human-readable" } }` |
| Edge Function prefix | `/v1/` |
| Language | `Accept-Language: cs` or `en` header |

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
VALIDATION_ERROR         — input failed schema validation
CHAT_CLOSED              — chat is read-only
CANNOT_REDUCE_BELOW_CONFIRMED — player_count_total < current confirmed
INSUFFICIENT_PLAYERS     — no-show reports require ≥ 2 confirmed (excl. organizer)
DUPLICATE_USER_REPORT    — user has already reported this target
DUPLICATE_THUMBS_UP      — already gave thumbs up to this player for this event
THUMBS_UP_WINDOW_CLOSED  — 48h post-game window has passed
NOT_EVENT_PARTICIPANT    — caller was not a confirmed player in this event
VENUE_NOT_FOUND          — venue_id does not exist
RATE_LIMITED             — too many requests; try again later
UPDATE_REQUIRED          — app version is below minimum; must update
CONSENT_REQUIRED         — user has not accepted current terms version
```

---

## 12. Rate Limiting

| Endpoint | Limit |
|---|---|
| `join-event` | 10 req / min / user |
| `leave-event` | 10 req / min / user |
| `send-message` | 30 req / min / user |
| `report-no-show` | 20 req / min / user |
| `submit-report` | 5 req / min / user |
| `edit-event` | 10 req / min / user |
| `give-thumbs-up` | 20 req / min / user |
| Auth endpoints | Managed by Supabase Auth built-in limits |

HTTP 429 returned on excess.

**Implementation:** Upstash Redis with sliding window counters per `{function_name}:{user_id}`.

**Environment variables:**
```bash
UPSTASH_REDIS_REST_URL
UPSTASH_REDIS_REST_TOKEN
```

---

## 13. Environment Variables

```bash
# Client (EXPO_PUBLIC_ prefix — safe to bundle in app binary)
EXPO_PUBLIC_SUPABASE_URL
EXPO_PUBLIC_SUPABASE_ANON_KEY
EXPO_PUBLIC_SENTRY_DSN             # Sentry error tracking DSN
EXPO_PUBLIC_TERMS_VERSION          # current terms version string (e.g. '2025-06-01')
EXPO_PUBLIC_PRIVACY_VERSION        # current privacy policy version string

# Edge Functions only — never exposed to client
SUPABASE_SERVICE_ROLE_KEY
EXPO_PUSH_ACCESS_TOKEN      # for authenticated Expo push API requests
UPSTASH_REDIS_REST_URL      # for rate limiting
UPSTASH_REDIS_REST_TOKEN    # for rate limiting
EVENT_REMINDER_DISPATCH_SECRET   # shared secret for the scheduled reminder bridge
ADMIN_REPORT_EMAIL          # email address for report notifications
RESEND_API_KEY              # Resend API key used for report email delivery
REPORT_EMAIL_FROM           # verified sender used for report email delivery
```

---

## 14. Seed Data

Run once on initial deploy:

```sql
INSERT INTO sports (slug, name_cs, name_en, icon_name, color_hex, sort_order) VALUES
  ('badminton', 'Badminton', 'Badminton', 'sport-badminton', '#4CAF50', 1),
  ('padel',     'Padel',     'Padel',     'sport-padel',     '#2196F3', 2),
  ('squash',    'Squash',    'Squash',    'sport-squash',    '#FF5722', 3);

INSERT INTO app_config (key, value) VALUES
  ('minimum_app_version_ios', '1.0.0'),
  ('minimum_app_version_android', '1.0.0');
```

**Venue seeding (pre-launch):** Before launch, seed the `venues` table with known sports venues in launch cities. Source from Google Maps, local sports directories, and the founding user community. This prevents early users from creating duplicate entries for the same places. See `APP.md` section 15 (Launch Strategy).

---

## 15. Future Considerations (Out of Scope for MVP)

Do not scaffold or stub these.

| Feature | Likely implementation |
|---|---|
| B2B venue reservation | `venue_owners` table linking auth accounts to venues; `court_slots` table for availability; `bookings` table for reservations; web dashboard (separate SPA) |
| Venue claiming | Verification flow for facility owners to claim a venue and manage it |
| Post-game detailed ratings | `event_ratings` table; replaces simple thumbs-up with multi-axis ratings |
| Court reservation | `reservations` table; webhook integration with venue systems |
| Player recommendations | Similarity query on `user_sports` + event history + connection graph |
| Player blocking | `user_blocks` table; filtered from feed and join eligibility |
| Full-text search | Postgres `tsvector` on `venues.name` + `events.description` |
| Analytics | Read replica or separate OLAP pipeline |
| Monetization | `subscriptions` table; booking fees; Stripe webhook handler |
| No-show disputes | `no_show_disputes` table; dispute flow triggers review |
| Radius filtering | PostGIS distance queries replacing city-based filtering |
| Leaderboards | Materialized views on `user_sports` + `post_game_thumbs` by city/sport |

---

## 16. Client Infrastructure

This section documents the client-side architectural patterns that are critical for a production-quality mobile app. These are not optional — they are the difference between an app that works in demo and one that works in real life.

### 16.1 Auth token lifecycle

Supabase access tokens expire after ~1 hour. The client must handle this invisibly.

**On app launch:**
1. Read the persisted refresh token from secure storage and call `supabase.auth.refreshSession({ refresh_token })` to obtain a fresh access token
2. If the refresh token is expired (e.g. user hasn't opened the app in 30+ days): the refresh call returns `null` / an error, redirect to login with message "Your session expired. Please log in again."

**During use:**
- Set up `supabase.auth.onAuthStateChange` as a global listener
- On `TOKEN_REFRESHED`: update the in-memory access token
- On `SIGNED_OUT`: clear all stores, redirect to login
- On any 401 from PostgREST or Edge Functions: trigger a manual refresh, then retry the original request once

**Storage strategy (expo-secure-store 2KB limit):**
- `expo-secure-store` on Android has a 2KB value limit. Supabase session objects can exceed this.
- Store **only the refresh token** in `expo-secure-store` (it's a short string, well under 2KB).
- Hold the access token **in memory only** (Zustand store, not persisted).
- On app relaunch: read the refresh token from secure store → call `supabase.auth.refreshSession({ refresh_token })` to obtain a fresh access token.
- `supabase.auth.setSession()` is not appropriate for this storage pattern because Supabase requires both `access_token` and `refresh_token` for that API.
- This pattern works on both iOS and Android without hitting storage limits.

### 16.2 Data fetching and caching (TanStack Query)

Every screen that loads data from Supabase must use `@tanstack/react-query`.

**Why:** Without a caching layer, every screen mount re-fetches from scratch. Tab switches flash blank. Back-navigation shows spinners. Pull-to-refresh loses scroll position. React Query eliminates all of this with stale-while-revalidate caching.

**Configuration:**
```
staleTime:
  Feed (event_feed_view):     30 seconds
  Event detail:               10 seconds
  Chat messages:               0 (always fresh, supplemented by Realtime)
  Profile data:                5 minutes
  Venues search:               2 minutes
  Player availability:        30 seconds
  app_config:                 24 hours (check once per session)

gcTime (cache retention):     30 minutes for all
```

**Mutation patterns:**
- `useMutation` for all write operations (join, leave, create event, thumbs up, etc.)
- Use `onMutate` for optimistic updates where the outcome is predictable (e.g. thumbs up button immediately shows as tapped)
- Invalidate relevant queries on `onSuccess` (e.g. after `join-event`, invalidate the event detail and feed queries)

**Pagination:**
- The feed uses `useInfiniteQuery` with offset-based pagination: load 20 events, load more on scroll
- `getNextPageParam` increments the offset; stops when a page returns fewer than 20 results

### 16.3 Supabase Realtime connection management

Realtime websockets silently die during mobile background/foreground transitions and network changes.

**Rules:**
1. Subscribe to event-specific channels only when the user is viewing that event's detail or chat screen. Unsubscribe on screen unmount. Do not keep channels open globally.
2. On `AppState` change to `active` (foreground): check all active channel statuses. If any are `CHANNEL_ERROR` or `TIMED_OUT`, remove and re-subscribe.
3. After reconnecting a chat channel: fetch missed messages via a React Query refetch (Realtime may have missed events during the disconnect).
4. Supabase free tier allows ~200 concurrent connections. At MVP scale this is fine, but limit to 1–2 active channels per user at a time.

### 16.4 Network resilience

**Offline detection:**
- Use `@react-native-community/netinfo` to listen for connectivity changes.
- Show a persistent, non-dismissable top banner when `isConnected === false`: "You're offline."
- Hide the banner when connectivity returns.
- Do NOT block the UI — users can still browse cached data (feed, event details, chat history from React Query cache).

**Retry strategy for mutations:**
- Network errors (no response / timeout): retry up to 3 times with exponential backoff (1s, 2s, 4s)
- Server errors (5xx): retry up to 2 times with 2s delay
- Client errors (4xx): do not retry — surface the error message to the user immediately
- Use React Query's built-in `retry` configuration for this

### 16.5 Push token re-registration

Expo push tokens can change silently (OS updates, app reinstalls, token rotation by APNs/FCM).

**On every app launch (not just login):**
1. Call `Notifications.getExpoPushTokenAsync()`
2. Compare with the token stored in Zustand
3. Read or create the local per-install push-token ownership key from secure storage
4. Claim the token in `device_tokens` with both the Expo token and the ownership key so same-device account switches still work without making raw-token takeover possible
5. Update the stored token in Zustand and keep a last-known cleanup token locally until backend cleanup succeeds

**On logout:** delete the token row from `device_tokens` with the same local ownership key, clear it from Zustand, and keep retryable local cleanup state only until the backend row is confirmed gone.

### 16.6 Deep linking and event sharing

**URI scheme:** `hrayem://` (for development and direct links)
**Universal links:** `https://hrayem.cz/event/{id}` (for production sharing)

**Configuration (set up in Milestone 0, implement in Milestone 4):**
- `app.json`: set `scheme: "hrayem"` and configure `associatedDomains` (iOS) / `intentFilters` (Android)
- Deploy an `apple-app-site-association` file and `assetlinks.json` to `hrayem.cz/.well-known/`
- Use `expo-linking` for handling incoming links

**Deep link routing:**
- `hrayem.cz/event/{id}` → Event detail screen (if logged in) or Login → Event detail (after auth)
- Store the pending deep link in Zustand if the user isn't logged in; navigate after auth completes

**Share button:**
- Event detail screen includes a share button that calls `Share.share()` with:
  - Text: "[Sport] at [Venue] on [Date] — join me on Hrayem!"
  - URL: `https://hrayem.cz/event/{id}`
- The web fallback page at `hrayem.cz/event/{id}` is a simple static/SSR page showing event details + app download links

### 16.7 Force update

**On every app launch:**
1. Query `app_config` for `minimum_app_version_{platform}`
2. Compare with the running app version (from `expo-constants`)
3. If the running version is below the minimum: show a blocking full-screen modal with "Please update" and a button that opens the App Store / Google Play listing
4. The user cannot dismiss this screen — they must update

**When to use:** increment `minimum_app_version_ios` or `minimum_app_version_android` in Supabase when you ship a breaking API change or a critical security fix. This is a remote kill switch for old versions — no code deploy needed.

### 16.8 App foreground refresh

When the user switches back to Hrayem after time in another app, data may be stale.

**Implementation:**
- Listen to `AppState` changes (`active` / `background` / `inactive`)
- On transition to `active`: trigger React Query's `refetchOnWindowFocus` equivalent — all queries with `staleTime` exceeded are silently refetched in the background
- This means the feed updates, event details refresh, and chat catches up — without the user seeing a loading spinner (stale data is shown immediately, fresh data replaces it when ready)
