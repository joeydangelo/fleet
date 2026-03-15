---
name: finish-branch
description: Verify the merged target branch and integrate via the user's chosen path
roles: [orchestrator]
---

## Variables

| Variable | Source | Default |
|---|---|---|
| `TARGET_BRANCH` | `fleet merge` output (required) | — |
| `BASE_BRANCH` | git default branch | `main` |
| `MAX_FIX_ATTEMPTS` | static | `3` |

## Failure Modes

| Mode | Trigger |
|---|---|
| `TRUST_WITHOUT_VERIFY` | Presented integration options before validation passed |
| `BLANKET_VALIDATION` | Ran full test suite for docs-only changes, or skipped tests for logic changes |
| `VAGUE_APPROVAL` | Presented options without change summary and validation results |
| `SKIP_CI` | Created PR without waiting for CI to complete |
| `PREMATURE_DISCARD` | Deleted branch without explicit user confirmation |

## Workflow

### Phase 1: Verify

**Objective:** Validate the merged target branch at a level matched to the change scope.
**Tools:** Bash, Read

1. Determine the validation level from the changes on `TARGET_BRANCH`:
   - **Level 1** (docs, config, formatting): lint + typecheck.
   - **Level 2** (core logic, bug fixes, new endpoints — **default**): lint + typecheck + tests.
   - **Level 3** (migrations, auth, release prep): lint + typecheck + full test suite
     + build.
2. Check `package.json`, `Makefile`, `pyproject.toml`, or similar for project commands.
   Run validation at the selected level. Fix failures (max `MAX_FIX_ATTEMPTS` per
   error). Pre-existing failures (not caused by this branch): document and proceed.
3. If a spec exists with `must_haves`, verify goal-backward: `truths` (behavioral
   assertions hold), `artifacts` (expected files exist), `key_links` (issue references
   present in commits or PR body).

**Gate:** Validation passes at the selected level. All `must_haves` satisfied.
**Artifact:** Validation results and must_haves status.

---

### Phase 2: Integrate

**Objective:** Present the verified branch with context and execute the user's chosen
integration path.
**Tools:** Bash, AskUserQuestion

1. Determine `BASE_BRANCH`:
   `git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed 's|.*/||'`.
   If ambiguous, use `AskUserQuestion`.
2. Present the post-action review gate with context:
   ```
   Target branch `<TARGET_BRANCH>` verified (Level N).
   <change summary — files changed, tests passed, key deliverables>.

   1. Merge to <BASE_BRANCH> locally
   2. Push and create a Pull Request
   3. Keep the branch as-is
   4. Discard
   ```
   Wait for the user to choose.
3. Execute the chosen path:

   **Option 1 — Merge locally:**
   Checkout `BASE_BRANCH`, pull, merge `TARGET_BRANCH`. If not fast-forward, re-run
   validation at the same level. Delete `TARGET_BRANCH` after successful merge.

   **Option 2 — Create PR:**
   Push `TARGET_BRANCH`. Scan `fleet.yaml` `issue` fields for GitHub issue numbers.
   Create PR with structured body: summary, changes, validation evidence (level,
   commands run, results), `Closes #N` links. Wait for CI:
   `gh pr checks <TARGET_BRANCH> --watch 2>&1`. If CI fails, fix, push, wait again.
   Report PR URL and CI status.

   **Option 3 — Keep as-is:**
   Report branch name. No further action.

   **Option 4 — Discard:**
   Confirm: "This permanently deletes branch `<TARGET_BRANCH>` and all commits on it.
   Type 'discard' to confirm." Wait for exact match. Checkout `BASE_BRANCH`, then
   `git branch -D <TARGET_BRANCH>`.

**Gate:** Chosen path executed. For Option 2: PR created and CI passing.
**Artifact:** Integration outcome: merge commit, PR URL, branch name, or deletion.

## Context Flow

- Upstream (fleet merge / resolve-merge-conflict) → Phase 1: merged target branch
- Phase 1 → Phase 2: validation level, results, must_haves status, change summary

## Stopping Conditions

Stop and report when ANY of these are true:

- Chosen integration path executed successfully.
- Validation failures persist after `MAX_FIX_ATTEMPTS` — report failures.
- CI fails repeatedly after fixes — report CI status and PR URL.
- Integration path requires information only the user can provide — use
  `AskUserQuestion`.

## Output Format

Report: validation level, results, integration path executed, outcome (PR URL, merge
status, or branch name).

Forbidden in output:

- Preambles ("I have...", "Let me...", "Based on...", "Here is...")
- Meta-commentary about verification methodology
- Reasoning traces that belong in tool calls, not artifacts
