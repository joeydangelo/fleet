---
title: Session Start
description: Agent's first actions in a paw worktree -- orient, plan, broadcast intent
category: worktree agent
---
You're starting work in a paw worktree. Orient yourself, plan your approach, and let
the team know what you're about to do.

## Instructions

1. **Run `paw prime`.** This gives you everything in one shot:
   - Your task assignment (focus areas, instructions)
   - Team status (who's working, who's done, who's pending)
   - Recent broadcasts from other agents
   - Messages directed at you
   - Done summaries from finished agents

2. **Read your task file.** It's at `.paw/tasks/<your-task-name>.md`. Understand your
   focus areas and instructions. If a spec or issue is referenced, read that too.

3. **Adapt to what's already happened.** If other agents have completed work or
   broadcast interface changes, factor that into your approach. Don't plan against
   stale assumptions -- the summaries and broadcasts in `paw prime` tell you the
   current state of the world.

4. **Broadcast your intent.** Before writing code, announce your plan so other agents
   can adapt:

   ```
   paw broadcast "Starting auth task. Will define AuthConfig type at src/auth/types.ts"
   ```

   This is especially important when your work touches shared interfaces.

5. **Start working.** When you're ready to commit, follow
   `paw shortcut precommit-process` -- it covers review, testing, broadcasting
   interface changes, and commit message conventions.

6. **Check in periodically.** Run `paw threads` to see if you have open questions
   to answer.

## When to Broadcast Problems

If you're stuck, hitting repeated errors, or blocked on something outside your
focus area, broadcast it. The orchestrator and other agents can only help if
they know. Don't suffer in silence — a quick broadcast lets the team adapt.

```
paw broadcast "Blocked: can't find the AuthConfig type. Was it moved? Need help from auth task."
paw broadcast "Hitting ENOENT on src/lib/config.ts — is the include task modifying it?"
```

## What Makes a Good Broadcast

Broadcasts are how agents coordinate without blocking each other. Good broadcasts are
**actionable** -- they tell other agents something they might need to change their work.

| Good | Bad |
|---|---|
| "Changed UserProfile.email to be optional" | "Working on user profiles" |
| "Added /api/auth/refresh endpoint, returns new AccessToken" | "Made some API changes" |
| "Deleted src/legacy/auth.ts -- use src/auth/oauth.ts instead" | "Cleaned up some files" |
