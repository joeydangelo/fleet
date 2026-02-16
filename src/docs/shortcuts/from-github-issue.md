---
title: Generate paw.yaml from GitHub Issue
description: Fetch a GitHub issue, decompose it into tasks, and generate paw.yaml
category: orchestrator
---
Fetch one or more GitHub issues and decompose them into parallel agent tasks
for `.paw/paw.yaml`.

## Prerequisites

Run `paw shortcut setup-github-cli` to ensure `gh` is installed and authenticated.

## Instructions

1. **Fetch the issue.** Use `gh issue view` to get the issue details:

   ```bash
   gh issue view <number> --json title,body,labels,number
   ```

   For multiple issues, fetch each one:
   ```bash
   gh issue view 42 --json title,body,labels,number
   gh issue view 43 --json title,body,labels,number
   ```

2. **Understand the issue.** Read the title, body, and labels. Look for:
   - A task breakdown already in the issue body (checkboxes, numbered lists)
   - Acceptance criteria or requirements
   - Labels that indicate scope or priority
   - References to specs or other issues

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
   succeeded, tests pass), close each GitHub issue:

   ```bash
   gh issue close <number> --comment "Fixed in <branch>"
   ```
