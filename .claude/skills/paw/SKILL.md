---
description: paw -- Parallel Agent Worktrees. Orchestrates multiple AI agents across git worktrees with coordination via broadcasts, summaries, and conflict briefs. Use when the user mentions paw, parallel agents, worktrees, or multi-agent coordination.
globs: "paw.yaml,paw.yml,.paw/**"
---

# paw

paw orchestrates parallel AI coding agents across git worktrees. Agents work in
isolated worktrees, communicate through a shared sync branch, and merge results
back with full context about what each agent intended.

You are one of those agents. paw gives you your task assignment, keeps you informed
about what other agents are doing, and helps the team merge without surprises.

## On Session Start

Run `paw prime` immediately. It gives you everything in one shot:
- Your task assignment (focus areas, instructions)
- Team status (who's working, who's done)
- Recent broadcasts from other agents
- Messages directed at you
- Completed summaries from finished agents

For the full session-start workflow, run `paw shortcut session-start`.

## Commands

```
paw prime              # orient + self-assign (run this first)
paw status             # check progress across all tasks
paw broadcast "..."    # announce a change to all agents
paw ask <task> "..."   # send a directed message to a specific agent
paw reply "..."        # reply to the most recent directed message
paw check              # read new messages and broadcasts
paw done --summary "." # mark task completed with summary
```

## Workflow

1. `paw prime` -- read your assignment, see the team state
2. Broadcast your intent before starting work
3. Work on your task, staying within your focus areas
4. `paw broadcast "..."` when you change interfaces other agents depend on
5. `paw check` periodically for messages from other agents
6. Follow `paw shortcut precommit-process` when committing
7. `paw shortcut session-end` when finished

## Shortcuts

Run `paw shortcut <name>` for step-by-step workflows:

| Shortcut | Purpose |
|---|---|
| `generate-paw-yaml` | Analyze a codebase and create a paw.yaml |
| `session-start` | Agent's first actions in a worktree |
| `session-end` | Wrap up: broadcast final state, write done summary |
| `resolve-conflict` | Read conflict brief, resolve, merge --continue |
| `precommit-process` | Review, test, broadcast, and commit checklist |

## Guidelines

Run `paw guidelines <name>` for reference knowledge:

| Guideline | Purpose |
|---|---|
| `commit-conventions` | Conventional Commits format for multi-agent work |
| `paw-task-decomposition` | How to split work into good parallel tasks |

## Templates

Run `paw template <name>` for document structures:

| Template | Purpose |
|---|---|
| `paw-yaml` | Annotated paw.yaml config structure |
| `task-summary` | Done summary structure (what/interfaces/watch-out) |

## Key Principles

- **Broadcast interface changes.** If you change a type, export, or API that another
  task might depend on, broadcast it. This is the most important coordination action.
- **Stay in your focus area.** Your task file lists which files you own. Editing files
  outside your focus area causes merge conflicts.
- **Read before you plan.** `paw prime` shows what other agents have done and said.
  Adapt your approach to the current state, not your initial assumptions.
- **Write a good summary.** Your done summary is what the merge process and resolver
  agents use to understand your work. See `paw template task-summary`.
