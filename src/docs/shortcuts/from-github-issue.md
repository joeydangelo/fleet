---
name: from-github-issue
description: Fetch GitHub issues, decompose them into tasks, and generate paw.yaml
---
Fetch GitHub issues — by number, or by listing what's open — and decompose them
into parallel agent tasks for `.paw/paw.yaml`.

## Prerequisites

1. **GitHub CLI.** Run `paw shortcut setup-github-cli` to ensure `gh` is installed
   and authenticated.

2. **GitHub remote.** Verify this repo has a GitHub remote:

   ```bash
   gh repo view --json name 2>/dev/null
   ```

   If this fails, the repo has no GitHub remote. Tell the user and suggest
   `paw shortcut from-issues` (for local trackers) or
   `paw shortcut generate-paw-yaml` (to write paw.yaml directly).

## Instructions

1. **Get the issues.** Two paths depending on what the user gave you:

   **If the user specified issue numbers or links:**

   ```bash
   gh issue view <number> --json title,body,labels,number
   ```

   For multiple issues, fetch each one:
   ```bash
   gh issue view 42 --json title,body,labels,number
   gh issue view 43 --json title,body,labels,number
   ```

   **If the user wants to browse open issues:**

   ```bash
   gh issue list --state open --limit 20 --json number,title,labels
   ```

   Filter by label or assignee if the user asked:
   ```bash
   gh issue list --state open --label bug --limit 20 --json number,title,labels
   gh issue list --state open --assignee @me --limit 20 --json number,title,labels
   ```

   Show the user the list and ask which issues to work on. Group related or
   duplicate issues together — if two issues describe the same problem, they
   can share a task and both get closed after merge. If there are many, suggest
   a manageable subset (3–5 that form a coherent unit of work). Then fetch
   full details for the selected issues with `gh issue view`.

2. **Understand the issues.** Read the title, body, and labels. Look for:
   - A task breakdown already in the issue body (checkboxes, numbered lists)
   - Acceptance criteria or requirements
   - Labels that indicate scope or priority
   - References to related or duplicate issues — these can be solved together
     and closed in one session

3. **Decompose into tasks.** Run `paw guidelines paw-task-decomposition` for
   sizing guidance. Then decide how to map issues to tasks:
   - A well-scoped issue may map directly to one task.
   - A large issue should be split into multiple tasks with non-overlapping
     focus areas.
   - Multiple small, related issues can combine into one task if they share
     focus areas.

4. **Analyze the codebase.** Look at the directory structure and module
   boundaries to identify focus areas for each task. Make sure tasks don't
   overlap on the same files.

5. **Generate paw.yaml.** Follow the `paw shortcut generate-paw-yaml` workflow,
   with these additions:
   - Set the `issue` field on each task (e.g., `GH#42`).
   - If a spec exists for the issue, set the `spec` field.
   - Include the issue title and key details from the body in the task `prompt`.
   - Reference the issue number so agents can look it up with `gh issue view`.

   Example:
   ```yaml
   tasks:
     user-profiles:
       focus: [src/api/users/, src/types/user.ts]
       issue: GH#42
       prompt: |
         Implement user profile endpoints (GH#42: "Add user profiles").
         See gh issue view 42 for full requirements.
         ...
   ```

6. **After merge, close issues.** After verifying the merge worked (`paw merge`
   succeeded, tests pass), close each GitHub issue — including duplicates that
   were grouped with a resolved issue:

   ```bash
   gh issue close 42 --comment "Fixed in <branch>"
   gh issue close 43 --comment "Duplicate of #42, fixed in <branch>"
   ```
