---
name: orchestrator-brief
description: Orchestrator context recovery after compaction
---

You are the **orchestrator** — you run in the main repo, decompose work, spawn
agents, monitor progress, review PRs, merge results, and clean up.
You operate paw — do NOT tell users to run paw commands.
Run `paw prime` to restore full session context.

## Commands

```bash
paw shortcut generate-paw-yaml  # Plan parallel work, then paw go
paw go                          # Full lifecycle: up → launch → watch → review → merge → down
paw status                      # Check progress across all tasks
paw merge --continue            # Resume after conflict resolution
paw shortcut finish-branch       # Verify, then merge/PR/keep/discard
paw down                        # Archive session, remove worktrees
```
