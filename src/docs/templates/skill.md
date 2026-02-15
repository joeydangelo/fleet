---
description: paw -- Parallel Agent Worktrees. Orchestrates multiple AI agents across git worktrees with coordination via broadcasts, summaries, and conflict briefs. Use when the user mentions paw, parallel agents, worktrees, or multi-agent coordination.
globs: ".paw/**"
---

# paw

paw orchestrates parallel AI coding agents across git worktrees. It handles the
fan-out/fan-in lifecycle: define tasks, spin up isolated worktrees, orient
agents, coordinate through broadcasts and summaries, and merge results back with
full context about what each agent intended.

There are two roles. You are one of them:

- **Orchestrator** — runs in the main repo, operates paw on behalf of the user.
  Decomposes work into tasks, sets up worktrees, monitors progress, merges
  results, handles conflicts, cleans up.
- **Worktree agent** — runs inside an isolated worktree. Reads its task
  assignment, works autonomously, broadcasts changes, checks for messages,
  commits work, writes a done summary.

Read the section for your role.

## Installation

```bash
npm install -g get-paw@latest
paw setup                        # Set up or upgrade paw
```

---

## Orchestrator

You operate paw on behalf of the user. The user describes what they want done;
you translate that into `.paw/paw.yaml`, spin up agents, and merge the results.
The user never runs paw commands — that's your job.

### Orchestrator workflow

1. **Create `.paw/paw.yaml`.** Run `paw shortcut generate-paw-yaml` to decompose
   work into parallel tasks with focus areas and prompts.
2. **`paw up`** — creates worktrees, branches, and task files.
3. **`paw launch`** — opens a terminal with the agent command in each worktree.
   Each agent auto-orients via `paw prime` on startup.
4. **Monitor.** `paw status` to check progress. `paw check` to read broadcasts.
   `paw ask <task> "..."` to redirect an agent.
5. **`paw merge`** — merges completed task branches into the target branch.
6. **Handle merge failures.** Two things can stop a merge:
   - **Conflict**: paw writes a conflict brief and stops. Run
     `paw shortcut resolve-conflict` to read the brief, fix it, then
     `paw merge --continue`.
   - **Hook failure**: the post-merge hook failed. Fix the issue, then
     `paw merge --continue`. To roll back instead:
     `git reset --hard refs/paw-backup/{task}`.
7. **`paw down`** — archives session data to `.paw/sessions/`, removes worktrees,
   and resets `.paw/paw.yaml` to template. The merged target branch remains.
   Use `--no-archive` to skip archival.

### Orchestrator commands

```bash
paw up                           # Create worktrees for all tasks
paw up --dry-run                 # Preview what would be created
paw launch                       # Open terminal + agent in each worktree
paw launch --dry-run             # Preview launch commands without spawning
paw launch --task <name>         # Launch agent in a specific worktree
paw launch --wait                # Launch and block until all agents done
paw go                           # Full workflow: up → launch → watch → merge → down
paw go --poll-interval 10       # Adjust watch polling frequency (default 5s)
paw status                       # Check progress across all tasks
paw watch                        # Continuous terminal monitor (auto-exits when done)
paw merge                        # Merge completed task branches
paw merge --continue             # Resume after conflict or hook failure
paw merge --pick <task>          # Merge a specific task only
paw down                         # Archive session, remove worktrees, reset config
paw down --no-archive            # Skip archiving session data
paw ask <task> "..."             # Send a directed message to an agent
paw check                        # Read broadcasts and messages
```

### Orchestrator shortcuts

| Shortcut | Purpose |
|---|---|
| `generate-paw-yaml` | Analyze a codebase and create .paw/paw.yaml |
| `from-issues` | Generate paw.yaml from CLI issue tracker |
| `from-github-issue` | Generate paw.yaml from GitHub issue(s) |
| `to-pr` | Create PR from merged agent work |
| `setup-github-cli` | Ensure gh CLI is installed and authenticated |
| `fan-out-in` | Full orchestrator workflow reference |
| `resolve-conflict` | Read conflict brief, resolve, merge --continue |

---

## Worktree Agent

You work autonomously inside an isolated worktree. Your job is to complete your
assigned task, communicate changes that affect other agents, and write a summary
so the merge process understands your work.

### Agent workflow

1. **`paw prime`** — orient yourself. Gives you everything in one shot:
   - Your task assignment (focus areas, instructions)
   - Team status (who's working, who's done)
   - Recent broadcasts from other agents
   - Messages directed at you
   - Completed summaries from finished agents
2. **Broadcast your intent** before starting work.
3. **Work on your task**, staying within your focus areas.
4. **`paw broadcast "..."`** when you change interfaces other agents depend on.
5. **`paw check`** periodically for new messages.
6. **`paw shortcut precommit-process`** when committing.
7. **`paw shortcut session-end`** when finished.

### Agent commands

```bash
paw prime                        # Orient and claim your task
paw broadcast "..."              # Announce a change to all agents
paw check                        # Read new messages and broadcasts
paw ask <task> "..."             # Send a directed message to an agent
paw reply "..."                  # Reply to the most recent message
paw done --summary "..."         # Mark task completed with summary
paw done --force --summary "..." # Bypass validation and pre-done hook
paw status                       # Check progress across all tasks
```

### Agent shortcuts

| Shortcut | Purpose |
|---|---|
| `session-start` | First actions in a worktree |
| `session-end` | Wrap up: broadcast final state, write done summary |
| `build-task` | TDD workflow from task assignment to done |
| `precommit-process` | Check messages, review, validate, broadcast, commit |

### Key principles

- **Broadcast interface changes.** If you change a type, export, or API that
  another task might depend on, broadcast it. This is the most important
  coordination action.
- **Stay in your focus area.** Your task file lists which files you own. Editing
  files outside your focus area causes merge conflicts.
- **Read before you plan.** `paw prime` shows what other agents have done and
  said. Adapt your approach to the current state, not your initial assumptions.
- **Write a good summary.** Your done summary is what the merge process and
  resolver agents use to understand your work. Use `paw template task-summary`
  for the structure.

---

## Reference

### Guidelines

Run `paw guidelines <name>` for reference knowledge:

| Guideline | Purpose |
|---|---|
| `commit-conventions` | Conventional Commits format for multi-agent work |
| `general-tdd-guidelines` | Red, Green, Refactor in small slices |
| `general-testing-rules` | Minimal tests, maximum coverage |
| `paw-task-decomposition` | How to split work into good parallel tasks |
| `typescript-testing-guidelines` | Test behavior and data flow, not mock existence |

### Templates

Run `paw template <name>` for document structures:

| Template | Purpose |
|---|---|
| `paw-yaml` | Annotated .paw/paw.yaml config structure |
| `task-summary` | Done summary structure (what/interfaces/watch-out) |

### Include (gitignored file copying)

Copy gitignored files from the main repo into each worktree during `paw up`.
Files that already exist in the worktree are skipped.

```yaml
include:
  - .env
  - .env.local
  - "config/local.json"
  - "**/.secret*"
```

Patterns use glob syntax (powered by fast-glob). `paw up --dry-run` previews
which files would be copied.

### Hooks

Configure validation hooks in .paw/paw.yaml:

```yaml
hooks:
  pre-done: npm test
  post-merge: npm test
```

**`pre-done`** runs before `paw done` marks a task complete. If it fails, done
is blocked. Use `--force` to bypass.

**`post-merge`** runs after each clean merge. If it fails, paw stops and shows
rollback guidance. Use `paw merge --continue` after fixing, or roll back with
`git reset --hard refs/paw-backup/{task}`.
