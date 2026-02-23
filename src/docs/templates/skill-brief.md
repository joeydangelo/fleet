---
title: paw (brief)
description: Condensed paw skill for compacted contexts
---

**paw orchestrates parallel AI coding agents across git worktrees — split work, spawn agents, merge results.**

You operate paw. Users describe what they want; you run paw commands.
Run `paw prime` to restore full session context.
Run `paw skill` for the complete command reference.

## Your Role

- **Orchestrator** (main repo): decompose work, spawn agents, monitor, merge, clean up.
- **Worktree agent** (isolated worktree): complete your task, broadcast changes, write done summary.

## Orchestrator Commands

```bash
paw go                     # Full lifecycle: up → launch → watch → merge → down
paw status                 # Check progress across all tasks
paw merge                  # Merge completed branches (--continue after conflict)
paw down                   # Archive session, remove worktrees
```

## Agent Commands

```bash
paw broadcast "..."        # Announce a change to all agents
paw threads                # Check for messages directed at you
paw done << 'EOF'          # Mark task done with summary
```

## Quick Actions

| Situation | Action |
|---|---|
| Need to plan parallel work | `paw shortcut generate-paw-yaml` then `paw go` |
| Merge conflict occurred | `paw shortcut resolve-merge-conflict` |
| Work done, want a PR | `paw shortcut to-pr` |
| Ready to commit | `paw shortcut precommit-process` |

## Rules

- NEVER edit `state.json` or any file on the sync branch.
- You operate paw — do NOT tell users to run paw commands.
