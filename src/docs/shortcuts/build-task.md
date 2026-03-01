---
title: Build Task
description: Build, verify, and publish your paw task — the full worktree agent workflow
category: worktree agent
---
A three-phase workflow for implementing your paw task assignment: **Build → Verify → Publish**.

## Phase 1: Build

1. **Broadcast your intent.** Before writing code, announce your plan so other
   agents can adapt: `paw broadcast "Starting auth task. Will define AuthConfig
   type at src/auth/types.ts"`.

2. **Plan the work.** Break your task into small, testable increments. Bugs first,
   then features.

3. **Implement with TDD.** For each increment:
   - Write a failing test first (Red)
   - Write the minimum code to pass (Green)
   - Refactor (still Green)
   - Follow `paw guidelines general-tdd-guidelines` for the methodology
   - Follow `paw guidelines general-testing-rules` for test quality
   - For TypeScript projects, also see `paw guidelines typescript-testing-guidelines`
   - Find the existing test directory (`tests/`, `__tests__/`, etc.) or create one
   - Run the full test suite after each change

## Phase 2: Verify

Review and validate before publishing. Retry up to 3 times if anything fails.

1. **Review your diff.** Check for:
   - Leftover debug code, TODOs, commented-out blocks
   - Files outside your focus area that you didn't mean to touch
   - Conflicts with anything another agent just broadcast

2. **Format, lint, and test.** Run the project's validation commands. Look for
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

3. **Broadcast interface changes.** If your changes affect anything other agents
   might depend on (types, exports, API endpoints, shared config), broadcast
   before committing:

   ```
   paw broadcast "Changed UserProfile.email to optional, added UserProfile.emailVerified"
   ```

4. **If anything fails**, fix the issue and re-run the full Verify phase. After
   3 failed attempts, broadcast the problem so the orchestrator is aware.

## Phase 3: Publish

1. **Commit with a clear message.** Use conventional commit format
   (see `paw guidelines commit-conventions`). Each commit should be a single
   logical unit with passing tests.

2. **Push your branch.**

   ```bash
   git push -u origin HEAD
   ```

3. **Create or update a PR.** Use `paw template pr-template` for the body structure.
   Fill in issue references from your task's `issue:` field and specs from `spec:`.

   Check if a PR already exists for this branch (e.g., from a prior review cycle):

   ```bash
   BRANCH=$(git branch --show-current)
   TITLE="feat(scope): short description"
   BODY="$(cat <<'EOF'
   ## Summary
   ...

   ## Changes
   ...

   ## Testing
   ...

   ## References
   ...
   EOF
   )"

   # Create or update PR
   if gh pr view "$BRANCH" --json number &>/dev/null; then
     gh pr edit "$BRANCH" --title "$TITLE" --body "$BODY"
   else
     gh pr create --title "$TITLE" --body "$BODY"
   fi
   ```

4. **Signal completion.** Run `paw review` to submit your task for review.

## Principles

- **Broadcast interface changes.** If you change a type, export, or API another task
  depends on, `paw broadcast` before committing. This is the most important
  coordination action.
- **Ask when blocked.** If you need something from another task — a type definition,
  an interface shape, a decision — don't guess. Use `paw ask <task> "..."` to direct
  a question, then `paw inbox --all` to check when the answer arrives.
- **Stay in your focus area.** Your task file lists which files you own. Edits outside
  your focus cause merge conflicts.
