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

# Optional hooks.
# pre-done runs before `paw done` marks a task complete. If it fails, done is blocked.
# post-merge runs after each clean merge in `paw merge`. If it fails, paw stops
# and shows rollback guidance.
# hooks:
#   pre-done: npm test
#   post-merge: npm test

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
    issue: paw-za72                    # tbd/beads ID, GH#123, JIRA-456, etc.

    # Optional: link this task to a planning spec.
    # from-github-issue and generate-paw-yaml populate this when working from specs.
    spec: docs/project/specs/active/plan-2026-02-14-auth.md

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
    issue: GH#42
    prompt: |
      Build REST endpoints for user profiles.
      Import AuthConfig from src/auth/types.ts (owned by the auth task).
      If auth broadcasts interface changes, adapt accordingly.

  tests:
    focus:
      - tests/
    prompt: |
      Write integration tests for the auth and api tasks.
      Read their done summaries via `paw prime` to understand what to test.
      Wait for broadcasts about interface shapes before writing assertions.
```
