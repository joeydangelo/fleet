---
name: to-pr
description: Combine agent PR descriptions into a final PR with issue references
---
After `paw merge`, create a pull request whose description combines context
from the individual agent PRs.

## Prerequisites

Run `paw shortcut setup-github-cli` to ensure `gh` is installed and authenticated.

## Instructions

1. **Verify the merge is complete.** Run `paw status` and confirm all tasks are
   done and merged. If tasks are still in progress, wait for them to finish.

2. **Read agent PRs.** Each agent created a PR during the Publish phase. List
   them to gather context:

   ```bash
   gh pr list --state all --head <target-branch-prefix>
   ```

   Each agent PR has Summary, Changes, Testing, and References sections.

3. **Collect issue references.** Scan the paw.yaml `issue` fields and the agent
   PR descriptions for tracker IDs (e.g., `GH#42`). Any tracker ID format works.
   These go in the PR body so GitHub auto-links or closes them.

4. **Build the PR body.** Combine the agent PR context into a single description:

   ```markdown
   ## Summary

   ### task-name-1
   - What this agent built (from its PR description)

   ### task-name-2
   - What this agent built (from its PR description)

   ## Issues
   - Closes #42
   - References GH#45
   ```

   Keep it concise. Extract the key points from each agent PR rather than
   pasting them verbatim.

5. **Determine the base branch.** The PR targets the `base` branch from
   paw.yaml (usually `main`). The head branch is the `target` branch where
   task branches were merged.

6. **Check for an existing PR.** The target branch may already have a PR
   (e.g., from a previous session or manual creation):

   ```bash
   BRANCH=$(git rev-parse --abbrev-ref HEAD)
   gh pr view $BRANCH --json number,url 2>/dev/null
   ```

   If this returns JSON, a PR exists — update it instead of creating a new one.

7. **Create or update the PR:**

   If creating:
   ```bash
   gh pr create \
     --base main \
     --head feature/my-feature \
     --title "Brief description of the feature" \
     --body "$(cat <<'EOF'
   ## Summary
   ...combined from agent PRs...

   ## Issues
   - Closes #42
   EOF
   )"
   ```

   If updating:
   ```bash
   gh pr edit $BRANCH --title "Updated title" --body "...updated body..."
   ```

   Use `Closes #N` syntax for GitHub issues so they auto-close when the PR
   merges. For non-GitHub tracker IDs (tbd, beads, etc.), just reference them
   — the agent closes those manually after verifying the merge.

8. **Wait for CI.** Run:

   ```bash
   gh pr checks $BRANCH --watch 2>&1
   ```

   Wait for the final summary before reporting. If checks fail, fix the issue,
   push, and wait again.

9. **Report the PR URL and CI status.** Tell the user the PR URL and whether
   checks passed.
