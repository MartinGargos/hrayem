Milestone 0 still needs later real-device proof for iOS dev-build install, offline banner verification on device, CZ/EN switch on device, React Query dummy cache proof on device, Sentry dashboard capture, and deep-link opening on a real install.

## Milestone 4

### Problem
Milestone 4 needs to turn the shell into a working venue-search, event-creation, feed, event-detail, and share flow without reopening already accepted Milestone 2 or Milestone 3 debt.

### Approach
Keep the current navigation and auth shell intact, replace the home/create/detail stubs with real feature screens, add the first event write path through a versioned Supabase Edge Function, and reuse direct PostgREST reads plus React Query for venues, feed, and event detail.

### Steps
1. Add the Milestone 4 data layer: sports, venues, event feed, event detail, and the `POST /v1/events` Edge Function plus any minimal versioned SQL helper needed for safe event creation.
2. Replace the home/create/detail stubs with real screens and shared components for venue search, add-venue flow, skill selection, feed cards, filters, pagination, and sharing.
3. Validate, deploy/apply any Supabase changes needed for the live project, prove as much of the create/feed/detail flow as possible in the current environment, and report carried debt separately from new blockers.

### Open questions / risks
- Milestone 2 known debt remains visible but out of scope here unless it blocks the shell directly: the authenticated device-token RPCs are still bearer-token-sensitive, and stale backend token cleanup can still lag if network cleanup fails after logout.
- Milestone 3 accepted known debt remains visible but out of scope here unless it blocks correct Milestone 4 behavior: there is still a rare pending deep-link replay edge case across multiple wrong-account switches that should be revisited before broad public launch and does not block Milestone 4.
- Real device proof for Apple/Google auth, push behavior, foreground transitions, and universal-link opening is still deferred, so this pass can only prove the Milestone 4 flow as far as the current environment allows.

## Milestone 4 Fix Pass

### Problem
Event detail currently depends on `event_feed_view`, which makes shared and deep-linked event detail fail for events that exist but are no longer feed-eligible.

### Approach
Add a dedicated event-detail read surface that follows event visibility rules instead of feed visibility rules, switch the client to that surface, and only fold in cheap low-risk hardening if it does not cause Milestone 4 churn.

### Steps
1. Add a dedicated event-detail query path that covers non-feed-eligible states without changing the feed path.
2. Wire the client event detail screen and Milestone 4 verifier to the new read path.
3. If it stays tiny and safe, tighten venue insert provenance and add a client-first sport-profile check while keeping the server fallback.

### Open questions / risks
- The accepted Milestone 3 deep-link replay edge case stays deferred; this pass must not reopen that shell debt.
- The current `events` Edge Function JWT gateway drift may not be cheap to resolve safely, so it should only be touched if the fix is straightforward and provable.
