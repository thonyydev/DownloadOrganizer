# Download Organizer — Agent Instructions

This file provides project-level instructions for AI coding agents, including Codex. Follow these rules when working anywhere in this repository. If a task conflicts with these instructions, explain the conflict and follow the user's explicit request, provided it is safe.

## 1. Mission and priorities

Download Organizer is a Windows-first desktop application for organizing downloaded files, built with Tauri 2, Rust, React, TypeScript, Vite, and SQLite.

Optimize for, in order:
1. **User data safety:** never lose, overwrite, or unexpectedly move files.
2. **Correctness and recoverability:** predictable previews, confirmations, operation history, and undo.
3. **Reliability:** resilient monitoring, errors, and application state.
4. **Usability and accessibility:** clear feedback and an efficient desktop workflow.
5. **Maintainability and performance:** focused changes, readable code, and measured optimization.

Treat file-system operations as high-risk, even if the requested change looks small.

## 2. Project map

Check the actual repository before editing; this map describes the current organization and is not a substitute for reading the code.

- `src/` — React and TypeScript frontend.
- `src/App.tsx` — top-level application composition and workflows.
- `src/App.css` — application-level styling and visual tokens.
- `src/components/` — UI and feature components (files, settings, dialogs, notifications).
- `src/components/ui/` — shared UI primitives; prefer reuse to unnecessary duplication.
- `src/lib/api.ts` — typed frontend-to-Tauri boundary; preserve existing contracts.
- `src/lib/experience.ts` — frontend experience/state helpers.
- `src/**/*.test.ts(x)` — frontend tests.
- `src-tauri/src/lib.rs` — Tauri integration and commands.
- `src-tauri/src/engine.rs` — core organization behavior.
- `src-tauri/src/monitor.rs` — directory monitoring.
- `src-tauri/src/queue.rs` — background operation coordination.
- `src-tauri/src/store.rs` — SQLite persistence.
- `src-tauri/src/tests.rs` — Rust tests.
- `src-tauri/capabilities/` — native permission configuration.
- `src-tauri/tauri.conf.json` — Tauri application configuration.
- `docs/` — **local, Git-ignored** workspace for AI-generated reviews, audits, plans, debugging notes, and reports (see section 10).

Keep file-system authority and validation in Rust. The frontend renders state, obtains user intent, and calls typed commands; it must not be trusted to authorize dangerous changes.

## 3. Working method

Before coding:
1. Read the relevant implementation, tests, and public contracts.
2. Identify the smallest coherent change that solves the problem.
3. For nontrivial changes, briefly explain the plan and relevant risks.
4. Check whether a related regression test already exists.

While coding:
- Follow established project conventions before introducing abstractions.
- Keep changes scoped. Avoid broad refactors, dependency additions, and unrelated formatting.
- Prefer explicit types and readable control flow over clever shortcuts.
- Handle errors and partial outcomes explicitly; do not silently swallow failures.
- Keep application-facing messages clear and consistent with the existing localization/language choices.
- Never claim functionality or tests were verified if they were not run.

After coding:
- Add or update focused tests for behavior changes.
- Run the checks relevant to touched areas.
- Report what changed, what was tested, and what remains unverified.
- Do not commit, push, tag, publish a release, or modify remote resources unless explicitly requested.

## 4. File operations — non-negotiable safety rules

- **Preview is not authorization.** Revalidate inputs and state in Rust immediately before executing any move or undo, including expired or invalidated previews.
- Use the existing preview/confirmation workflow. Never bypass it for convenience.
- Never overwrite an existing destination file silently. Respect current conflict and collision policies.
- Do not delete originals until a move/copy outcome has been verified according to the engine's existing semantics.
- Consider cross-volume moves, partial failures, permission errors, locked files, interrupted operations, and concurrent changes.
- Do not move files that may still be downloading or written to; follow the engine's established completion/stability rules.
- Defend against unsafe paths, traversal, unexpected symlinks, and changes between inspection and execution. Preserve explicit directory boundaries.
- Preserve operation identity, audit/history records, and undo safety. Undo must not blindly overwrite or remove user data.
- Preserve cancellation, progress reporting, and partial-result visibility when supported.
- Keep filesystem work off the UI thread. Avoid blocking the Tauri event loop or React rendering.
- Do not assume notification/watch events are unique, complete, or ordered. Handle duplicate and missed events safely.
- Avoid expanding Tauri capabilities or filesystem permissions without a concrete requirement and explanation.

**Testing rule:** use isolated temporary directories and synthetic files. Never run destructive tests against the user's actual Downloads, Desktop, Documents, OneDrive folders, or other personal data.

## 5. SQLite, settings, and concurrency

- Use transactions for changes that must be atomic.
- Preserve the current protection against stale/external settings updates; do not introduce lost updates.
- Keep schema changes intentional and backward-compatible where feasible. Add a migration path for persistent data changes.
- Avoid holding database locks across slow filesystem operations.
- Handle corrupted, missing, and partially valid application state with clear, safe behavior.
- Preserve unsaved settings drafts, explicit save/discard flows, and closing/navigation protection.
- Do not store secrets, absolute personal paths, or real user file names in test fixtures, logs, or documentation.

## 6. Frontend architecture and UX

- Prefer existing React/TypeScript patterns and reusable components.
- Keep Tauri command payloads and responses typed. Update both sides and tests if a contract truly changes.
- Model asynchronous states explicitly: idle, previewing, confirming, running, completed, partial success, and failed, as applicable.
- Do not leave stale confirmation actions enabled after a preview expires.
- Display meaningful operation progress within the active dialog or workflow; prevent duplicate submissions.
- Make persistent errors actionable without pretending they have been resolved.
- Distinguish an empty directory from filtered search results with no matches.
- Show file destination and skip/conflict reasons through accessible interactions, not tooltip-only information.
- Do not introduce mock data into production UI or nonfunctional controls.

## 7. Visual direction — premium desktop, Raycast-inspired

Build an original visual identity inspired by Raycast's restraint and craftsmanship, **not a clone**.

- **Desktop-first:** compact, information-dense, fast to scan, and useful at smaller window sizes.
- **Dark-first, not dark-only:** preserve a usable light theme with independently checked semantic colors.
- **Visual hierarchy:** emphasize monitored folder, monitoring status, preview, primary action, and recent activity.
- **Design tokens:** keep colors, surfaces, borders, typography, radii, and spacing consistent; avoid scattered magic values.
- **Typography:** use a coherent type scale; avoid tiny functional labels. Favor legibility over decorative density.
- **Components:** subtle separators, restrained accent color, consistent icon sizing, visible selection/focus/hover states.
- **Motion:** short, purposeful transitions; honor `prefers-reduced-motion`.
- **Avoid:** generic SaaS dashboards, excessive cards, decorative gradients, overused glass effects, large empty hero sections, and needless animations.
- **Accessibility:** keyboard navigation, semantic state (`aria-expanded`, selected/pressed states where appropriate), visible focus, readable contrast, and meaningful error text.

For substantial visual work, use the installed design skill (e.g. `ui-ux-pro-max`) if available, but first analyze the real product flows. Do not mistake a palette swap for a redesign.

Review layouts at least at **1280×800** and **1024×700** when visual testing is possible. Check window resize, overflow, long paths, empty/error/loading states, dark/light themes, and keyboard use. If no native-window inspection was performed, state that limitation.

## 8. Testing and quality gates

First inspect `package.json` and `src-tauri/Cargo.toml` to confirm available scripts, features, and platform requirements. Common checks for this repository include:

```powershell
npm run check
npm run lint
npm run test
cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml
```

Run the applicable commands; if a script differs, use the project's actual script rather than forcing these examples. For significant Tauri/build changes, additionally validate a native no-bundle build using the command supported by the repository.

Add regression tests for relevant edge cases, especially:
- expired/stale previews and changed files;
- duplicate destination names and unsafe paths;
- cross-volume or interrupted moves, partial failures, and undo conflicts;
- monitoring event duplication or file-in-progress behavior;
- unsaved settings and concurrent modifications;
- progress, errors, filtered empties, and keyboard-accessible UI states.

Do not weaken existing assertions or skip failing tests to make a task appear complete.

## 9. Dependencies, generated files, and Git

- Prefer platform APIs and existing libraries before adding dependencies.
- Explain any new dependency in terms of benefit, maintenance, size, and security.
- Keep `package-lock.json` and `src-tauri/Cargo.lock` committed and updated with dependency changes.
- Do not commit `node_modules/`, Rust `target/`, frontend `dist/`, `.env` secrets, caches, personal test data, or locally installed agent skills when ignored.
- Keep `AGENTS.md` in version control. Follow `.gitignore`; do not forcibly add ignored files.
- Keep the internal `docs/` workspace ignored by Git. Never force-add these internal artifacts or assume they will be present on GitHub.
- Do not add a license, make the project public, or change distribution/monetization policy without approval.

## 10. Internal documentation and agent-generated artifacts

Store **all agent-generated review documents and working reports inside `docs/`**, never loose in the repository root. This includes reviews, audits, implementation plans, investigation notes, debugging summaries, and detailed verification reports.

Use a predictable structure, creating subdirectories only when needed:

```text
docs/
├── reviews/         # Code, architecture, UI/UX, security and release reviews
├── audits/          # Focused investigations and technical audits
├── plans/           # Larger task/feature and migration plans
├── reports/         # Test, build, benchmark and verification reports
└── investigations/  # Reproduction notes and debugging findings
```

Rules:
- Name new documents descriptively, preferably `YYYY-MM-DD-topic.md` (for example, `docs/reviews/2026-10-12-ui-ux-review.md`). Avoid vague root-level names such as `REVIEW.md`, `REPORT.md`, `PLAN.md`, or `NOTES.md`.
- When updating an existing review or plan, **update its existing document** rather than creating near-duplicates; keep its context and date accurate.
- When asked to produce a detailed review, audit, plan, or report, **save it under the appropriate `docs/` subdirectory**. For substantial autonomous work, write a detailed artifact there if it materially helps the user; do not generate unnecessary reports for trivial edits.
- Write reviews with actionable findings, severity or priority, affected file paths, verification status, and concrete next steps. Clearly separate observations from hypotheses and unverified behavior.
- Keep the final chat response concise and link or identify the internal document path when one was created.
- `docs/` is intentionally **local-only** and ignored via `.gitignore`. Never use `git add -f` to include it without explicit permission. Do not link to ignored `docs/` documents from public `README.md`, GitHub templates, or tracked files: those links would break after cloning.
- Keep public, version-controlled material such as `README.md`, `AGENTS.md`, `CONTRIBUTING.md`, `CHANGELOG.md`, and license information outside the ignored `docs/` directory. If the user explicitly requests public documentation, confirm or use a tracked location instead of putting it in this ignored workspace.
- Never include private user paths, secret values, or personal filenames in reports; redact them or use safe placeholders.

## 11. Response format for completed tasks

Use a compact report:
1. **Summary:** what was implemented and why.
2. **Files changed:** important files or modules.
3. **Verification:** exact checks run and their results.
4. **Risks/limitations:** what was not tested, especially native UI and real-world file operations.
5. **Next step:** one practical follow-up, if needed.

If requirements are ambiguous and affect user data, ask before implementing. Otherwise, make a reasonable, conservative choice and document it.
