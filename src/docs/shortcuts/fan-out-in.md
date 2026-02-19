---
title: Fan Out In
description: Full orchestrator workflow — decompose, dispatch agents, monitor, merge, clean up
category: orchestrator
---
You're the lead orchestrator. Your job: decompose work into tasks, run the
session, monitor agents, handle conflicts, and ask the user what to do next.

## Start the session

1. **Decompose work.** Run `paw shortcut generate-paw-yaml` to write `.paw/paw.yaml`.
   Review and approve the yaml before continuing.

2. **Run the session.**

   ```bash
   paw go    # up → launch → watch → merge → down
   ```

   `paw go` creates worktrees, launches agents, merges when all are done, and
   tears down. That's the full automated loop — monitor and intervene as needed
   while it runs.

## During the session

`paw go` is running. Agents are working autonomously. You don't need to manage
them — but you can check in or intervene at any time:

- **`paw watch`** — continuous monitor. Shows broadcasts, status changes, commit
  counts. Auto-exits when all agents are done. Use `--interval 10` to adjust polling.
- **`paw status`** — point-in-time snapshot of agent progress
- **`paw threads`** — see open Q&A threads; answer questions agents directed at you
- **`paw ask <task> "..."`** — send a message to redirect an agent mid-session

## On conflict

When `paw go` or `paw merge` hits a conflict, it stops and prints:

```
Conflict: api into target
Brief written to: .paw-sync/conflicts/api-into-target.md
Fix the conflict, commit, then run: paw merge --continue
```

1. Read the conflict brief at the path printed above
2. Understand both agents' intent from the brief's done summaries and journal entries
3. Resolve the conflicted files — edit to correctly merge both changes
4. `git add <resolved-files>`
5. `git commit -m "resolve: <description>"`
6. `paw merge --continue` — paw resumes merging remaining tasks

Run `paw shortcut resolve-merge-conflict` for the full resolution workflow.

On `post-merge` hook failure: fix the issue and run `paw merge --continue`,
or roll back with `git reset --hard refs/paw-backup/{task}`.

## After paw go completes

`paw go` runs `paw down` automatically — archives session data, removes worktrees,
resets `.paw/paw.yaml` to template. The merged work is on the target branch.

Ask the user what to do next. First, check what's actually available:

```bash
git remote -v     # is there a remote?
git branch        # which local branches exist?
```

**If a remote is configured**, ask the user:
- Open a pull request — use `paw shortcut to-pr`
- Merge into an existing branch and push (name the actual branches)
- Stay on the target branch — review, test, or iterate

**If no remote**, ask the user:
- Merge into an existing branch locally (name the actual branches)
- Stay on the target branch — review, test, or iterate

Don't suggest branches that aren't in the repo. Don't default to PR — ask.

## Manual step-by-step

Skip `paw go` when you need individual control — to redirect agents mid-session,
cherry-pick merges, or make changes on the target branch between merge and cleanup:

```bash
paw up                           # create worktrees, branches, task files
paw launch                       # open terminal + agent in each worktree
paw launch --task <name>         # launch a single worktree
# [monitor and intervene — same commands as above]
paw merge                        # merge when all tasks are done
paw merge --pick <task>          # merge a specific task only
paw down                         # archive, tear down, reset config
paw down --no-archive            # skip archiving session data
```

If you need to make changes yourself (e.g., a shared config file), do it on the
target branch before or after `paw merge` — not during agent work.
