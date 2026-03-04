---
title: Resolve Merge Conflict
description: Read a conflict brief, resolve the merge conflict, and continue merging
category: orchestrator
---
A `paw go` or `paw merge` run exited with a conflict. You're the resolver — use
the conflict brief to understand what happened and fix it.

## Instructions

1. **Read the conflict brief.** The output prints the path when a conflict occurs:

   ```
   Conflict: api into target
   Brief written to: .paw-sync/conflicts/api-into-target.md
   Fix the conflict, commit, then run: paw merge --continue
   ```

   Read the brief at that path — no searching needed. It contains:
   - Which files conflict
   - Both agents' PR descriptions (what they intended)
   - Relevant inbox entries (what they said during the session)
   - The conflict diff
   - A suggested resolution approach

2. **Understand the intent, not just the diff.** The raw conflict markers show *what*
   two lines differ. The PR descriptions and inbox entries show *why* they differ.
   The agent whose work is already in the target branch has the canonical changes —
   the conflicting agent's code usually needs to adapt.

3. **Resolve the conflicts.** Edit the conflicting files to reconcile both agents'
   work. Common patterns:
   - **Interface mismatch**: One agent changed a type, the other used the old one.
     Update the caller to match the new interface.
   - **Overlapping edits**: Both agents touched the same function. Merge the logic,
     keeping both contributions.
   - **Deleted vs modified**: One agent deleted a file the other modified. Check
     the PR descriptions: if the deletion was intentional (replaced by a new
     module), keep the deletion and port the modifications to the new location.
     If the deletion was incidental cleanup, restore the file with the
     modifications.

4. **Test the resolution.** Run the project's test suite to make sure the merged code
   actually works together. Don't just fix syntax — verify behavior.

5. **Commit the resolution.** Use type `resolve` for the commit
   (see `paw guidelines commit-conventions`).

6. **Continue merging.** Run `paw merge --continue` to pick up the remaining tasks.
   If another conflict occurs, repeat from step 1.

No human needed — resolve and continue autonomously.
