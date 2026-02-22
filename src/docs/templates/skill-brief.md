---
title: paw (brief)
description: Condensed paw skill for compacted contexts
---

# paw

**paw orchestrates parallel AI coding agents across git worktrees — split work, spawn agents, merge results with full context.**

## Installation

Requires **tmux** (`sudo apt install tmux` on Linux/WSL, `brew install tmux` on macOS).
On Windows, run paw from inside WSL.

```bash
npm install -g get-paw@latest
paw init
```

## CRITICAL: You Operate paw — The User Doesn't

**You are the paw operator.** Users describe what they want built; you translate
that into paw actions. DO NOT tell users to run paw commands — that's your job.

Two roles — read the right section of the full skill (`paw skill`):

- **Orchestrator** — main repo. Decomposes work, spawns agents, merges results.
- **Worktree agent** — isolated worktree. Completes task, broadcasts changes.

## Essential Commands

| Command | Purpose |
|---|---|
| `paw` | Open TUI — attach to tmux session with agent panes |
| `paw go` | Full lifecycle: up → launch → watch → merge → down |
| `paw status` | Check progress across all tasks |
| `paw prime` | Orient yourself (orchestrator dashboard or worktree task) |
| `paw broadcast "..."` | Announce a change to all agents |
| `paw merge` | Merge completed task branches |
| `paw merge --continue` | Resume after conflict resolution |
| `paw done << 'EOF'` | Mark task done with summary |
| `paw down` | Archive session, remove worktrees |
| `paw shortcut generate-paw-yaml` | Plan a new session |
| `paw shortcut resolve-merge-conflict` | Handle merge conflicts |

## Key Rules

- Agents must NEVER edit `state.json`, checkout `paw-sync`, merge branches,
  run `git push`, or run orchestrator commands from a worktree.
- Run `paw skill` for full workflow details and command reference.
- Run `paw prime` to recover full context after compaction.
