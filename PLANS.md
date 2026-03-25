Milestone 0 still needs later real-device proof for iOS dev-build install, offline banner verification on device, CZ/EN switch on device, React Query dummy cache proof on device, Sentry dashboard capture, and deep-link opening on a real install.

## Milestone 2 Authentication And Session Resilience

### Problem
Milestone 2 needs a real auth flow, launch gating, and session resilience on top of the existing Milestone 0 and 1 foundations without prematurely pulling in the Milestone 3 navigation shell.

### Approach
Build a lightweight state-driven auth shell that routes between email/OAuth auth screens, terms re-consent, profile setup, force update, and the current foundation entry point; keep Supabase session refresh aligned with the repo's refresh-token-only storage pattern; add only the native dependencies needed now for OAuth browser auth, GPS city suggestion, optional profile photo selection, and push-token registration.

### Steps
1. Add the Milestone 2 dependencies and app config needed for OAuth browser auth, push token registration, GPS location, and optional profile photo selection.
2. Expand the auth and user stores plus Supabase service helpers so launch bootstrap, auth state changes, 401 retry, logout cleanup, app config checks, and consent/profile gating are all handled centrally.
3. Implement the auth, terms re-consent, profile setup, force update, and authenticated home-entry screens with `react-hook-form`, Zod, inline validation, i18n, and keyboard-aware layout.
4. Wire profile photo upload, city auto-suggestion, push-token upsert/delete behavior, and the current repo-consistent logout/session-expiry UX.
5. Re-run validation, prove the milestone as far as this environment allows, and update the README if setup or testing expectations changed.

### Open questions / risks
- `AGENTS.md` says `expo-notifications` is added in Milestone 9, but Milestone 2 and `BACKEND.md` already require push-token re-registration on app launch. The smallest consistent decision is to add only the token-registration client path now, not the broader notification feature set.
- Optional profile photo upload depends on the `avatars` storage bucket and its policies from `BACKEND.md`; if that infrastructure is missing from the current live project, the client upload path can be implemented but not fully proven from this environment.
