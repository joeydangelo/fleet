---
title: paw.yaml Template
description: Annotated config structure for .paw/paw.yaml
---
```yaml
# .paw/paw.yaml -- defines parallel agent tasks for a paw session
#
# Run `paw up` to create worktrees and branches from this file.
# Run `paw guidelines paw-task-decomposition` for guidance on splitting work.

# The branch all task branches merge into. paw creates this from base if needed.
target: feature/my-feature

# Base branch to create target from (default: main). Usually you leave this alone.
# base: main

# The command to run in each worktree terminal. Required for `paw launch`.
# Can be any CLI command: claude, codex, "claude --print", etc.
agent: claude

# Files to copy from the main repo into each worktree during `paw up`.
# Useful for gitignored files like .env, local configs, and credentials that
# git worktree add doesn't bring along. Supports glob patterns.
# Skips files that already exist in the worktree.
# include:
#   - .env
#   - .env.local
#   - "config/local.json"

# Hooks. Detect the project's toolchain and set the right commands.
# Hooks run via bash. Use YAML block scalar (|) for multi-line scripts inline,
# or call an external script.
#
# post-up: runs in each worktree after creation. Install deps, run codegen, etc.
# pre-done: runs before `paw done`. Quality gate — blocks done if it fails.
# post-merge: runs after each clean merge. Catches integration failures.
# on-conflict: runs when merge hits a git conflict. Must resolve markers,
#   git add, and git commit. Env vars: PAW_CONFLICT_TASK, PAW_CONFLICT_BRIEF,
#   PAW_TARGET.
# on-hook-failure: runs when post-merge fails. Must fix the code and commit.
#   Env vars: PAW_FAILED_TASK, PAW_HOOK_COMMAND, PAW_BACKUP_REF, PAW_TARGET.
#   Post-merge is re-run to verify.
# hooks:
#   post-up: pnpm install
#   pre-done: pnpm test
#   post-merge: pnpm test
#   on-conflict: claude --print "resolve the merge conflict"
#   on-hook-failure: claude --print "fix the failing tests"

tasks:
  # Each key is the task name. It becomes the branch name suffix, worktree directory
  # name, and the agent's identity for broadcasts and summaries.
  #
  # Branch:    {target}-{taskName}     (e.g., feature/my-feature-auth)
  # Worktree:  {repoName}-paw-{taskName}  (e.g., myapp-paw-auth)

  auth:
    # Focus areas -- directories and files this agent owns. Helps the agent
    # stay in scope and helps you verify tasks don't overlap.
    focus:
      - src/auth/
      - src/middleware/auth.ts

    # Optional: link this task to its source issue (any tracker ID format).
    # Bridge shortcuts like from-issues and from-github-issue populate this.
    # to-pr uses it to reference issues in the PR body.
    issue: GH#123                      # any tracker ID format works

    # Optional: link this task to a planning spec.
    # from-github-issue and generate-paw-yaml populate this when working from specs.
    # When set, the spec path appears in the agent's task file header so the agent
    # knows where to find it.
    spec: <path>

    # Optional: declare merge-order dependencies. When this task depends_on
    # another, `paw merge` processes the dependency first so shared interfaces
    # exist on the target branch before dependent code merges in.
    # Accepts a single task name or a list. All names must exist in tasks.
    # depends_on: other-task
    # depends_on:
    #   - task-a
    #   - task-b

    # Instructions for the agent. Be specific: what to build, what interfaces
    # are shared, what to broadcast. Optional but strongly recommended.
    prompt: |
      Add OAuth2 login flow with Google and GitHub providers.
      Define AuthConfig type at src/auth/types.ts -- the api task depends on this.
      Broadcast any changes to AuthConfig or the middleware signature.

  api:
    focus:
      - src/api/
      - src/routes/
    depends_on: auth                   # merged after auth
    issue: GH#42
    prompt: |
      Build REST endpoints for user profiles.
      Import AuthConfig from src/auth/types.ts (owned by the auth task).
      If auth broadcasts interface changes, adapt accordingly.

  tests:
    focus:
      - tests/
    depends_on:                        # merged after both auth and api
      - auth
      - api
    prompt: |
      Write integration tests for the auth and api tasks.
      Read their done summaries via `paw prime` to understand what to test.
      Wait for broadcasts about interface shapes before writing assertions.
```
