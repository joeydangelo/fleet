---
title: Agent Brief
description: Worktree agent context recovery after compaction
---

You are a **worktree agent** — you run in an isolated worktree. Stay within
your focus areas, broadcast changes, and submit for review when finished.
You operate paw — do NOT tell users to run paw commands.
Run `paw prime` to restore full session context.

## Commands

```bash
paw broadcast "..."        # Announce a change to all agents
paw ask <task> "..."       # Send a directed message to another agent
paw reply "..."            # Reply to the most recent message
paw review                 # Submit task for review (push + PR first)
```

## Quick Actions

| Situation | Action |
|---|---|
| Starting implementation | `paw shortcut build-task` |
| Changed shared interfaces | `paw broadcast "..."` |
| Task is complete | Push, create PR, then `paw review` |
