## Milestone 0

### Problem
Milestone 0 still has two closeout gaps: repo commands should use Node 20 without manual shell switching, and the documented Supabase refresh-token bootstrap must match the actual supported API.

### Approach
Keep the existing Expo foundation intact, add a small repo-local Node 20 runner for package scripts, and correct the auth bootstrap wording to the supported `refreshSession({ refresh_token })` flow instead of documenting an impossible `setSession()` call.

### Steps
1. Add the minimal repo-local Node 20 defaults needed for package scripts and validation commands.
2. Align the documented Supabase auth bootstrap with the refresh-token-only storage strategy used by the app.
3. Re-run validation and separate code-fixed items from runtime proof still needed on a device or emulator.

### Open questions / risks
- Real device or emulator proof is still required for Sentry capture, offline behavior, deep links, and the app-launch checkpoint.
- The repo can enforce Node 20 for its own package scripts, but a shell opened outside the repo's scripts may still report a different default `node -v`.
