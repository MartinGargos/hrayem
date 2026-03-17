# Repository rules

## Purpose
This repository is for building a production-quality mobile app for iOS and Android.
The goal is to ship a real, polished, maintainable app that is ready for App Store and Google Play submission.
Do not optimize for shortcuts, fake features, or demo-only code.

## Non-negotiable constraints
- Use a single cross-platform codebase.
- Prefer React Native with Expo unless the user explicitly changes the stack.
- TypeScript only — no `any` without a comment explaining why.
- Do not replace the chosen stack unless the user explicitly approves it.
- Keep the app realistic and production-oriented.
- Do not add unnecessary complexity or over-engineer.

## Product rules
- Follow the app specification (APP.md) exactly.
- Do not invent major features that are not specified.
- Do not silently change product scope, target user, monetization model, or branding.
- If something important is ambiguous, make the smallest reasonable assumption, document it clearly, and move on. Stop and ask only if the ambiguity affects core product scope or architecture — not for implementation details.
- If a decision is high-impact and truly irreversible (e.g. data model, auth approach, navigation structure), stop and ask before proceeding.

## Working style
- Think like a senior mobile engineer shipping a product, not like a demo generator.
- Prefer small, high-confidence steps.
- Keep changes reviewable.
- Before large changes, write a short plan inline or in `PLANS.md`.
- For complex features or major refactors, create or update `PLANS.md` first, then implement from that plan.

### PLANS.md format
When creating or updating `PLANS.md`, include:
1. **Problem** — one sentence on what needs to change and why.
2. **Approach** — the proposed solution and key decisions made.
3. **Steps** — a short ordered list of implementation steps.
4. **Open questions / risks** — anything that could go wrong or needs a follow-up decision.

Keep it concise. A plan is a contract, not an essay.

## Project structure
- Follow the existing folder structure. Do not reorganize without a clear reason.
- If starting fresh with no existing structure, use a feature-based layout:
  ```
  src/
    features/       # one folder per product feature
    components/     # shared, reusable UI
    hooks/          # shared custom hooks
    utils/          # pure functions and helpers
    navigation/     # navigators and route config
    services/       # API clients, storage, external integrations
    store/          # global state (if applicable)
    types/          # shared TypeScript types and interfaces
  ```
- Co-locate tests, styles, and sub-components with the feature they belong to.

## Code quality
- Write clean, readable, strongly typed code.
- Prefer simple architecture and predictable state management.
- Avoid dead code, placeholders, fake mocks in production paths, and TODO spam.
- Keep components modular and reusable.
- Use clear, intention-revealing names — avoid abbreviations unless universally obvious.
- Do not duplicate logic when a shared utility, hook, or component is more appropriate.
- Add code comments only when the *why* is non-obvious. Do not comment the *what*.

## Error handling
- Surface errors to the user in a clear, actionable way (e.g. toast, inline message). Do not silently swallow them.
- Log errors with enough context to debug, but never log sensitive user data.
- Use typed error handling — avoid bare `catch (e: any)`.
- Distinguish between expected failures (e.g. network timeout) and unexpected ones (e.g. assertion errors). Handle each appropriately.

## UX and product quality
- Mobile UX must feel polished.
- Prioritize clarity, speed, and reliability.
- Handle loading, empty, error, and offline-ish states where relevant.
- Use accessible labels (`accessibilityLabel`, `accessibilityHint`) and sensible touch targets (minimum 44×44pt).
- Avoid default-feeling UI when a better simple solution is easy to achieve.
- Do not hardcode user-facing strings if the app has any realistic chance of being localized. Use a constants file or i18n solution from the start.

## Expo and native modules
- Stay in Expo managed workflow by default.
- If a feature requires a bare workflow or a native module not supported by Expo, flag it explicitly before proceeding.
- Prefer Expo SDK APIs and Expo-compatible libraries. Check `expo-doctor` compatibility before adding new native dependencies.

## Dependencies
- Prefer well-known, actively maintained libraries.
- Do not add a new production dependency unless it clearly improves speed, quality, or maintainability over a reasonable hand-rolled solution.
- Keep dependency count lean.
- Before adding a dependency, check: Is it Expo-compatible? Is it actively maintained? Does it have TypeScript types?

## Security and data handling
- Never hardcode secrets, API keys, tokens, passwords, or credentials — not even in comments or example values.
- Use environment variables for secrets; use `expo-constants` or a `.env` approach consistent with the project.
- Do not log sensitive user data (PII, tokens, passwords).
- Validate and sanitize inputs. Handle failures safely and explicitly.

## Testing and validation
Before declaring a task done:
- Run lint: `npm run lint`
- Run typecheck: `npm run typecheck`
- Run tests if they exist: `npm test`
- Run Expo doctor if dependencies changed: `npx expo-doctor`
- If tests do not exist for changed core logic, add targeted tests where reasonable.
- Verify the app still builds.

If command names differ from defaults, detect and use the repo's actual scripts.

## Definition of done
A task is done only when:
- the requested behavior works correctly,
- the code is consistent with these repo rules,
- obvious edge cases (empty state, error state, loading state) are handled,
- all validation steps were run and passed,
- and a short summary of what changed is provided.

"It compiles" is not done. "It works in the happy path" is not done. Done means done.

## Output format for each substantial task
After substantial work, report:

```
### Summary
[One sentence on what changed and why]

### Files changed
[List of files added, modified, or deleted]

### Commands run
[Lint / typecheck / test output — pass or fail, with any relevant details]

### Assumptions and risks
[Any assumptions made, open questions, or known risks]
```

## What to avoid
- Giant speculative refactors.
- Rewriting working code without a strong, stated reason.
- Introducing backend requirements that were not requested.
- Fake or stubbed implementations presented as complete.
- Skipping validation and claiming success.
- Reorganizing folder structure mid-feature without a plan.
- Adding dependencies to solve problems that don't exist yet.

## App Store readiness
The app must be submittable to the App Store and Google Play at any point — not retrofitted at the end.
- Set `bundleIdentifier` (iOS) and `package` (Android) from day one. Never change them after the first build.
- All required permission usage description strings (`NSLocationWhenInUseUsageDescription`, `NSCameraUsageDescription`, `NSPhotoLibraryUsageDescription`, etc.) must be in `app.json` / `app.config.js` from the first build that uses those permissions.
- Apple Sign In must be implemented if any other OAuth provider (e.g. Google) is offered — App Store requirement.
- Account deletion from within the app is required by Apple. Do not skip this.
- Push notification permission must be requested with a meaningful usage description — not a generic string.
- Never ship placeholder content, lorem ipsum, or hardcoded demo data in a production build.
- Use EAS Build for all store builds. Use `development`, `preview`, and `production` profiles in `eas.json` from the start.
- App icons and splash screens must be provided at all required sizes using Expo's asset pipeline.
- Privacy Policy URL must be referenced in `app.json` and accessible at a real URL before submission.

## README maintenance
`README.md` must exist and stay accurate at all times. It is the handoff document — someone with no context should be able to clone the repo, follow it, and run the app.

The README must always include:
- **What the app is** — one paragraph, plain language
- **Tech stack** — React Native + Expo + Supabase, with versions
- **Prerequisites** — Node version, Expo CLI, EAS CLI, environment variables needed
- **Environment setup** — how to create `.env` and what each variable is for (no actual values)
- **How to run locally** — exact commands from clone to running on a simulator/device
- **How to run on a real device** — Expo Go or dev build instructions
- **Supabase setup** — how to apply migrations, seed data, and deploy Edge Functions
- **Build and submit** — EAS build commands for development, preview, and production profiles
- **Project structure** — brief description of the `src/` folder layout
- **Key decisions** — a short bullet list of non-obvious architectural choices (e.g. why `timestamptz`, why Edge Functions gate writes)

Update the README whenever any of the above changes. Do not let it drift from reality. A README that lies is worse than no README.

## Git hygiene
- Make focused commits with clear, imperative messages (`Add login screen`, not `stuff`).
- Do not commit broken builds knowingly.
- Make a checkpoint commit before any major refactor.
- Keep PRs/commits scoped — one logical change per commit where possible.

## If the repo is empty
If starting from an empty repo:
1. Scaffold the minimal correct project structure using `npx create-expo-app` or equivalent.
2. Apply the folder structure from the **Project structure** section.
3. Keep setup conventional and minimal — no optional extras unless they clearly support the requested app.
4. Explain what was created and why.
5. Run `npx expo-doctor` and resolve any issues before writing product code.
