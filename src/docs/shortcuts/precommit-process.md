---
title: Pre-Commit Process
description: Check messages, review, validate, broadcast, and commit — the checklist before every commit
category: worktree agent
---
Follow this process before every commit. It keeps your work clean and keeps other
agents informed.

## Checklist

1. **Check for open threads.**

   ```
   paw threads
   ```

   See open Q&A threads and answer directed questions before reviewing your own work.
   If another agent changed an interface you depend on, you want to know that before
   your review — not after.

2. **Review your changes.**

   Look at the diff. Check for:
   - Leftover debug code, TODOs, commented-out blocks
   - Files outside your focus area that you didn't mean to touch
   - Interface changes that other agents depend on
   - Conflicts with anything another agent just broadcast

3. **Format, lint, and test.**

   Run the project's validation commands. Fix failures before committing. Look for
   these in the project's README, package.json scripts, Makefile, or pyproject.toml:

   ```bash
   # TypeScript / JavaScript
   pnpm format && pnpm lint && pnpm test    # or npm run, yarn, bun
   npx prettier --write . && npx eslint --fix . && npx vitest run

   # Python
   uv run ruff format . && uv run ruff check --fix . && uv run pytest

   # Rust
   cargo fmt && cargo clippy && cargo test

   # Go
   gofmt -w . && golangci-lint run && go test ./...
   ```

   Use whatever the project already has. Don't guess — check the config files.

4. **Broadcast interface changes.**

   If your changes affect anything other agents might depend on (types, exports,
   API endpoints, shared config), broadcast before committing:

   ```
   paw broadcast "Changed UserProfile.email to optional, added UserProfile.emailVerified"
   ```

   This gives other agents a chance to see the change before they hit a merge
   conflict.

5. **Commit with a clear message.**

   Use conventional commit format (see `paw guidelines commit-conventions`):

   ```
   feat(auth): Add OAuth2 login flow with Google and GitHub
   ```

   If all checks pass, commit directly. Only ask the user if there are unresolved
   problems.
