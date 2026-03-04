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
paw shortcut build-task    # Full Build → Verify → Publish workflow
paw broadcast "..."        # Announce a change to all agents
paw send <task> "..."      # Send a directed message to another agent
paw reply "..."            # Reply to the most recent message
paw review                 # Submit task for review (commit + summary first)
```
