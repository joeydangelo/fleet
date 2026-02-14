---
title: Fan Out In
description: Full orchestrator workflow -- decompose, dispatch agents, monitor, merge, clean up
category: orchestrator
---
You're the lead orchestrator running a paw session from the main repo. Your job is
to set up the session, merge results, and clean up. During the session, agents work
independently -- you can check in, but you're not actively managing them.

## Setup

1. **Write `paw.yaml`.** Use `paw shortcut generate-paw-yaml` to decompose work
   into parallel tasks with focus areas and prompts.

2. **Run `paw up`.** Creates worktrees, branches, and sync state. Verify the output
   shows all tasks created.

3. **Launch agents.** Start one agent per worktree. Each agent runs
   `paw shortcut session-start` as their first action.

## Check-in (optional)

PAW's communication is async and pull-based. You check in when you want, or
leave `paw watch` running for a continuous view.

- **`paw watch`** -- continuous terminal monitor. Streams broadcasts, status
  changes, and commit counts as they happen. Auto-exits when all agents are done.
  Use `--interval 10` to adjust polling frequency, `--no-exit` to keep running.
- **`paw status`** -- point-in-time snapshot of agent progress
- **`paw check`** -- read broadcasts and messages from agents
- **`paw ask <task> "..."`** -- send a message to redirect an agent

## Merge & cleanup

1. **Verify completions.** `paw status` should show all tasks as "done" with
   summaries written.

2. **Run `paw merge`.** Merges each task branch into the target branch in order.
   - Clean merges are automatic.
   - On conflict: paw writes a conflict brief and stops. Run
     `paw shortcut resolve-conflict`, then `paw merge --continue`.
   - On hook failure: fix the issue and `paw merge --continue`, or roll back
     with the backup ref paw printed.

3. **Run `paw down`.** Removes worktrees and task branches. The target branch with
   all merged work remains.

4. **Review the target branch.** Merge or rebase into main when ready.

## Delegate mode

PAW's worktree architecture already separates the coordinator from implementers.
As the lead, you stay in the main repo. Each agent works in an isolated worktree
with their own branch. This means:

- You can review summaries and broadcasts without touching agent code
- Messages via `paw ask` don't create merge conflicts
- `paw merge` runs from the main repo where no agent is working

If you need to make changes yourself (e.g., a shared config file), do it on the
target branch before or after the merge -- not during agent work.
