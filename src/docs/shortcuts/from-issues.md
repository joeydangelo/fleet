---
title: From Issues
description: Detect the repo's issue tracker, read open issues, and generate paw.yaml
category: orchestrator
---
Read open issues from whatever CLI issue tracker this repo uses and feed them into
`paw shortcut generate-paw-yaml` to produce a `.paw/paw.yaml`.

## Instructions

1. **Detect the issue tracker.** Look for signs of any CLI issue tracker in the
   repo:
   - Hidden config directories at the repo root (e.g., `.tbd/`, `.beads/`,
     or anything that looks like tracker state).
   - CLI tools on PATH that respond to `--help` with issue/task-related output.
   - `package.json` or other dependency files referencing tracker packages.

   If you find a tool you don't recognize, run its help command and read its
   output — you can figure out the list/show/close commands from there.

   If no tracker is detected, tell the user:
   > No CLI issue tracker detected in this repo. You can:
   > - Use `paw shortcut from-github-issue` to generate from a GitHub issue instead
   > - Write `.paw/paw.yaml` directly with `paw shortcut generate-paw-yaml`

2. **Read open issues.** Use whatever list/query command the detected tracker
   provides. Run its help if you're unsure of the syntax — most trackers have
   a `list`, `status`, or `ready` command that shows open items.

   If the user asked to filter by label, priority, or keyword, apply those
   filters.

3. **Select issues for this session.** Show the user the open issues and ask
   which ones to work on. If there are many, suggest a manageable subset (3-5
   issues that form a coherent unit of work).

4. **Decompose into tasks.** Run `paw guidelines paw-task-decomposition` for
   sizing guidance. Map issues to paw tasks:
   - One issue may become one task, or a large issue may split into multiple tasks.
   - Multiple small issues may combine into one task if they share focus areas.
   - Each task should have a clear, non-overlapping focus area.

5. **Generate paw.yaml.** Follow the `paw shortcut generate-paw-yaml` workflow,
   with these additions:
   - Set the `issue` field on each task to its source issue ID.
   - Include the issue title and key details in each task's `prompt`.
   - If the issue references a spec, set the `spec` field too.

   Example:
   ```yaml
   tasks:
     auth-bug:
       focus: [src/auth/]
       issue: GH#45
       prompt: |
         Fix: OAuth token refresh fails silently (GH#45).
         The refresh endpoint returns 401 but the error is swallowed...
   ```

6. **After merge, close issues.** This is the orchestrator's responsibility,
   not automatic. After verifying the merge worked (`paw merge` succeeded and
   tests pass), close each issue using the tracker's close command. Most
   trackers accept `close <id>` or similar — run the tool's help if unsure.
