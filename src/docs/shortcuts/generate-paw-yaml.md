---
title: Generate paw.yaml
description: Analyze a codebase and generate .paw/paw.yaml with well-decomposed parallel tasks
category: orchestrator
---
Generate `.paw/paw.yaml` to split the user's feature request into parallel agent tasks.

## Instructions

1. **Gather context.** If you already have a spec, feature plan, or clear build
   description, use that directly. Otherwise, ask the user what they want to build.
   Ask good questions — clarify scope, priorities, and constraints until you have
   enough detail to identify the major pieces of work. Also ask which agent CLI
   to use (claude, codex, opencode, gemini, or a custom command). This becomes
   the `agent:` field in paw.yaml — it's the command `paw launch` runs in each
   worktree terminal.

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

6. **Detect project toolchain and configure hooks.** Look at the project's
   language, package manager, and test runner. Set hooks so agents and the merge
   process run the right commands automatically:
   - `post-up`: runs in each worktree after creation during `paw up`. Use for
     dependency installation, codegen, or any setup needed before agents start.
     Git worktrees don't inherit `node_modules`, virtual environments, or build
     artifacts — this hook makes worktrees ready to work.
   - `pre-done`: runs before `paw done` marks a task complete. Quality gate that
     prevents agents from declaring done when tests fail.
   - `post-merge`: runs after each clean merge in `paw merge`. Catches integration
     failures when two task branches combine.
   - `on-conflict`: runs when `paw merge` hits a git conflict. Receives env vars
     (`PAW_CONFLICT_TASK`, `PAW_CONFLICT_BRIEF`, `PAW_TARGET`). Must resolve
     conflict markers, `git add`, and `git commit`.
   - `on-hook-failure`: runs when `post-merge` fails. Receives env vars
     (`PAW_FAILED_TASK`, `PAW_HOOK_COMMAND`, `PAW_BACKUP_REF`, `PAW_TARGET`).
     Must fix the code and commit. Post-merge is re-run to verify.

   Hooks run via bash. Use YAML block scalar (`|`) for multi-line scripts
   inline, or call an external script. Environment variables are passed to
   the process via `process.env` — agent CLIs can read them directly.

   Detect the right commands from the project (e.g., `package.json` scripts,
   `Makefile` targets, `pyproject.toml` config, `Cargo.toml`, `go.mod`).

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
   agent: claude                  # or codex, opencode, gemini, etc.

   # include:                     # gitignored files to copy into each worktree
   #   - .env
   #   - .env.local

   # Hooks run via bash. Use | for multi-line inline scripts.
   hooks:
     post-up: pnpm install                                     # or: uv sync, cargo build
     pre-done: pnpm test                                       # or: uv run pytest, go test ./...
     post-merge: pnpm test                                     # or: uv run pytest, cargo test
     # on-conflict: claude --print "resolve the merge conflict" # any agent CLI
     # on-hook-failure: claude --print "fix the failing tests"  # any agent CLI

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
