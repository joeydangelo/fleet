---
title: Resolve Conflict
description: Read a conflict brief, resolve the merge conflict, and continue merging
category: orchestrator
---
A `paw merge` hit a conflict and generated a conflict brief. You're the resolver --
use the brief to understand what happened and fix it.

## Instructions

1. **Read the conflict brief.** Run `paw prime` to see the active conflict, or read
   the brief directly from the path shown in the `paw merge` output. The brief
   contains:
   - Which files conflict
   - Both agents' done summaries (what they intended)
   - Relevant journal entries (what they said during the session)
   - The conflict diff
   - A suggested resolution approach

2. **Understand the intent, not just the diff.** The raw conflict markers show *what*
   two lines differ. The summaries and journal entries show *why* they differ. The
   agent whose work is already in the target branch has the canonical changes --
   the conflicting agent's code usually needs to adapt.

3. **Resolve the conflicts.** Edit the conflicting files to reconcile both agents'
   work. Common patterns:
   - **Interface mismatch**: One agent changed a type, the other used the old one.
     Update the caller to match the new interface.
   - **Overlapping edits**: Both agents touched the same function. Merge the logic,
     keeping both contributions.
   - **Deleted vs modified**: One agent deleted a file the other modified. Decide
     which intent wins based on the summaries.

4. **Test the resolution.** Run the project's test suite to make sure the merged code
   actually works together. Don't just fix syntax -- verify behavior.

5. **Commit the resolution.** Follow `paw shortcut precommit-process` -- review,
   test, and commit the resolved files.

6. **Continue merging.** Run `paw merge --continue` to pick up the remaining tasks.
   If another conflict occurs, repeat from step 1.
