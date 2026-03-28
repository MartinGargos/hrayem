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

## Milestone 5

### Problem
Milestone 5 needs to make joining, leaving, waitlist promotion, realtime player updates, and My Games Upcoming work without reopening already accepted Milestone 2, 3, or 4 debt.

### Approach
Add versioned server-side join/leave functions with row locking and notification logging, then wire event detail and My Games to them with typed React Query optimistic updates plus event-specific Realtime subscriptions.

### Steps
1. Add the Milestone 5 backend path: SQL helpers plus versioned Edge Functions for join/leave, along with any minimal read surfaces needed for membership and My Games.
2. Upgrade event detail with join/leave states, skill gating, soft warning, optimistic cache updates, waitlist visibility rules, and Realtime player/status refresh.
3. Replace the My Games Upcoming stub with a real query, add a Milestone 5 verifier, then validate/apply/deploy and prove as much of the checkpoint as the current environment allows.

### Open questions / risks
- `MILESTONES.md` still lists Add to calendar in Milestone 5 while the current implementation brief focuses on joining, leaving, waitlist, Realtime, and My Games. I will follow the explicit current task scope unless calendar becomes necessary for Milestone 5 correctness.
- Existing Milestone 2 push-token/auth debt stays visible but out of scope unless it directly breaks join/leave correctness or My Games accuracy.
- The accepted Milestone 3 pending deep-link edge case and accepted Milestone 4 likely-soon detail/feed issues remain visible but out of scope unless they directly block correct Milestone 5 behavior.

## Milestone 5 Privacy Fix Pass

### Problem
The current `event_players` read model lets organizers access raw waitlisted identities, which conflicts with the product contract that Event Detail exposes only confirmed player identities plus safe waitlist aggregates.

### Approach
Tighten `event_players` read access so only confirmed rows and the viewer's own row are visible, keep waitlist count and per-viewer waitlist position on the existing safe detail surface, and make join/leave always touch the parent event so the current Realtime invalidation path still refreshes private-safe counts.

### Steps
1. Add a corrective migration that updates the `event_players` select policy and replaces the join/leave SQL functions with event-touch behavior on every membership change.
2. Extend the verifier to prove organizers cannot read waitlisted identities while waitlisted players still see their own row and detail position.
3. Re-run validation, apply the live migration, re-run the Milestone 5 verifier, and report any remaining unproven Realtime gaps honestly.

### Open questions / risks
- The broad milestone docs still include Add to calendar, but that is a larger native-permission feature and is only worth touching here if it stays tiny and low-risk after the privacy fix.
- Realtime proof may still be environment-limited even if the underlying privacy model is corrected, so the likely outcome is stronger DB proof plus honest runtime proof limits.

## Milestone 5 Accepted Known Debt

### Problem
Milestone 5 is accepted, but three non-blocking gaps need to stay visible before public launch planning drifts away from them.

### Approach
Log the accepted debt explicitly here so Milestone 6 can proceed without silently reopening it or pretending those parts are already done.

### Steps
1. Keep Add to calendar visible as unfinished Milestone 5 scope.
2. Keep the missing waitlisted-player notification branch visible as backend follow-up debt.
3. Keep the weaker-than-implementation Realtime proof visible until a better runtime/device proof path is available.

### Open questions / risks
- Add to calendar is still missing.
- The waitlisted-player notification branch is still missing.
- Realtime proof is still weaker than the implementation.

## Milestone 6

### Problem
Milestone 6 needs organizer-only edit, cancel, and remove-player controls to work end to end without breaking the accepted Milestone 5 join/waitlist/privacy behavior.

### Approach
Add the minimal server write paths for edit and cancel, reuse the existing leave/remove-player foundation where it already matches the organizer contract, and extend the current event detail and My Games client flows with organizer-only controls plus targeted cache updates.

### Steps
1. Add the Milestone 6 backend path: SQL for edit/cancel, Edge Function routes for edit/cancel/remove-player, and any minimal query/view adjustments needed to keep detail/feed/my-games accurate after organizer mutations.
2. Extend Event Detail with organizer-only controls, an edit form seeded from current event data, and remove-player/cancel actions that preserve the waitlist privacy model.
3. Tighten My Games role copy if needed, add a verifier for organizer edit/cancel/remove-player flows, then validate/apply/deploy and prove as much of the milestone as the current environment allows.

### Open questions / risks
- Milestone 5 accepted debt stays visible but out of scope here unless it directly blocks organizer controls.
- Waitlisted identities must remain hidden even while organizer remove-player controls are added, so the UI may only be able to expose removal for confirmed players without widening product scope.
- Cancelled/upcoming visibility in My Games should follow the current milestone contract rather than inventing a new cancelled-events list.

## Milestone 6 Fix Pass

### Problem
The organizer Edit affordance is still shown when the backend already considers the event uneditable, which creates a dead-end flow for started events that remain `active` or `full`.

### Approach
Keep the backend contract unchanged and add one small shared client eligibility rule so Event Detail, the Edit screen gate, and stale-submit handling all agree on when organizer editing is actually allowed.

### Steps
1. Add a tiny shared event-edit eligibility helper based on organizer status, `active/full`, and `starts_at > now()`.
2. Use that helper to hide the Edit action on Event Detail while leaving Cancel available where the backend still allows it.
3. Reuse the same helper in the Edit screen gate and submit path, then rerun validation and prove the shared eligibility behavior as far as the current environment allows.

### Open questions / risks
- Waitlisted-player removal UI still stays out of scope unless it can be exposed without violating the accepted waitlist privacy contract.
- This pass can prove the shared eligibility logic and backend behavior, but not full real-device organizer UX.

## Milestone 7

### Problem
Milestone 7 needs automatic event finishing, real past-game/profile statistics surfaces, and no-show/thumbs-up post-game actions without reopening the accepted debt from Milestones 2 through 6 or drifting into Milestone 8 chat work.

### Approach
Add a small lifecycle backend layer first: one scheduled finish sweep plus minimal past/profile read surfaces and post-game mutation routes. Then replace the current My Games Past and Profile stubs with real React Query screens, and extend Event Detail only where finished-state no-show/thumbs-up/play-again visibility now belongs.

### Steps
1. Add the Milestone 7 backend path: finish-sweep SQL + cron schedule, past/profile/play-again read surfaces, and Edge Function routes for no-show and thumbs-up.
2. Upgrade the client with real My Games Past, finished-event Event Detail prompts, and real Profile / Player Profile stats plus skill editing and play-again indicators.
3. Add a Milestone 7 verifier, apply/deploy the backend changes, rerun validation, and separate proven behavior from environment-limited proof gaps.

### Open questions / risks
- Milestone 5 accepted debt stays visible but out of scope here unless it directly breaks post-game correctness: Add to calendar is still missing, the waitlisted-player notification branch is still missing, and Realtime proof is still weaker than the implementation.
- Milestone 4 accepted debt stays visible but out of scope unless it directly blocks finished-state correctness: soft-deleted organizer affordances, event-detail richness drift, likely-soon venue dedupe weakness, and rare feed pagination behavior.
- RARE EDGE CASE: any client/server timing mismatch right around lifecycle boundaries should be logged as edge debt rather than overbuilt unless it affects data integrity, privacy, auth/session integrity, or account ownership.

## Milestone 7 Fix Pass

### Problem
Home and My Games can keep showing stale upcoming state after an event finishes while the app stays open, and the organizer no-show UI can still offer a dead-end action for too-small finished events.

### Approach
Add one small shared client helper for lifecycle-sensitive screens, use focused React Query polling on Home and My Games so finished events roll out of upcoming views without manual refresh, and tighten no-show UI gating with the already loaded confirmed-player data instead of changing backend rules.

### Steps
1. Extend the shared event helper with focused lifecycle refresh timing and the minimum-player check for no-show eligibility.
2. Use the lifecycle refresh rule on Home and My Games so visible upcoming/past queries refetch while the screen stays open.
3. Reuse the minimum-player check on Event Detail and My Games Past so the organizer does not see a dead-end no-show action when backend prerequisites are not met.

### Open questions / risks
- This pass should not touch chat or other Milestone 8 behavior; the fix stays on lifecycle-sensitive read paths only.
- Runtime proof for visible-screen lifecycle refresh is still limited by the current CLI environment, so validation will rely on static correctness plus existing app export/build checks.
