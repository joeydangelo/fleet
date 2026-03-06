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

2. **Reach out to dependencies.** If your task depends on another task's
   output — a type definition, an API endpoint, a config shape — send a
   message early asking for the interface:

   ```
   paw send <task> "I need the SessionStore interface shape to build the auth middleware. What fields and methods are you exposing?"
   ```

   Don't wait until you're blocked. The earlier you ask, the more time the
   other agent has to respond while you work on independent parts.

3. **Plan the work.** Break your task into small, testable increments. Bugs
   first, then features.

4. **Implement with TDD.** For each increment, follow the Red-Green-Refactor
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

Every step in 2a follows one rule: run the check, read the output, then
state the result. No claims without fresh evidence.

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

2. **Confirm the work matches the assignment.** Open your task prompt, any
   linked spec or issue, and your diff side by side. Verify:
   - Every requirement assigned to your task is addressed in the changed files
   - Nothing you built contradicts or deviates from the assignment
   - Edge cases and constraints called out are handled

   If a spec file exists, don't modify it — it's a shared document.

3. **Review your diff.** Look for:
   - Leftover debug code, TODOs, commented-out blocks
   - Unused imports
   - Hardcoded values that should be constants
   - New env vars or config without documentation (`.env.example`, README)
   - Pattern inconsistency — if you changed a pattern (error handling, naming,
     API convention), search for remaining instances of the old pattern
   - Files outside your focus area you didn't mean to touch
   - Conflicts with anything another agent broadcast

4. **Format, lint, typecheck, and test.** Run in this order. Check
   `package.json`, `Makefile`, `pyproject.toml`, or similar for the project's
   specific commands. Fix any failures before proceeding.

### 2b. Fix

Fix any issue found in 2a — missing requirements, diff problems, or check
failures. Fix the root cause, not the symptom. Go back to 2a.

If you're stuck after several cycles, tell the right audience:

```bash
# Tell everyone (orchestrator + all agents)
paw broadcast "Stuck on flaky test in auth module — intermittent timeout in login.test.ts"

# Ask a specific agent for help
paw send <task> "Need the AuthConfig type shape — what fields are required?"
```

Use `paw broadcast` for announcements that affect everyone. Use
`paw send <task>` for questions or requests directed at a specific agent.

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