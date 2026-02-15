---
title: Create PR from Merged Results
description: Combine agent done summaries into a PR with issue references
category: orchestrator
---
After `paw merge`, create a pull request whose description combines the done
summaries from all completed tasks.

## Prerequisites

Run `paw shortcut setup-github-cli` to ensure `gh` is installed and authenticated.

## Instructions

1. **Verify the merge is complete.** Run `paw status` and confirm all tasks are
   done and merged. If tasks are still in progress, wait for them to finish.

2. **Read done summaries.** Run `paw status` to see completed task summaries.
   Each agent wrote a structured summary with "What I did", "Interface changes",
   and "Watch out" sections.

3. **Collect issue references.** Scan the paw.yaml `issue` fields and the done
   summaries for tracker IDs (e.g., `GH#42`, `paw-za72`). These go in the PR
   body so GitHub auto-links or closes them.

4. **Build the PR body.** Combine the summaries into a single PR description:

   ```markdown
   ## Summary

   ### task-name-1
   - What this agent built (from its done summary)

   ### task-name-2
   - What this agent built (from its done summary)

   ## Issues
   - Closes #42
   - References paw-za72

   ## Watch Out
   - Any cross-cutting concerns from the agent summaries
   ```

   Keep it concise. Extract the key points from each summary rather than
   pasting them verbatim.

5. **Determine the base branch.** The PR targets the `base` branch from
   paw.yaml (usually `main`). The head branch is the `target` branch where
   task branches were merged.

6. **Create the PR:**

   ```bash
   gh pr create \
     --base main \
     --head feature/my-feature \
     --title "Brief description of the feature" \
     --body "$(cat <<'EOF'
   ## Summary
   ...combined summaries...

   ## Issues
   - Closes #42
   EOF
   )"
   ```

   Use `Closes #N` syntax for GitHub issues so they auto-close when the PR
   merges. For non-GitHub tracker IDs (tbd, beads, etc.), just reference them
   -- the agent closes those manually after verifying the merge.

7. **Report the PR URL.** Tell the user the PR URL so they can review it.
