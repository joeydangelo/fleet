---
title: Fan Out In
description: Full orchestrator workflow -- decompose, dispatch agents, monitor, merge, clean up
category: orchestrator
---
You're the lead orchestrator running a paw session from the main repo. Your job is
to set up the session, merge results, and clean up. During the session, agents work
independently -- you can check in, but you're not actively managing them.

## Quick start: `paw go`

For most sessions, one command runs the entire lifecycle:

```bash
paw go                         # up → launch → watch → merge → down
paw go --poll-interval 10     # poll every 10 seconds (default 5)
```

`paw go` creates worktrees, launches agents, watches until all are done, merges
task branches into the target, and tears down. When `on-conflict` or
`on-hook-failure` hooks are configured, merge conflicts and validation failures
are resolved autonomously -- no human intervention needed.

Use the manual workflow below when you need to:
- Redirect agents mid-session with `paw ask`
- Cherry-pick which tasks to merge with `paw merge --pick`
- Make changes on the target branch between merge and cleanup

## Manual workflow

### Setup

1. **Write `.paw/paw.yaml`.** Use `paw shortcut generate-paw-yaml` to decompose work
   into parallel tasks with focus areas and prompts.

2. **Run `paw up`.** Creates worktrees, branches, and sync state. Verify the output
   shows all tasks created.

3. **Launch agents.** Run `paw launch` to open a terminal with the agent command
   in each worktree. Requires `agent: <command>` in `.paw/paw.yaml`. Each agent
   auto-orients via `paw prime` on startup (triggered by the SessionStart hook).

   Use `paw launch --dry-run` to preview commands or `paw launch --task <name>`
   to launch a single worktree.

### Monitoring

paw's communication is async and pull-based. You check in when you want, or
leave `paw watch` running for a continuous view.

- **`paw watch`** -- continuous terminal monitor. Streams broadcasts, status
  changes, and commit counts as they happen. Auto-exits when all agents are done.
  Use `--interval 10` to adjust polling frequency, `--no-exit` to keep running.
- **`paw status`** -- point-in-time snapshot of agent progress
- **`paw threads`** -- see open Q&A threads and broadcasts from agents
- **`paw ask <task> "..."`** -- send a message to redirect an agent

### Merge

1. **Verify completions.** `paw status` should show all tasks as "done" with
   summaries written.

2. **Run `paw merge`.** Merges each task branch into the target branch in
   topological order (respecting `depends_on`). Clean merges are automatic.
   - On conflict with `on-conflict` hook: paw invokes the hook to resolve
     autonomously and continues merging.
   - On conflict without hook: paw writes a conflict brief and stops. Run
     `paw shortcut resolve-conflict`, then `paw merge --continue`.
   - On hook failure with `on-hook-failure` hook: paw invokes the hook to
     fix and re-validates automatically.
   - On hook failure without hook: fix the issue and `paw merge --continue`,
     or roll back with the backup ref paw printed.

### Cleanup

1. **Run `paw down`.** Archives session data (journals, summaries, conflict briefs,
   config) to `.paw/sessions/`, then removes worktrees and sync branch. Resets
   `.paw/paw.yaml` to template. The target branch with all merged work remains.
   Use `--no-archive` to skip archival.

2. **Ask the user what to do next.** The merged work is on the target branch.
   Check if a remote is configured (`git remote -v`), then ask:

   - **Create a PR** — push the target branch and open a pull request against
     main. Gets reviewed before anything changes on main. Requires a remote.
     Use `paw shortcut to-pr`.
   - **Merge or rebase into main** — combine the target branch into main
     directly. Merge preserves branch history; rebase gives linear history.
     Push after if a remote exists.
   - **Keep working** — stay on the target branch. The user wants to review,
     test, or make more changes before sharing. Ask what they'd like to do
     next — use your context about the project and session to suggest
     relevant next steps.

   If the user doesn't specify, default to creating a PR.

## Delegate mode

paw's worktree architecture already separates the coordinator from implementers.
As the lead, you stay in the main repo. Each agent works in an isolated worktree
with their own branch. This means:

- You can review summaries and broadcasts without touching agent code
- Messages via `paw ask` don't create merge conflicts
- `paw merge` runs from the main repo where no agent is working

If you need to make changes yourself (e.g., a shared config file), do it on the
target branch before or after the merge -- not during agent work.
