Milestone 0 still needs later real-device proof for iOS dev-build install, offline banner verification on device, CZ/EN switch on device, React Query dummy cache proof on device, Sentry dashboard capture, and deep-link opening on a real install.

## Milestone 3 Navigation Shell

### Problem
Milestone 3 needs the app’s final navigation shell, deep-link routing, and profile-safe main-app entry points without reopening Milestone 2 or drifting into Milestone 4 features.

### Approach
Add a typed React Navigation shell on top of the existing auth/bootstrap gates, keep product screens as i18n-only stubs where Milestone 4 data does not exist yet, route event deep links through a small shared parser plus pending-link replay in Zustand, and keep foreground refresh aligned with the existing React Query/AppState setup.

### Steps
1. Install the Expo-compatible React Navigation packages and add typed root/tab/stack route definitions under `src/navigation/`.
2. Replace the single post-auth home screen with a bottom-tab shell, nested stacks, home sub-tabs, and the required screen stubs for section 11 near-term flows.
3. Wire event deep-link parsing, pending-link storage/replay, and navigation guards so incomplete profiles cannot bypass the existing gate.
4. Reuse the current React Query focus/AppState wiring, add any Milestone 3-specific proof helpers, and rerun validation plus dependency checks.

### Open questions / risks
- Milestone 2 known debt remains visible but out of scope here unless it blocks the shell directly: the authenticated device-token RPCs are still bearer-token-sensitive, and stale backend token cleanup can still lag if network cleanup fails after logout.
- Real device proof for Apple/Google auth, push behavior, and universal-link opening is still deferred, so this pass can only prove the shell and deep-link logic as far as the current environment allows.
