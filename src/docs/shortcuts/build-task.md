---
name: build-task
description: Build, verify, and publish your paw task — the full worktree agent workflow
---
Three-phase workflow: **Build → Verify → Publish**.

## Phase 1: Build

1. **Broadcast your intent.** Announce your plan so other agents can adapt:

   ```
   paw broadcast "Starting auth task. Will define AuthConfig type at src/auth/types.ts"
   ```

2. **Plan the work.** Break your task into small, testable increments. Bugs
   first, then features.

3. **Implement with TDD.** For each increment, follow the Red-Green-Refactor
   cycle strictly:
   - Write a failing test (Red)
   - Write minimal code to pass (Green)
   - Refactor while staying Green

   Load these guidelines before writing any code:
   - `paw guidelines general-tdd-guidelines` — the TDD methodology
   - `paw guidelines testing-anti-patterns` — mistakes to avoid (mock misuse,
     test-only production methods, incomplete doubles)

   Find the existing test directory (`tests/`, `__tests__/`, etc.) or create
   one. Run the full test suite after each change.

## Phase 2: Verify

An inner loop. Run checks, fix failures, repeat until clean.

**Load `paw guidelines verify-completion` before starting this phase.** The
core rule: no completion claims without fresh verification evidence.

### The loop

```
┌─→ 2a. Run checks
│       ↓
│   Pass? ──yes──→ exit loop → Phase 3
│       ↓ no
└── 2b. Fix ─────→ back to 2a
```

### 2a. Run checks

1. **Identify changed files.** Get a concrete list of what you touched:

   ```bash
   git diff --name-only HEAD   # unstaged + staged changes
   ```

   This is your working set for the checks below.

2. **Confirm spec is in sync.** If your task has a `spec:` or `issue:` field,
   open the spec and your task prompt side by side with your diff. Verify:
   - Every requirement assigned to your task is addressed in the changed files
   - Nothing you built contradicts or deviates from the spec
   - Edge cases and constraints called out in the spec are handled

   Don't modify the spec file itself — it's a shared document.

   Skip this step if your task has no linked spec.

3. **Review your diff.** Look for:
   - Leftover debug code, TODOs, commented-out blocks
   - Unused imports
   - Hardcoded values that should be constants
   - New env vars or config without documentation (`.env.example`, README)
   - Pattern inconsistency — if you changed a pattern (error handling, naming,
     API convention), search for remaining instances of the old pattern
   - Files outside your focus area you didn't mean to touch
   - Conflicts with anything another agent broadcast

4. **Lint, format, typecheck, and test.** Run all four. Find the project's
   specific commands in `package.json` scripts, `Makefile`, `pyproject.toml`,
   `Cargo.toml`, or the README — use what the project already has, not
   these defaults:

   ```bash
   # TypeScript / JavaScript
   eslint .              # lint
   prettier --write .    # format
   tsc --noEmit          # typecheck
   vitest                # test (or jest — check package.json)

   # Python
   ruff check .          # lint (legacy: flake8)
   ruff format .         # format (legacy: black)
   mypy .                # typecheck
   pytest                # test

   # Go
   golangci-lint run     # lint
   gofmt -w .            # format
   go vet ./...          # typecheck / static analysis
   go test ./...         # test

   # Rust
   cargo clippy          # lint
   cargo fmt             # format
   cargo check           # typecheck (faster than cargo build)
   cargo test            # test

   # C++
   clang-tidy <files>    # lint (needs compile_commands.json)
   clang-format -i <files>  # format
   cmake --build .       # typecheck + compile (or make, bazel)
   ctest                 # test
   ```

   **Don't guess the tooling.** Check config files first — different projects
   use different runners, formatters, and linters even within the same
   language.

5. **Confirm.** Read the full output. Check exit codes. Count failures. Only
   claim "pass" with evidence on screen — never "should work" or "looks good."

### 2b. Fix

Read what failed. Fix the root cause, not the symptom. Go back to 2a.

If you're stuck after several cycles, tell the right audience:

```bash
# Tell everyone (orchestrator + all agents)
paw broadcast "Stuck on flaky test in auth module — intermittent timeout in login.test.ts"

# Ask a specific agent for help
paw send <task> "Need the AuthConfig type shape — what fields are required?"
```

Use `paw broadcast` for announcements that affect everyone. Use
`paw send <task>` for questions or requests directed at a specific agent.
Replies arrive automatically — no need to poll your inbox.

### After the loop passes

**Broadcast interface changes.** If your changes affect types, exports, API
endpoints, or shared config that other agents depend on, broadcast before
committing:

```
paw broadcast "Changed UserProfile.email to optional, added UserProfile.emailVerified"
```

## Phase 3: Publish

1. **Commit.** Use conventional commit format (see `paw guidelines
   commit-conventions`). Each commit should be a single logical unit with
   passing tests.

2. **Write a summary.** Use `paw template summary-template` for the structure.
   Fill in issue references from your task's `issue:` field and specs from
   `spec:`. Write the result to `.paw/summary.md`.

3. **Signal completion.** Run `paw review` to submit your task for review.
   This command blocks until the reviewer finishes. On PASS, your task is
   marked done and the command exits 0.

   On FAIL, findings print to stdout and the command exits 1. Restart from
   Phase 1 — the review findings are your work now. Fix every issue, run
   through Verify, then Publish again. Before resubmitting, append a
   `## Fixed — Cycle N` section to `.paw/summary.md` (where N is the
   failed cycle number):

   ```markdown
   ## Fixed — Cycle 1

   | Finding | Resolution |
   |---------|------------|
   | CRITICAL/security src/api/users.ts:12 — SQL injection | Fixed: switched to parameterized query |
   | MAJOR/testing src/auth/login.ts:45 — no expired-token test | Fixed: added test in login.test.ts:89 |
   | MINOR/quality src/utils/helpers.ts:78 — console.log in prod | Fixed: removed |
   ```

   List every finding. For each one:
   - **Fixed:** describe the fix and where
   - **Not applicable:** explain why

   Don't skip findings. If the reviewer raised it, address it.