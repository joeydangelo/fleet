---
name: paw-yaml
description: Annotated config structure for .paw/paw.yaml
roles: [orchestrator]
---
```yaml
# .paw/paw.yaml — defines parallel agent tasks for a paw session

target: feature/my-feature
# base: main                              # default: main
agent: claude
# spec: .paw/specs/spec-2026-03-04-my-feature.md
# setup: pnpm install                     # shell command run per worktree during paw up

# include:                                # gitignored files to copy into each worktree
#   - .env
#   - .env.local
#   - "config/local.json"

tasks:
  # Each key is the task name → branch suffix and worktree directory.
  #   Branch:    {target}-{taskName}
  #   Worktree:  {repoName}-paw-{taskName}

  auth:
    focus:
      - src/auth/
      - src/middleware/auth.ts

    issue: GH#123
    # depends_on: other-task              # merge after this task
    # depends_on:                         # or a list
    #   - task-a
    #   - task-b
    prompt: |
      Add OAuth2 login with Google and GitHub providers.
      Define an AuthConfig type with provider, clientId, and callbackUrl
      fields — the api task imports this type. Support login, logout,
      and token refresh flows. Return 401 with a JSON error body on
      expired tokens.

  api:
    focus:
      - src/api/
      - src/routes/
    depends_on: auth
    issue: GH#42
    prompt: |
      Build REST endpoints for user profiles. Endpoints: GET, PATCH,
      and DELETE on /users/:id. Require authentication on all endpoints.
      Import the AuthConfig type from the auth task. Return 404 for
      missing users.

  dashboard:
    focus:
      - src/dashboard/
      - src/components/
    prompt: |
      Build the user dashboard page showing profile data from the API.
      Fetch from GET /users/:id. Show name, email, and provider. Handle
      loading and error states. Follow existing component patterns.
```
