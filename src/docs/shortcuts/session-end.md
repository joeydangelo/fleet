---
title: Session End
description: Agent's final actions -- broadcast final state, write done summary
category: worktree agent
---
You're wrapping up your task in a paw worktree. Make sure other agents and the person
running the merge have full context about what you did.

## Instructions

1. **Commit any outstanding work.** If you have uncommitted changes, follow
   `paw shortcut precommit-process`. If your work is in a partial state and not ready
   to commit, that's fine -- skip this step, but note it in your summary.

2. **Broadcast your final state.** Let other agents know you're finishing and what
   the end result looks like:

   ```
   paw broadcast "Auth task done. OAuth2 flow working, AuthConfig type finalized at src/auth/types.ts"
   ```

3. **Write your done summary.** This is the most important step. The summary is what
   the merge process and resolver agents use to understand your work. Use
   `paw template task-summary` for the structure.

   ```
   paw done --summary "## What I did
   - Added OAuth2 login flow with Google and GitHub providers
   - Refactored AuthMiddleware to accept OAuthConfig

   ## Interface changes
   - AuthMiddleware now takes OAuthConfig instead of raw token string
   - New export: refreshToken() from src/auth/oauth.ts
   - Token type is now AccessToken | RefreshToken

   ## Watch out
   - Any code importing from src/auth/types.ts needs to handle OAuthConfig
   - Token refresh requires OAUTH_SECRET env var"
   ```

   If your work is incomplete, say so clearly -- what's done, what's not, and why.

## What Makes a Good Summary

The summary serves two audiences: **other agents** (who read it via `paw prime`) and
**the resolver** (who reads it during `paw merge` if there's a conflict).

- **Interface changes** are the highest-value section. If you changed types, exports,
  API shapes, or config formats that other tasks touch, spell it out.
- **Watch out** is for things that aren't obvious from the diff -- env vars, ordering
  dependencies, breaking changes to shared contracts.
- Skip boilerplate. Don't list every file you touched -- focus on what another agent
  needs to know to work with your changes.
