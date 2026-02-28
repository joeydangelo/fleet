---
title: Generate paw.yaml
description: Analyze a codebase and generate .paw/paw.yaml with well-decomposed parallel tasks
category: orchestrator
---
Generate `.paw/paw.yaml` to split the user's feature request into parallel agent tasks.

## Before you write

Ask these questions first — before analyzing the codebase or writing the yaml.

### What to ask (only if not in the request)

Ask only what you can't infer from context:

**1. Spec or issue link** (if not provided)
> Is there a spec file or issue IDs to link to these tasks?
> If yes, what's the path or ID? Goes into the `spec:` and `issue:` fields.

Skip if: already in the user's message.

Use the `AskUserQuestion` tool to ask.

### What to infer (never ask)

From the request, codebase, and `paw guidelines paw-task-decomposition`:

- Task names and focus areas — derived from module/layer boundaries
- `depends_on` — from interface ownership patterns
- Target branch — use `paw-<feature-name>` convention
- Number of tasks — 2–5; LLM decides
- Task prompts — from the request and codebase analysis
- Hooks — detected from the toolchain (package.json, pyproject.toml, etc.)

## Instructions

1. **Gather context.** If you already have a spec, feature plan, or clear build
   description, use it directly. Otherwise, ask what the user wants to build —
   enough to identify the major pieces of work. Ask only the questions listed
   above; don't ask what you can infer.

2. **Analyze the codebase.** Look at the directory structure, module boundaries, and
   existing patterns. Identify natural seams where work can be parallelized without
   agents stepping on each other.

3. **Decompose into tasks.** Run `paw guidelines paw-task-decomposition` for
   the full decomposition framework. Each task should:
   - Have a clear, independent focus area (files/directories the agent owns)
   - Minimize overlap with other tasks' focus areas
   - Be roughly similar in size
   - Have explicit instructions the agent can act on without further clarification

   Use `paw template paw-yaml` for the config structure reference.

4. **Check for interface boundaries.** Where tasks share interfaces (types, APIs,
   function signatures), call this out explicitly in each task's instructions:
   - Which task owns the interface definition
   - What other tasks should expect from it
   - Tell the owning agent to `paw broadcast` when it changes the interface
   - Set `depends_on` on consumer tasks so they merge after the producer.
     This ensures shared types and interfaces exist on the target branch
     before dependent code merges in, reducing avoidable merge conflicts.

5. **Link tasks to sources.** If tasks originate from issues or specs, set the
   optional `issue` and `spec` fields on each task:
   - `issue`: the tracker ID (e.g., `GH#123`). Any tracker ID format works. Set this
     when generating from `paw shortcut from-issues` or `from-github-issue`.
   - `spec`: path to the planning spec (e.g.,
     `docs/project/specs/active/plan-auth.md`). Set this when generating from a
     spec or feature plan.

   These fields are optional. When present, `paw shortcut to-pr` uses them to
   reference issues in the PR body.

6. **Configure hooks.** Check `.paw/hooks/` for existing scripts. For any
   missing hooks, run `paw shortcut generate-hook-script` for each event
   (`post-up`, `post-merge`).

7. **Check for gitignored files that need copying.** Git worktrees only contain
   tracked files. If the project has gitignored files that agents need (`.env`,
   `.env.local`, local configs, credentials), list them under `include:`. Supports
   glob patterns. Files that already exist in the worktree are skipped.

8. **Set `base` if needed.** The `base` field controls which branch `target` is
   created from (defaults to `main`). Set it explicitly when the work should fork
   from a branch other than main (e.g., a release branch or existing feature branch).

9. **Write `.paw/paw.yaml`:**

   ```yaml
   target: feature/branch-name
   # base: main                  # branch to create target from (default: main)
   agent: claude

   # include:                     # gitignored files to copy into each worktree
   #   - .env
   #   - .env.local

   # Hooks — write scripts to .paw/hooks/, reference paths here.
   # Inline commands also work for simple one-liners.
   hooks:
     post-up: .paw/hooks/post-up.sh
     post-merge: .paw/hooks/post-merge.sh

   tasks:
     task-name:
       focus:
         - src/relevant/directory/
       depends_on: other-task      # optional: merge after this task
       issue: GH#123              # optional: source issue ID
       spec: docs/specs/plan.md   # optional: source spec path
       prompt: |
         What to build. Be specific.
         Mention interfaces shared with other tasks.
   ```

10. **Validate the decomposition:**
    - [ ] `agent:` field is set
    - [ ] No two tasks share the same focus files (minimal overlap)
    - [ ] Each task can start immediately (no hidden sequencing)
    - [ ] Instructions mention shared interfaces and who owns them
    - [ ] Consumer tasks set `depends_on` to merge after their producers
    - [ ] 2-5 tasks (fewer is better; more agents != faster)
    - [ ] A `tests` task exists if the feature needs cross-cutting test coverage
    - [ ] Hooks are set for the project's toolchain
    - [ ] Gitignored files agents need are listed under `include`

## Common Patterns

| Pattern | When to Use |
|---|---|
| Feature + tests | One task builds the feature, another writes tests for it |
| Frontend + backend | Separate UI work from API/data work |
| Module-per-task | Each task owns a distinct module or package |
| Core + consumers | One task builds the shared layer, others build on top |

## Anti-Patterns

- **Too many tasks.** 6+ agents means coordination overhead exceeds parallelism gains.
- **Sequential dependencies.** If task B can't start until task A finishes, they
  shouldn't be parallel. Combine them or make B a second session.
- **Overlapping focus areas.** Two agents editing the same files guarantees merge
  conflicts.
- **Vague instructions.** "Build the API" isn't actionable. "Build REST endpoints for
  user profiles at src/api/users.ts, returning UserProfile from src/types.ts" is.

## After writing

The human sees the yaml diff in the standard permission prompt and approves it
there — no separate review step needed.

Once approved, follow up:
> "I've written the plan to `.paw/paw.yaml`. Would you like me to run `paw go`
> to start the session?"

If the user says yes, run `paw go`. If they want changes, revise the yaml first.
If they say no, ask what they'd like instead.
