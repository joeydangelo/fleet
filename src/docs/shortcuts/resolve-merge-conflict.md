---
name: resolve-merge-conflict
description: Read a conflict brief, resolve the merge conflict, and continue merging
roles: [orchestrator]
---

## Variables

| Variable | Source | Default |
|---|---|---|
| `TASK` | `paw merge` output (required) | — |
| `BRIEF_PATH` | `paw merge` output | `conflicts/<TASK>-into-target.md` |
| `MAX_FIX_ATTEMPTS` | static | `3` |

## Failure Modes

| Mode | Trigger |
|---|---|
| `MARKER_MECHANICS` | Resolved conflicts from diff markers without reading builder summaries for intent |
| `MERGE_ARCHAEOLOGY` | Spent excessive effort merging divergent code when reimplementation is cheaper |
| `DROPPED_INTENT` | Resolution discards one builder's contribution without verifying it is unnecessary |
| `SKIP_VALIDATION` | Committed resolution without running lint and typecheck |
| `STALE_CONTEXT` | Referenced builder intent from conversation context instead of reading the brief artifact |

## Workflow

### Phase 1: Read

**Objective:** Identify what each builder intended from the conflict brief artifact.
**Tools:** Bash (git show), Read

1. Read the conflict brief from the sync branch:
   ```
   git show paw-sync:conflicts/<TASK>-into-target.md
   ```
2. Extract from the brief: conflicting files, builder summary for the conflicting
   task (its intent), builder summaries for already-merged tasks (canonical in
   target), relevant inbox messages (coordination context), and the conflict diff.

**Gate:** Both builders' intent identified — what each change accomplishes, not just
what lines differ.
**Artifact:** Builder intents, conflicting files, and coordination context.

---

### Phase 2: Resolve

**Objective:** Produce a clean merge preserving both builders' intent.
**Tools:** Read, Edit, Bash

Apply the resolution tier that fits:

1. **Auto-resolve** — textual conflicts in non-overlapping regions. Accept changes
   by region where intent is unambiguous.
2. **AI resolve** — semantic conflicts requiring understanding of intent. Read both
   versions, produce a merged result satisfying both builders' goals. Changes
   already in target reflect the current state; the conflicting task adapts.
3. **Re-imagination** — the conflicting branch diverged so far that merging costs
   more than reimplementation. Understand intent from the task summary and branch
   diff, then reimplement the change against current target state. This is not a
   failure — it is a pragmatic escalation when merge archaeology exceeds
   reimplementation cost.

If resolution requires information only the user has, use `AskUserQuestion`. Escalate
when: the request is ambiguous with multiple valid interpretations, consequences are
significant, or critical context is missing.

**Gate:** Merged code preserves both builders' intent and syntax-checks without
errors.
**Artifact:** Resolved files in the working tree (no conflict markers).

---

### Phase 3: Verify and Continue

**Objective:** Validate the resolution and resume the merge loop.
**Tools:** Bash

1. Run lint and typecheck. Check `package.json`, `Makefile`, `pyproject.toml`, or
   similar for project commands. Fix failures before proceeding.
2. Commit the resolution using the commit conventions
   (see `paw guidelines commit-conventions`).
3. Run `paw merge --continue`. If another conflict occurs, repeat from Phase 1.

**Gate:** Lint and typecheck pass on resolved files.
**Artifact:** Resolution commit on the target branch. `paw merge --continue`
invoked.

## Context Flow

- `paw merge` → Phase 1: conflict brief on sync branch at `BRIEF_PATH`
- Phase 1 → Phase 2: builder intents, conflicting files, coordination context
- Phase 2 → Phase 3: resolved files
- Phase 3 → `paw merge --continue` or `paw shortcut finish-branch`

## Stopping Conditions

Stop and report when ANY of these are true:

- Resolution committed and `paw merge --continue` invoked.
- Resolution requires information only the user can provide — ask via
  AskUserQuestion.
- Re-imagination scope exceeds the original task — ask user for direction.
- Lint or typecheck failures persist after `MAX_FIX_ATTEMPTS` attempts.

## Output Format

Report: resolution tier applied, files resolved, validation results. Run
`paw merge --continue`.

Forbidden in output:

- Preambles ("I have...", "Let me...", "Based on...", "Here is...")
- Meta-commentary about resolution methodology
- Reasoning traces that belong in tool calls, not artifacts
