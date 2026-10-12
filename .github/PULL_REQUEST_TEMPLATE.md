## Summary

Briefly describe what changed and why.

## Related issue

Closes #<!-- issue number, if applicable -->

## Type of change

- [ ] Bug fix
- [ ] Feature
- [ ] UI/UX improvement
- [ ] Refactor
- [ ] Documentation / tooling

## Verification

List the checks you actually ran and their results. Do not check anything you did not run.

- [ ] `npm run check`
- [ ] `npm run lint`
- [ ] `npm run test:ui`
- [ ] `npm run test:rust`
- [ ] `cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check`
- [ ] `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings`
- [ ] Native app manually tested (describe below)

**Notes / unverified areas:**

## File safety (if applicable)

- [ ] File-operation tests use isolated temporary directories, never personal Downloads/Documents/OneDrive folders.
- [ ] Preview, validation, no-overwrite behavior, history, and undo safeguards are preserved.
- [ ] Recovery, conflicts, partial failures, and concurrent changes were considered.
- [ ] Not applicable (no changes to file operations).

## UI changes (if applicable)

Include screenshots of the actual application, with private file names and paths redacted.

## Checklist

- [ ] Changes are focused and avoid unrelated refactors.
- [ ] Relevant tests were added or updated, or an explanation is provided.
- [ ] No credentials, private file paths, or generated build artifacts were committed.
- [ ] Public documentation was updated if user-facing behavior changed.
