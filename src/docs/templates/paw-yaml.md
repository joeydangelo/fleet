---
title: paw.yaml Template
description: Annotated config structure for paw.yaml
---
```yaml
# paw.yaml -- defines parallel agent tasks for a paw session
#
# Run `paw up` to create worktrees and branches from this file.
# Run `paw guidelines paw-task-decomposition` for guidance on splitting work.

# The branch all task branches merge into. paw creates this from base if needed.
target: feature/my-feature

# Base branch to create target from (default: main). Usually you leave this alone.
# base: main

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
