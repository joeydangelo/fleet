---
name: decompose-work
description: Analyze a codebase and generate .paw/paw.yaml with well-decomposed parallel tasks
roles: [orchestrator]
---
Generate `.paw/paw.yaml` to split the user's feature request into parallel agent tasks.

## Instructions

1. **Understand the work and find the seams.** Use whatever context is available —
   spec, user request, linked issues, codebase. Launch 2-3 Explore agents in
   parallel at `medium` thoroughness:
   - **Structure and seams** — module boundaries, directory layout, natural split
     points where work can be parallelized without overlap.
   - **Affected code** — files the work touches, dependencies, and shared
     interfaces between them.
   - **Patterns** — how similar work is structured, test conventions, existing
     abstractions to build on.

   Bias toward action — don't ask permission to explore or make straightforward
   decisions. Use `AskUserQuestion` for genuine ambiguity: scope surprises,
   conflicting requirements, or missing context only the user has.

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
   # setup: pnpm install         # shell command run per worktree during paw up

   # include:                     # gitignored files to copy into each worktree
   #   - .env
   #   - .env.local

   tasks:
     task-name:
       focus:
         - src/relevant/directory/
       depends_on: other-task      # optional: merge after this task
       issue: GH#123              # optional: source issue ID
       # spec: .paw/specs/spec-for-this-task.md  # optional: override top-level spec
       prompt: |
         What to build. Be specific.
         Mention interfaces shared with other tasks.
   ```

   Use `paw template paw-yaml` for the full config reference.

   Top-level fields:
   - `target`: the branch all task branches merge into
   - `base`: set when forking from a branch other than main
   - `agent`: which agent CLI to use (e.g. `claude`)
   - `setup`: run in each worktree during paw up (e.g. `pnpm install`, `uv sync`)
   - `spec`: path to the planning spec (shared across all tasks)
   - `include`: gitignored files agents need (`.env`, credentials, local configs)

   Per-task fields:
   - `focus`: files/directories this task owns — used for merge conflict detection
   - `prompt`: what to build — be specific, mention shared interfaces
   - `depends_on`: merge this task after its dependency (controls merge order)
   - `issue`: source issue ID when available
   - `spec`: per-task spec override — set when tasks come from different specs

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
