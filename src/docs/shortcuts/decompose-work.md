---
name: decompose-work
description: Analyze a codebase and generate .paw/paw.yaml with well-decomposed parallel tasks
---
Generate `.paw/paw.yaml` to split the user's feature request into parallel agent tasks.

## Instructions

1. **Understand the work and find the seams.** Use whatever context is available —
   spec, user request, linked issues, codebase. Explore the directory structure,
   module boundaries, and existing patterns. Identify natural seams where work can
   be parallelized without agents stepping on each other. Only ask the user
   questions when there's genuine ambiguity you can't resolve yourself.

2. **Decompose into tasks.** Load `paw guidelines task-decomposition` for
   the full decomposition framework — file ownership, sizing, interface contracts,
   independence tests, and patterns. Each task needs a clear focus area and
   actionable instructions.

3. **Write `.paw/paw.yaml`:**

   ```yaml
   target: feature/branch-name
   # base: main                  # branch to create target from (default: main)
   agent: claude
   # spec: .paw/specs/spec-YYYY-MM-DD-feature-name.md  # path to planning spec

   # include:                     # gitignored files to copy into each worktree
   #   - .env
   #   - .env.local

   tasks:
     task-name:
       focus:
         - src/relevant/directory/
       depends_on: other-task      # optional: merge after this task
       issue: GH#123              # optional: source issue ID
       prompt: |
         What to build. Be specific.
         Mention interfaces shared with other tasks.
   ```

   Use `paw template paw-yaml` for the full config reference. Notes:
   - `base`: set when forking from a branch other than main
   - `include`: list gitignored files agents need (`.env`, credentials, local configs)
   - `spec`: set when a spec exists
   - `issue`: set when issues are available from the user or spec

4. **Validate.** Check against the decomposition guideline's independence test,
   then confirm:
    - [ ] `agent:` field is set
    - [ ] Each task can start immediately (no hidden sequencing)
    - [ ] Consumer tasks set `depends_on` to merge after their producers

## After writing

The human sees the yaml diff in the standard permission prompt and approves it
there — no separate review step needed.

Once approved, follow up:
> "I've written the plan to `.paw/paw.yaml`. Would you like me to run `paw go`
> to start the session?"

If the user says yes, run `paw go`. If they want changes, revise the yaml first.
If they say no, ask what they'd like instead.
