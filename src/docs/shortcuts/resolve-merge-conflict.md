---
name: resolve-merge-conflict
description: Read a conflict brief, resolve the merge conflict, and continue merging
roles: [orchestrator]
---
A `paw merge` run hit a conflict. The brief has the context you need to fix it.

## Instructions

1. **Read the conflict brief.** The `paw merge` output printed the exact path:

   ```
   ! <task> -- conflicts
       Brief written to conflicts/<task>-into-target.md on sync branch
   ```

   Use the task name from that output to read the brief:

   ```
   git show paw-sync:conflicts/<task>-into-target.md
   ```

   It contains:
   - Which files conflict
   - Builder summaries for the conflicting task and already-merged tasks
   - Inbox messages between the relevant agents
   - The conflict diff with markers

2. **Understand the intent, not just the diff.** The conflict markers show *what*
   differs. The builder summaries and inbox messages show *why*. The agent whose
   work is already in the target branch has the canonical changes — the
   conflicting agent's code usually needs to adapt.

3. **Resolve the conflicts.** Common patterns:
   - **Interface mismatch**: one agent changed a type, the other used the old
     shape. Update the caller to match the new interface.
   - **Overlapping edits**: both agents touched the same function. Merge the
     logic, keeping both contributions.
   - **Deleted vs modified**: one agent deleted a file the other modified. Check
     the summaries — if the deletion was intentional (replaced by a new module),
     keep it and port the modifications. If incidental cleanup, restore the file
     with the modifications.

4. **Verify the resolution.** Run format, lint, typecheck, and test. Check
   `package.json`, `Makefile`, `pyproject.toml`, or similar for the project's
   specific commands. Fix any failures before proceeding.

5. **Commit the resolution.** Use commit type `resolve`
   (see `paw guidelines commit-conventions`).

6. **Continue merging.** Run `paw merge --continue` to pick up the remaining
   tasks. If another conflict occurs, repeat from step 1.
