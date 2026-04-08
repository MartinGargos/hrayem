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

## Milestone 8

### Problem
Milestone 8 needs a real event chat screen, message write path, access controls, and Realtime refresh behavior without reopening accepted debt from Milestones 2 through 7 or drifting into Milestone 9 notification-preference scope.

### Approach
Reuse the current event detail and Supabase foundation: add a typed chat read/write layer on top of the existing `chat_messages` table and `events` Edge Function, replace the shell chat stub with a real screen, and keep lifecycle correctness through event-detail gating plus focused Realtime reconnect/refetch behavior.

### Steps
1. Add the Milestone 8 backend path: `POST /v1/events/:id/messages`, typed error handling, and any minimal notification-log handling needed for chat writes.
2. Replace the Chat stub with a real screen that loads event detail + message history, enforces organizer/confirmed access, renders the standard chat UI, and reconnects/refetches cleanly on foreground or channel failure.
3. Wire chat entry points and lifecycle gating from Event Detail, rerun validation, and prove as much of the message flow, access control, and Realtime behavior as the current environment allows.

### Open questions / risks
- Existing Milestone 5 accepted debt stays visible but out of scope unless it directly blocks chat correctness: Add to calendar is still missing, the waitlisted-player notification branch is still missing, and Realtime proof is still weaker than the implementation.
- Existing Milestone 7 accepted debt stays visible but out of scope unless it directly blocks chat behavior: lifecycle refresh is now polling-based and natural cron wall-clock proof is still weaker than the implementation.
- RARE EDGE CASE: exact chat-close boundary behavior can briefly differ between device time and database `now()`, so any last-seconds mismatch should be logged rather than overbuilt unless it affects stored data, privacy, auth/session integrity, or account ownership.

## Milestone 8 Fix Pass

### Problem
Chat foreground recovery currently treats `CHANNEL_ERROR` and `TIMED_OUT` as unhealthy, but not `CLOSED`, so backgrounded chat sessions can miss reconnecting even after the app returns to the foreground.

### Approach
Add one tiny shared chat-channel-health helper, reuse it in both the live Realtime subscription callback and the AppState foreground handler, and keep the rest of the chat access/lifecycle contract unchanged.

### Steps
1. Add a small chat Realtime helper that marks `CHANNEL_ERROR`, `TIMED_OUT`, and `CLOSED` as reconnect-needed states.
2. Reuse that helper in `ChatScreen` for channel-status handling and foreground recovery while still refetching missed messages.
3. Re-run validation and prove the reconnect-needed rule with a small helper check in the current environment.

### Open questions / risks
- This pass should stay client-only and must not widen Milestone 8 into Milestone 9 notification or rate-limiting work.
- Real authenticated Realtime proof is still environment-limited here, so the strongest proof will still be static correctness plus existing build/export and verifier checks.

## Milestone 8 Final Fix Pass

### Problem
Foreground chat recovery is still too conditional because it only reconnects when the last stored channel status looks unhealthy, even though the repo contract says active subscriptions should recover after background/foreground transitions when websockets may die silently.

### Approach
Keep the existing per-event Realtime architecture, but make the focused chat screen rebuild its live subscription on every foreground activation, then refetch missed state, while preserving the separate unhealthy-status backoff path for in-session failures.

### Steps
1. Extend the tiny chat Realtime helper with a pure foreground-recovery rule for the focused visible chat screen.
2. Update `ChatScreen` so foreground always triggers a clean reconnect for the active chat channel before the usual catch-up refetch.
3. Re-run validation and prove the helper semantics in the current environment, while keeping the existing live Milestone 8 verifier honest about Realtime proof limits.

### Open questions / risks
- This pass should not change chat access control, lifecycle gating, or notification behavior; it only tightens subscription recovery semantics.
- Real mobile websocket proof is still environment-limited here, so the proof will remain helper-level plus existing server-side verifier coverage rather than a full two-device Realtime demo.

## Milestone 8 Accepted Known Debt

### Problem
Milestone 8 is accepted, but three non-blocking chat follow-ups need to stay visible before Milestone 9 starts so they are not silently lost.

### Approach
Log the accepted Milestone 8 debt explicitly here and leave the implementation unchanged unless one of these items directly blocks Milestone 9 behavior.

### Steps
1. Keep the AGENTS.md vs MILESTONES.md wording drift on foreground reconnect semantics visible as documentation debt.
2. Keep the weaker-than-implementation Realtime proof on the authenticated mobile path visible as runtime proof debt.
3. Keep the rare chat-close boundary clock-skew mismatch visible as accepted edge-case debt.

### Open questions / risks
- AGENTS.md vs MILESTONES.md wording drift on foreground reconnect semantics remains accepted documentation debt.
- Realtime proof is still weaker than the implementation on the actual authenticated mobile path.
- RARE EDGE CASE: the client/server chat-close boundary can still disagree briefly because of clock skew.

## Milestone 9

### Problem
Milestone 9 needs production-facing push notifications, notification preferences, shared rate limiting, and the availability system without reopening accepted debt from Milestones 2 through 8 or drifting into Milestone 10 reporting work.

### Approach
Replace the remaining Milestone 9 stubs with real settings and availability surfaces, extend the existing app shell to handle notification taps, and harden the Supabase Edge Function layer with shared push fan-out plus Upstash-backed rate limiting while reusing the current event/profile/feed foundations.

### Steps
1. Add the Milestone 9 client data layer: notification-preference reads/writes, availability CRUD/feed reads, notification tap handling, and the real Settings / Post Availability / Available Players screens.
2. Add the Milestone 9 server path: shared push fan-out helper, Upstash sliding-window rate limiter, notification delivery for the event write routes, and any minimal SQL/view updates needed for availability and reminder notification coverage.
3. Add a Milestone 9 verifier, apply/deploy any Supabase changes, rerun validation, and separate proven Milestone 9 behavior from device-limited push/Realtime proof gaps.

### Open questions / risks
- Milestone 8 accepted debt stays visible but out of scope unless it directly blocks Milestone 9 behavior: AGENTS.md vs MILESTONES.md reconnect wording drift remains, Realtime proof is still weaker than the implementation on the authenticated mobile path, and the rare chat-close boundary clock-skew edge case remains accepted.
- Milestone 5 accepted debt stays visible but out of scope unless it directly blocks Milestone 9 behavior: Add to calendar is still missing and the waitlisted-player notification branch is still missing.
- RARE EDGE CASE: any residual race in the shared Upstash sliding-window limiter should be called out explicitly rather than overbuilt unless it affects security, privacy, auth/session integrity, incorrect account ownership, or data loss.

## Milestone 9 Fix Pass

### Problem
The first Milestone 9 pass still leaves three reject-level gaps: event reminders only log instead of using the shared push pipeline, rate limiting can fail open when Upstash is missing, and first-time users can post availability that silently disappears from the Available players tab if they do not yet have a `user_sports` row.

### Approach
Keep the existing Milestone 9 architecture, but make three minimal durability fixes: route reminder delivery through the shared push helper from the scheduled sweep, require active Upstash-backed rate limiting on the intended live path, and make availability feed stats resilient for users without an existing sport profile by adding the smallest fallback data path that still shows the intended player info and skill badge.

### Steps
1. Add a small server-side reminder dispatch path that reuses the shared notification fan-out helper and keeps `notification_log` tied to real push attempts and preferences.
2. Remove the fail-open rate-limit behavior on the intended live path now that the required Upstash env is available, then prove live `429 / RATE_LIMITED`.
3. Fix availability visibility for first-time users with the narrowest read/write adjustment that keeps cards complete enough for APP.md without inventing a larger profile-stats system, then strengthen proof for expired cleanup if it stays cheap.

## Milestone 9 Final Fix Pass

### Problem
Now that push notifications are live, `device_tokens` ownership is still too weak because knowing a raw Expo token is enough to claim or delete another user's registration.

### Approach
Bind token claim/delete to a small per-install ownership key stored locally on the device, keep one effective row per token, and update the client + verifier so normal launch/logout flows still work while cross-user raw-token theft no longer does.

### Steps
1. Add the smallest DB contract change needed to store and enforce install-bound token ownership in the existing claim/delete RPCs.
2. Update the client push-token cache and registration/cleanup flow to pass the install-bound ownership key on every claim/delete operation.
3. Extend the Milestone 9 verifier to prove legitimate same-install claim/delete still works and a different authenticated user cannot steal or delete a token by raw value alone.

### Open questions / risks
- RARE EDGE CASE: if a device reinstall preserves the same Expo token but loses the local install key, reclaiming that exact old row may need manual cleanup or token rotation; I will keep the fix minimal unless that shows up as a real correctness blocker in the current environment.
- The stale/direct availability write invariant stays out of scope unless it turns into a tiny safe follow-up after the ownership fix.

### Open questions / risks
- The shared Upstash sliding-window helper still has a small concurrency race by design; that remains RARE EDGE CASE debt unless it grows into a security or ownership issue.
- Real-device notification tap proof is still likely to remain environment-limited even after the server-side reminder path is corrected.

## Event Reminder Focused Re-Verification

### Problem
The latest red-team blocker says `event_reminder` is still broken, so this pass needs to re-run the live proof and, only if it still fails, isolate and fix the exact failing reminder step without reopening the rest of Milestone 9.

### Approach
Trace the live reminder path end to end, compare `finish_event_sweep()` behavior against direct internal reminder dispatch, and if the bridge is the failing step, make the smallest DB-only fix needed there.

### Steps
1. Re-run a focused live reminder probe that creates a due event reminder, runs `finish_event_sweep()`, and inspects `notification_log`, `reminder_sent`, and post-sweep claimability.
2. If the sweep path still fails, directly invoke the internal reminder dispatch route with the same due reminder to isolate the failing step.
3. Patch only the failing bridge step, apply it live, and rerun the same focused reminder probe plus the low-level bridge evidence.

### Open questions / risks
- If the bridge is timing out rather than logically failing, the minimal durable fix should be a timeout adjustment rather than broader reminder architecture changes.
- Real device push receipt remains out of scope for this focused pass; the goal here is reminder-path correctness and fresh live proof.

## Milestone 9 Accepted Known Debt

### Problem
Milestone 9 is accepted, but a short list of non-blocking runtime and proof gaps still needs to stay visible before Milestone 10 starts.

### Approach
Log the accepted Milestone 9 debt explicitly here and leave the implementation unchanged unless one of these items directly blocks Milestone 10 behavior.

### Steps
1. Keep the missing real-device push receipt and push tap-through proof visible as accepted proof debt.
2. Keep the missing natural hosted-cron proof visible as accepted operational proof debt.
3. Keep the client-only availability invariant for stale/direct writes without `user_sports` rows visible as accepted model debt.
4. Keep the same-user multi-device token caveat visible as accepted MVP debt.
5. Keep the transient `verify:milestone9` `502` flake visible unless it becomes reproducible.

### Open questions / risks
- Real-device push receipt and push tap-through proof are still missing.
- Natural hosted-cron proof is still weaker than direct invocation proof.
- The availability invariant for stale/direct writes without `user_sports` rows is still enforced mainly in the current client.
- Same-user multi-device token behavior remains accepted MVP debt unless it turns into a real ownership problem.
- The transient `verify:milestone9` `502` flake stays visible unless it becomes reproducible.

## Milestone 10

### Problem
Milestone 10 needs the final MVP hardening pass: real generic reporting, a real account deletion flow, finished Settings controls for language/city, and the last shared polish items that directly affect accessibility and perceived quality.

### Approach
Keep the implementation narrow and production-oriented by adding two small Edge Functions (`reports` and `account`), one reusable client-side report sheet, a real account deletion screen, and a small shared polish pass for Settings editing, tab haptics, and accessibility hints.

### Steps
1. Add the accepted Milestone 9 debt note above, then implement `POST /v1/reports` plus the report UI on Event Detail and Player Profile with duplicate prevention and confirmation messaging.
2. Replace the stub account deletion route with a real destructive flow backed by an Edge Function that follows the current backend contract for future events, availability, storage cleanup, and auth deletion.
3. Finish the Milestone 10 client polish that is still clearly missing in the current repo: editable Settings language/city controls, shared accessibility hints on core interactive primitives, and tab-switch haptics.
4. Add a Milestone 10 verifier, deploy/apply only the required Supabase changes, rerun validation, and separate proven behavior from device-limited proof gaps.

### Open questions / risks
- BLOCKER if no workable admin-email configuration exists for `POST /v1/reports`; the smallest production-oriented mail path should be chosen and kept explicit in docs rather than hidden behind a fake success path.
- LIKELY SOON: deleted-user rendering may still need small follow-up touch-ups on historical surfaces once the real account deletion flow is exercised end to end.
- RARE EDGE CASE: if the last authenticated session is deleted while the client is backgrounded, the next foreground may clear locally through auth expiry rather than the happy-path success screen, but that should not affect account ownership or data integrity.

## Milestone 10 Fix Pass

### Problem
The current Milestone 10 implementation still has two reject-level gaps: report submission treats admin email as best-effort instead of contractual, and account deletion can fail after partial destructive changes if notification side effects break.

### Approach
Keep the fix narrow by hardening only the `reports` and `account` Edge Functions plus the Milestone 10 verifier: make report-email configuration and delivery explicit, and move account-deletion notifications onto a best-effort path that cannot roll back the user-visible destructive outcome.

### Steps
1. Patch `POST /v1/reports` so missing report-email config and email-delivery failures are explicit route failures rather than silent success, and make the verifier prove the intended email outcome instead of only config presence.
2. Patch `POST /v1/account/delete` so notification fan-out/logging cannot leave the destructive path half-failed from the user's perspective, while keeping the actual deletion contract intact.
3. If still cheap and low-risk, clean up the new functions' missing-Authorization behavior and unsafe report-email HTML interpolation, then rerun validation and live Milestone 10 proof.

### Open questions / risks
- LIKELY SOON: report-email proof may still be environment-limited if the current project lacks a working admin mailbox/Resend sender even after the route semantics are corrected.
- RARE EDGE CASE: if account deletion succeeds but best-effort cancellation/promotion notifications fail, affected players may miss one notification even though the underlying event state is already correct.

## Milestone 10 Accepted Known Debt

### Problem
Milestone 10 is accepted, but a short list of non-blocking durability and proof gaps still needs to stay visible before Milestone 11 work starts.

### Approach
Log the accepted Milestone 10 debt explicitly here and leave the current implementation unchanged unless one of these items directly blocks Milestone 11 behavior.

### Steps
1. Keep the account-deletion late-step durability caveat visible as accepted hardening debt.
2. Keep the real-device walkthrough and settings/profile proof gaps visible as accepted runtime proof debt.
3. Keep the production Sentry and broader device-polish proof gaps visible as accepted launch-readiness debt.

### Open questions / risks
- Account deletion still has a late-step durability caveat if avatar or auth-user cleanup fails after earlier destructive changes.
- Real-device walkthrough proof for profile/settings/account surfaces is still missing.
- Production Sentry proof and broader device-polish proof are still missing.

## Milestone 11

### Problem
Milestone 11 needs the repo-side launch-readiness pass: accurate docs and env examples, launch-site assets for legal pages and app links, a public event web fallback surface, and the best possible pre-submission verification without drifting into Milestone 12 or pretending operational launch tasks are already done.

### Approach
Keep the implementation narrow and production-oriented by reusing the current Expo app as the web fallback shell, adding one small public read-only Edge Function for shared event pages, and adding only the config/docs/assets needed to make launch hosting and submission prep explicit.

### Steps
1. Add the accepted Milestone 10 debt note above, then tighten the repo docs/config for Milestone 11: README, `.env.example`, and `app.config.ts` launch metadata where the current repo is still incomplete.
2. Add the repo-side launch-site assets: privacy/terms pages, app-link / universal-link asset generation, and a public event fallback surface that fetches safe event details without auth.
3. Add focused Milestone 11 verification, rerun validation, and separate what is proven in this environment from what still depends on real devices, production signing identities, and launch/community operations.

### Open questions / risks
- BLOCKER if release-specific app-link values are still unavailable: the iOS Team ID, Android signing certificate fingerprint(s), and final store URLs may still need to be supplied externally before the well-known files and download buttons can be fully proven.
- LIKELY SOON: the legal host pages can be implemented in-repo, but their wording still may need product/legal review before public launch.
- RARE EDGE CASE: a shared event link opened on mobile web after the event is cancelled or filled may lag the in-app state briefly if CDN caching is introduced later, so the fallback surface should stay purely informational and not promise live joinability.

## Milestone 11 Closeout Pass

### Problem
The current Milestone 11 state still overstates readiness: the verifier can pass without launch assets, the README has version and coverage drift, and the repo has no committed website hosting target/config for proving the hosted `/event/{id}` fallback.

### Approach
Keep this pass narrow and honest: fix only the verifier and docs so missing real-world launch inputs fail loudly, then separate repo-side proof from the remaining external deployment inputs instead of adding placeholder implementations.

### Steps
1. Make `verify:milestone11` fail when required launch-input env values or generated `public/.well-known/` assets are missing.
2. Fix `README.md` so versions, milestone coverage, and Milestone 11 hosting/store-url status match the current repo state.
3. Re-run focused validation and Milestone 11 verification, then report the exact missing real-world inputs blocking full closeout.

### Open questions / risks
- BLOCKER if the release inputs remain absent: `EXPO_PUBLIC_WEB_BASE_URL`, `EXPO_PUBLIC_APP_STORE_URL`, `EXPO_PUBLIC_PLAY_STORE_URL`, `HRAYEM_APPLE_TEAM_ID`, and `HRAYEM_ANDROID_SHA256_CERT_FINGERPRINTS`.
- BLOCKER if no hosting target/config is chosen for the public website: the repo can implement the fallback shell, but it still cannot prove deployed `/event/{id}` behavior without an actual host and route/static-file config.
- LIKELY SOON: legal copy on the static terms/privacy pages may still need review before public launch.
- RARE EDGE CASE: even after the correct `.well-known` files are deployed, universal link propagation can lag briefly on real devices.

## Milestone 11 iPhone/Web First Closeout

### Problem
Milestone 11 now needs an honest iPhone/web-first closeout on `https://hrayem.cz`: the repo still assumes `hrayem.app`, the launch-asset scripts do not allow Android deferral, and the verifier cannot distinguish proven Apple/web progress from intentionally deferred Android launch inputs.

### Approach
Keep the pass minimal and explicit: switch repo-side launch surfaces to `hrayem.cz`, use the real App Store URL, generate and verify Apple/web assets when their inputs exist, treat Android app-link inputs as deferred instead of fake failures, and clearly leave hosted deployment blocked unless a real hosting target exists in-repo.

### Steps
1. Update launch-related code, docs, and examples from `hrayem.app` to `hrayem.cz`, and stop using App Store search fallbacks now that the real iPhone URL is known.
2. Adjust launch-asset generation and `verify:milestone11` so Apple/web inputs are required for the iPhone/web target, while Android asset generation/proof is explicitly deferred if Play URL or signing fingerprints are not available.
3. Generate the Apple-side well-known asset, add the minimal Vercel routing config now that the live site is clearly on Vercel, rerun focused validation, and report exactly what is proven for iPhone/web versus what remains deferred or blocked.

### Open questions / risks
- BLOCKER if `HRAYEM_APPLE_TEAM_ID` is still not the actual Apple Team ID needed for `apple-app-site-association`.
- BLOCKER until the live Vercel deployment actually serves `/event/{id}`, `/privacy`, `/terms`, and `/.well-known/apple-app-site-association` correctly on `https://hrayem.cz`.
- LIKELY SOON: once a hosting target exists, the next proof gap is real iPhone universal-link testing against the deployed `/.well-known/` files.
- RARE EDGE CASE: Apple universal-link association can stay cached briefly after correct deployment, so first-device verification may lag.
