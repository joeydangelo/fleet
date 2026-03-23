# Fleet

![Fleet demo](assets/FleetDemo.gif)

Orchestrate multiple AI coding agents across git worktrees.

> [!WARNING]
> Fleet runs agents with `--dangerously-skip-permissions`. Hooks guard against unsafe actions — builders cannot run `git push`, switch branches, or access sync state directly. Reviewer agents can only use read-only tools. Each task spawns its own Claude Code session, so parallel agents multiply API usage.

## What Is Fleet

Fleet is a CLI that splits a feature into parallel tasks, spawns a Claude Code agent for each one, and merges the results back together. Each agent runs in its own git worktree with its own branch. Tasks own specific files, so agents do not conflict with each other.

One command runs the full lifecycle — creates worktrees, launches agents in tmux sessions, monitors health, merges branches in dependency order, and cleans up when done:

```bash
fleet go
```

Fleet also ships built-in shortcuts, guidelines, and templates that agents load on demand. Shortcuts are step-by-step procedures that tell agents *what to do*. Guidelines are calibration rules that tell agents *what counts as correct*. Templates are starter structures for documents agents produce.

## Requirements

- [Node.js](https://nodejs.org/) 20+
- [tmux](https://github.com/tmux/tmux) (agents run in detached tmux sessions)
- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) CLI
- Git

> [!NOTE]
> **Windows is not supported.** Fleet requires tmux and a native Linux filesystem. Use [WSL2](https://learn.microsoft.com/en-us/windows/wsl/install):
>
> ```powershell
> # PowerShell (as Admin)
> wsl --install
> ```
>
> Then inside WSL:
>
> ```bash
> sudo apt install tmux
> ```
>
> Clone your repo onto the **native WSL filesystem** (your home directory). Do **not** run from `/mnt/c/` or other Windows drives. Git worktrees and pre-commit hooks break across the NTFS/Linux boundary.
>
> Your Windows editor can still access WSL files at `\\wsl$\<distro>\home\...` or through VS Code Remote-WSL (`code .`).

## Install

```bash
npm install -g get-fleet@latest
```

Then initialize fleet in your repo:

```bash
cd your-repo
fleet init
```

This does four things:
1. Syncs built-in [shortcuts](#shortcuts), [guidelines](#guidelines), and [templates](#templates) to `.fleet/docs/`
2. Installs Claude Code skills for each agent role (orchestrator, builder, reviewer)
3. Configures Claude Code hooks for health monitoring, messaging, and event tracking
4. Creates a starter `.fleet/fleet.yaml` if one does not exist

## How It Works

Tell your Claude orchestrator agent what you want to build. The agent uses fleet shortcuts to plan the work:

| What you say | What the agent runs |
|---|---|
| "Build this feature" / "Fix this bug" | `fleet shortcut assess-work` |
| "Plan this feature" | `fleet shortcut write-spec` |
| "Break it into tasks" | `fleet shortcut decompose-work` |
| "Build it" | `fleet go` |
| "Check progress" | `fleet status` |

The `assess-work` shortcut is the usual starting point. It scouts the codebase, evaluates complexity, and picks a route. Simple changes (bug fixes, small refactors) go straight to implementation. Larger work routes to `write-spec`, which produces a feature spec, then `decompose-work` splits it into parallel tasks.

The agent writes a `.fleet/fleet.yaml` file that defines tasks, their file ownership, and dependencies. You never need to write or edit the YAML by hand.

### The `fleet go` lifecycle

`fleet go` runs the full cycle:

1. **Up** —creates a git worktree and branch for each task
2. **Launch** —spawns a Claude Code agent in a detached tmux session per worktree
3. **Watch** —polls for progress, routes messages between agents, monitors health
4. **Merge** —merges completed branches into the target branch (respects dependency order)
5. **Down** —removes worktrees, archives the session, cleans up

Use `fleet go --dry-run` to preview what would happen without executing anything.

## Commands

### Primary

| Command | What it does |
|---|---|
| `fleet go` | Full lifecycle: up, launch, watch, merge, down |
| `fleet go --dry-run` | Preview the plan without running it |
| `fleet status` | Check progress across all tasks |
| `fleet down` | Archive the session and remove worktrees |

### Step-by-step control

If you need manual control over individual phases:

| Command | What it does |
|---|---|
| `fleet up` | Create worktrees and branches |
| `fleet launch` | Spawn agents in tmux sessions |
| `fleet watch` | Monitor agents until all tasks finish |
| `fleet merge` | Merge completed branches in dependency order |
| `fleet merge --continue` | Resume after you resolve a merge conflict |

### Agent communication

| Command | What it does |
|---|---|
| `fleet broadcast "message"` | Send a message to all agents |
| `fleet send <task> "message"` | Send a direct message to one agent |
| `fleet reply <task> "message"` | Reply to a message from an agent |
| `fleet nudge <task> "message"` | Wake a stuck agent |
| `fleet inbox` | Check for new messages and open threads |

### Monitoring

| Command | What it does |
|---|---|
| `fleet prime` | Restore full context after compaction |
| `fleet summary --show` | Read a builder's task summary |
| `fleet feed` | Stream agent events to the terminal |
| `fleet dashboard` | Terminal UI for fleet sessions |

### Builder commands

Builders call these during the [build-task](src/docs/shortcuts/build-task.md) lifecycle. You rarely need to run them by hand.

| Command | What it does |
|---|---|
| `fleet summary` | Write a task summary after verification |
| `fleet summary --append` | Add to an existing summary after fixing review findings |
| `fleet review` | Submit a task for code review and wait for the result |
| `fleet heartbeat` | Record agent activity (hooks call this on every tool call) |

### Docs

| Command | What it does |
|---|---|
| [`fleet shortcut <name>`](#shortcuts) | Display a shortcut workflow |
| [`fleet guidelines <name>`](#guidelines) | Display a coding guideline |
| [`fleet template <name>`](#templates) | Display a document template |

Each doc command also supports `--list` to see what is available:

```bash
fleet shortcut --list
fleet guidelines --list
fleet template --list
```

## Adding Your Team's Docs

Fleet ships with built-in docs, but you can add your own from any URL:

```bash
fleet shortcut --add <url> --name my-workflow
fleet guidelines --add <url> --name my-rules
fleet template --add <url> --name my-template
```

Use `--roles` to control which agent roles can see the doc:

```bash
fleet guidelines --add <url> --name my-rules --roles orchestrator,builder,reviewer
```

Fleet fetches the markdown from the URL and saves it to `.fleet/docs/`. It also records the URL in `.fleet/manifest.yml` so future `fleet init` runs can refresh it. GitHub blob URLs are converted to raw URLs automatically.

> [!TIP]
> Run `fleet init` after adding docs to sync them into each agent's skill directory.

## Skills

Skills define each agent role — what it does, how it thinks, and what tools it can use. Fleet ships three roles:

| Skill | What it does |
|---|---|
| [`orchestrator`](skills/orchestrator/SKILL.md) | Plans work, splits specs into tasks, spawns agents, monitors progress, merges results |
| [`builder`](skills/builder/SKILL.md) | Implements features in an isolated worktree — test-first, scope-bounded, one task at a time |
| [`reviewer`](skills/reviewer/SKILL.md) | Reviews code for quality, tests, error handling, and security — returns PASS or FAIL |

`fleet init` installs these as Claude Code skills. You can customize them by editing the `SKILL.md` files in `skills/`.

## Shortcuts

Shortcuts are pre-built procedures that agents execute step-by-step. Each shortcut defines phases, gates between them, and stopping conditions. Agents load shortcuts on demand when they encounter a matching task.

| Shortcut | Role | What it does |
|---|---|---|
| [`assess-work`](src/docs/shortcuts/assess-work.md) | orchestrator | Scout the codebase and assess task complexity |
| [`write-spec`](src/docs/shortcuts/write-spec.md) | orchestrator | Write a feature spec from scout findings |
| [`decompose-work`](src/docs/shortcuts/decompose-work.md) | orchestrator | Split a spec into parallel tasks with file ownership |
| [`build-task`](src/docs/shortcuts/build-task.md) | builder | Build a task in an isolated worktree |
| [`review-pr`](src/docs/shortcuts/review-pr.md) | reviewer | Review a pull request with follow-up actions |
| [`finish-branch`](src/docs/shortcuts/finish-branch.md) | orchestrator | Verify and integrate a merged branch |
| [`resolve-merge-conflict`](src/docs/shortcuts/resolve-merge-conflict.md) | orchestrator | Resolve merge conflicts from a conflict brief |

## Guidelines

Guidelines are domain-specific calibration rules that shape agent judgment. A shortcut says "review this code." A guideline says what counts as correct within that domain —severity thresholds, quality criteria, and decision boundaries. Agents load them on demand during shortcut execution.

| Guideline | Role | What it covers |
|---|---|---|
| [`code-authoring`](src/docs/guidelines/code-authoring.md) | builder | Code authoring standards |
| [`code-quality-review`](src/docs/guidelines/code-quality-review.md) | reviewer | Code quality review criteria |
| [`codebase-research`](src/docs/guidelines/codebase-research.md) | orchestrator | Research quality for scout phases |
| [`commit-conventions`](src/docs/guidelines/commit-conventions.md) | orchestrator, builder | Conventional Commits format |
| [`error-handling-review`](src/docs/guidelines/error-handling-review.md) | reviewer | Error handling review |
| [`performance-review`](src/docs/guidelines/performance-review.md) | reviewer | Performance review criteria |
| [`security-review`](src/docs/guidelines/security-review.md) | reviewer | Security review criteria |
| [`spec-design`](src/docs/guidelines/spec-design.md) | orchestrator | Writing executable feature specs |
| [`task-splitting`](src/docs/guidelines/task-splitting.md) | orchestrator | Splitting specs into parallel tasks |
| [`testing`](src/docs/guidelines/testing.md) | builder | Testing standards |

## Templates

Templates provide starter structures for common documents.

| Template | Role | What it provides |
|---|---|---|
| [`fleet-yaml`](src/docs/templates/fleet-yaml.md) | orchestrator | Annotated config structure for `.fleet/fleet.yaml` |
| [`plan-spec`](src/docs/templates/plan-spec.md) | orchestrator | Feature planning spec template |
| [`summary-template`](src/docs/templates/summary-template.md) | builder | Task summary template |

## How Fleet Coordinates Agents

Fleet uses a dedicated `fleet-sync` git branch as shared state between worktrees. This branch stores:

- **Task status** —which tasks are pending, in progress, in review, or done
- **Messages** —broadcasts, direct messages, and replies between agents
- **Heartbeats** —timestamps that track agent activity for health monitoring
- **Conflict briefs** —generated when merges hit conflicts, so agents can resolve them

Claude Code hooks (installed by `fleet init`) handle all of this automatically. A heartbeat hook fires on every tool call. An inbox gate blocks agents from working until they read new messages. A guard hook prevents agents from running dangerous git commands.

### Health monitoring

Every tool call records a timestamp. Fleet checks these every three seconds. If an agent goes five minutes with no activity, fleet tries to recover it in three steps, 90 seconds apart:

1. **Nudge** — Fleet sends a message to the agent's inbox and presses Enter in its tmux pane. Most stalls recover here.
2. **Triage** — Fleet captures the last 100 lines of terminal output and sends them to a one-shot Claude call that returns a verdict:
   - `EXTEND` — the agent looks busy. Reset the clock and keep waiting.
   - `RETRY` — the agent is stuck in a loop. Send a recovery nudge that tells it to try a different approach.
   - `TERMINATE` — the agent has crashed or exited. Skip straight to zombie.
3. **Terminate** — Fleet gives up and marks the agent as a **zombie**. The other agents keep working.

An agent also becomes a zombie if its tmux session dies or ten minutes pass with no heartbeat — whichever comes first.

| Time silent | What happens |
|---|---|
| 5 min | Marked stalled |
| ~6.5 min | Nudge — poke it |
| ~8 min | Triage — diagnose it |
| ~9.5 min | Terminate — give up |

> [!TIP]
> Triage results are saved to `.fleet/run/triage/` for debugging.

### Event feed and dashboard

All agent activity emits structured NDJSON events to `.fleet/run/feed.ndjson`. Use `fleet feed` to live-tail it, `fleet feed --replay <session>` to replay a past session, or `fleet dashboard` for a full-screen terminal UI with agents, messages, and merge queue panels.

## License

[MIT](LICENSE)
