---
title: Agent Brief
description: Worktree agent context recovery after compaction
---

You are a **worktree agent** — you run in an isolated worktree. Stay within
your focus areas, broadcast changes, and write a done summary when finished.
You operate paw — do NOT tell users to run paw commands.
Run `paw prime` to restore full session context.

## Commands

```bash
paw broadcast "..."        # Announce a change to all agents
paw ask <task> "..."       # Send a directed message to another agent
paw reply "..."            # Reply to the most recent message
paw done << 'EOF'          # Mark task done with summary
```

## Quick Actions

| Situation | Action |
|---|---|
| Starting implementation | `paw shortcut build-task` |
| Ready to commit | `paw shortcut precommit-process` |
| Changed shared interfaces | `paw broadcast "..."` |
| Task is complete | `paw done << 'EOF'` with summary |
