---
description: paw — Parallel Agent Worktrees. Orchestrates multiple AI agents across git worktrees with coordination via broadcasts, summaries, and conflict briefs. Use when the user mentions paw, parallel agents, worktrees, or multi-agent coordination.
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

Run `paw shortcut generate-paw-yaml` to decompose the user's request into
`.paw/paw.yaml`, review and approve the yaml, then:

```bash
paw go    # fan-out → agents work → fan-in → tear down
```

That's the full session. When `paw go` completes, the merged work is on the
target branch. Run `paw shortcut fan-out-in` for post-session steps: check
what's available (remote? branches?), then ask the user what to do next.

For conflict resolution or mid-session intervention, see below.

#### When `paw go` exits with a conflict

When `paw go` or `paw merge` exits on a conflict, the output shows:

```
Conflict: api into target
Brief written to: .paw-sync/conflicts/api-into-target.md
Fix the conflict, commit, then run: paw merge --continue
```

Run `paw shortcut resolve-merge-conflict` — it walks through reading
the brief, resolving files, and running `paw merge --continue`.

#### Request → command

| User says | Run |
|---|---|
| "Build feature X" / "Run this spec" | `paw shortcut generate-paw-yaml` → `paw go` |
| "Build from this GitHub issue" | `paw shortcut from-github-issue` → `paw go` |
| "Build from open issues" / "What issues are there?" | `paw shortcut from-issues` → `paw go` |
| "There's a conflict" | `paw shortcut resolve-merge-conflict` |
| "Create a PR" | `paw shortcut to-pr` |
| "Check what agents are doing" | `paw status` or `paw watch` |
| "Ask the auth agent about X" | `paw ask auth "..."` |
| "Set up GitHub" / "gh isn't working" | `paw shortcut setup-github-cli` |

#### Manual commands (what `paw go` does step by step)

**`paw up`** — creates worktrees, branches, and task files.

**`paw launch`** — opens a terminal with the agent command in each worktree.
Each agent auto-orients via `paw prime` on startup (triggered by the SessionStart hook).

**Monitor** — `paw status` to check progress. `paw threads` to see open threads.
`paw ask <task> "..."` to redirect an agent.

**`paw merge`** — merges completed task branches into the target branch. On hook
failure: fix the issue and run `paw merge --continue`, or roll back with
`git reset --hard refs/paw-backup/{task}`.

**`paw down`** — archives session data to `.paw/sessions/`, removes worktrees
and sync branch, and resets `.paw/paw.yaml` to template.
The merged target branch remains. Use `--no-archive` to skip archival.

For post-session steps, see `paw shortcut fan-out-in`.

### Orchestrator commands

```bash
paw up                           # Create worktrees for all tasks
paw up --dry-run                 # Preview what would be created
paw launch                       # Open terminal + agent in each worktree
paw launch --dry-run             # Preview launch commands without spawning
paw launch --task <name>         # Launch agent in a specific worktree
paw go                           # Full workflow: up → launch → watch → merge → down
paw go --poll-interval 10       # Adjust watch polling frequency (default 5s)
paw status                       # Check progress across all tasks
paw watch                        # Continuous terminal monitor (auto-exits when done)
paw watch --interval 10          # Adjust polling frequency (default 5s)
paw watch --no-exit              # Keep running after all tasks are done
paw merge                        # Merge completed task branches
paw merge --continue             # Resume after conflict or hook failure
paw merge --pick <task>          # Merge a specific task only
paw down                         # Archive session, remove worktrees, reset config
paw down --dry-run               # Preview what would be removed
paw down --no-archive            # Skip archiving session data
paw ask <task> "..."             # Send a directed message to an agent
paw threads                      # See open Q&A threads
paw threads --all                # See all threads including resolved
```

### Orchestrator shortcuts

| Shortcut | Purpose |
|---|---|
| `generate-paw-yaml` | Analyze a codebase and create .paw/paw.yaml |
| `from-issues` | Generate paw.yaml from CLI issue tracker |
| `from-github-issue` | Generate paw.yaml from GitHub issue(s) |
| `to-pr` | Create PR from merged agent work |
| `setup-github-cli` | Ensure gh CLI is installed and authenticated |
| `fan-out-in` | Full orchestrator lifecycle: monitor, conflicts, post-session |
| `resolve-merge-conflict` | Read conflict brief, resolve files, `paw merge --continue` |

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
   - Done summaries from finished agents
2. **Broadcast your intent** before starting work.
3. **Work on your task**, staying within your focus areas.
4. **`paw broadcast "..."`** when you change interfaces other agents depend on.
5. **`paw threads`** periodically to check for open threads.
6. **`paw shortcut precommit-process`** when committing.
7. **`paw shortcut session-end`** when finished.

### Agent commands

```bash
paw prime                        # Orient and claim your task
paw prime --brief                # Condensed output (focus + team status only)
paw broadcast "..."              # Announce a change to all agents
paw threads                      # See open Q&A threads
paw ask <task> "..."             # Send a directed message to an agent
paw reply "..."                  # Reply to the most recent message
paw reply --to <thread> "..."   # Reply to a specific thread
paw done << 'EOF'                # Mark task done with summary (heredoc)
...summary...
EOF
paw done --summary "..."         # Short single-line alternative
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

### CRITICAL: What agents must NEVER do

- **NEVER manually edit `state.json` or any file on the sync branch.** The paw
  CLI manages all sync state. If you write to state.json directly, you will
  corrupt the coordination state and break `paw watch`, `paw go`, and `paw merge`.
- **NEVER `git checkout paw-sync`** or switch to the sync branch. It is managed
  by a dedicated worktree. Checking it out will fail or corrupt state.
- **NEVER merge branches.** Merging is the orchestrator's job (`paw merge`).
  You work on your task branch only.
- **NEVER run `git push`.** The orchestrator pushes the merged target branch
  after `paw merge`. Pushing from a worktree bypasses conflict resolution.
- **NEVER create pull requests.** The orchestrator handles PRs after merge.
- **NEVER run `paw up`, `paw down`, `paw merge`, or `paw go`.** These are
  orchestrator commands. Running them from a worktree will break the session.

Use the CLI for everything: `paw done`, `paw broadcast`, `paw threads`.
The CLI handles sync state correctly. You don't need to touch it.

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

Configure hooks in .paw/paw.yaml:

```yaml
hooks:
  post-up: npm install
  pre-done: npm test
  post-merge: npm test
```

Hooks run via bash, so you can write multi-line scripts inline using YAML's
block scalar syntax (`|`), or call an external script.

**`post-up`** runs in each worktree after creation and file copying during
`paw up`. Useful for installing dependencies, running codegen, or any
per-worktree setup that needs to happen before the agent starts working.

**`pre-done`** runs before `paw done` marks a task complete. If it fails, done
is blocked. Use `--force` to bypass.

**`post-merge`** runs after each clean merge. If it fails, paw stops and shows
rollback guidance. Use `paw merge --continue` after fixing, or roll back with
`git reset --hard refs/paw-backup/{task}`.

### Dependencies

Control merge order with `depends_on` on tasks:

```yaml
tasks:
  auth:
    focus: src/auth/
  api:
    focus: src/api/
    depends_on: auth        # merged after auth
  tests:
    focus: tests/
    depends_on:             # merged after both
      - auth
      - api
```

`paw merge` processes tasks in topological order — dependencies merge first
so shared interfaces exist on the target branch before dependent code arrives.
Tasks without dependencies merge in YAML definition order. Cycles and invalid
references are caught at config load time.
