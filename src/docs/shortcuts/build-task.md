---
name: build-task
description: Build, verify, and publish a fleet task in an isolated worktree
roles: [builder]
---

## Variables

| Variable | Source | Default |
|---|---|---|
| `TASK_FILE` | `.fleet/tasks/*.md` in worktree | Read on entry |
| `BRANCH` | `git branch --show-current` | Read on entry |
| `MAX_VERIFY_RETRIES` | Static | `3` |

## Failure Modes

| Mode | Trigger |
|---|---|
| `SCOPE_DRIFT` | Changed files outside task assignment |
| `SKIPPED_GATE` | Proceeded without gate passing |
| `SILENT_FAILURE` | Ignored failing check without fix or escalation |
| `UNTESTED_CODE` | New logic without corresponding test |
| `STALE_BROADCAST` | Changed shared interface without broadcasting |

## Workflow

### Phase 1: Orient

**Objective:** Establish plan and announce intent before writing code.
**Tools:** Bash (fleet commands only), Read

1. Read `TASK_FILE` and any linked spec or issue.
2. Broadcast intent: `fleet broadcast "Starting <task>. Will modify <files/interfaces>"`.
3. Send dependency requests to other agents: `fleet send <task> "..."`.
4. Break the work into small, testable increments. Bugs first, then features.

**Gate:** Plan exists (list of increments). Broadcast sent.
**Artifact:** Mental model — no file output.

---

### Phase 2: Build

**Objective:** Implement all increments using TDD with passing smoke tests.
**Tools:** Read, Write, Edit, Bash, Glob, Grep

1. Load `fleet guidelines testing`.
2. For each increment, follow Red-Green-Refactor:
   - Write a failing test.
   - Write minimal code to pass.
   - Refactor while staying green.
3. After each cycle, run only the affected test file (smoke test).
   - If smoke test fails: fix and re-run before starting next increment.

**Gate:** All smoke tests pass. Lint reports zero errors in changed files.
**Artifact:** Working implementation with passing tests per file.

---

### Phase 3: Verify

**Objective:** Zero new lint/type/test failures. All task requirements addressed.
**Tools:** Read, Grep, Bash

Run the verify loop (max `MAX_VERIFY_RETRIES` cycles):

1. List changed files: `git diff --name-only HEAD`.
2. Compare changed files against `TASK_FILE` and linked spec:
   - Every requirement addressed in changed files.
   - No files outside task scope (`SCOPE_DRIFT`).
3. Select validation level based on change risk:
   - **Level 1** (docs, config, formatting): lint + typecheck.
   - **Level 2** (features, bug fixes, endpoints — **default**): lint + typecheck
     + relevant tests (scoped to changed modules).
   - **Level 3** (auth, migrations, payments, schemas): lint + typecheck + relevant
     tests + full test suite + build.
4. Check `package.json`, `Makefile`, `pyproject.toml`, or similar for project
   commands. Run validation at the selected level. Fix failures (max
   `MAX_VERIFY_RETRIES` per error). Pre-existing failures (not caused by your
   changes): document in the summary and proceed.
5. Broadcast interface changes (types, exports, API, config):
   `fleet broadcast "Changed <interface>: <details>"`.

**Gate:** Quality suite introduces no new failures. All task requirements covered.
**Artifact:** Clean diff (all changes staged).

---

### Phase 4: Publish

**Objective:** Commit, record evidence, and submit for review.
**Tools:** Bash

1. Commit with conventional format (see `fleet guidelines commit-conventions`).
   Each commit: single logical unit with passing tests.
2. Load `fleet template summary-template`, then run:

   ```bash
   fleet summary <<'EOF'
   (filled-in template here)
   EOF
   ```

3. Run `fleet review` to submit for review.
   - On PASS (exit 0): task is done.
   - On FAIL (exit 1): findings print to stdout. Restart from Phase 2 with
     findings as new requirements. Before resubmitting, append a fix table
     using `fleet summary --append`:

     ```bash
     fleet summary --append <<'EOF'
     ## Fixed — Cycle N

     | Finding | Resolution |
     |---------|------------|
     | <severity/category file:line — description> | Fixed: <what and where> |
     EOF
     ```

     Address every finding: **Fixed** (describe fix) or **Not applicable** (explain why).

**Gate:** `fleet review` exits 0.
**Artifact:** Committed branch with PR, submitted for review.

## Context Flow

- Phase 1 -> Phase 2: task plan (increments list), dependency requests sent
- Phase 2 -> Phase 3: changed files with passing smoke tests
- Phase 3 -> Phase 4: clean diff, passing validation at selected level, evidence
- Phase 4 -> Phase 2: (on FAIL) review findings as new requirements

## Stopping Conditions

Stop when ANY of these are true:

- `fleet review` returns PASS — task complete. Sync state is already updated; no
  further action needed.
- `MAX_VERIFY_RETRIES` exhausted for the same error:
  ```
  fleet send orchestrator "Blocked: <error> persists after 3 fix attempts. Need guidance."
  ```
- `SCOPE_DRIFT` detected — files changed outside task assignment:
  ```
  fleet send orchestrator "Scope issue: task requires changes to <files> outside my focus area."
  ```
- Blocked on another agent's output with no response:
  ```
  fleet send orchestrator "Blocked: waiting on <task> for <interface>. No response."
  ```

## Output Format

No standalone output. The workflow produces:

1. Git commits on `BRANCH` (conventional format).
2. Task summary via `fleet summary` (with validation evidence).
3. Review submission via `fleet review`.

Forbidden in output:

- Preambles ("I have...", "Let me...", "Based on...", "Here is...")
- Meta-commentary about what the agent is doing
- Reasoning that belongs in tool calls, not artifacts
