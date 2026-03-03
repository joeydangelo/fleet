---
description: |-
  paw — Parallel Agent Worktrees. Orchestrates multiple AI agents across git worktrees with coordination, conflict resolution, and automated session lifecycle.
  Use for: running agents in parallel, decomposing work into tasks, launching and monitoring agents, merging work with conflict briefs, inter-agent messaging, task dependencies and merge ordering, and creating PRs from merged work.
  Invoke when user mentions: paw, parallel agents, worktrees, multi-agent, parallel tasks, orchestrate agents, spawn agents, launch agents, split work across agents, break this into tasks, check agent progress, merge agent work, resolve conflicts, paw go, paw yaml, task decomposition, broadcasts, watch agents.
allowed-tools: Bash(paw:*)
globs: ".paw/**"
name: paw
---

**paw orchestrates parallel AI coding agents across git worktrees — split work, spawn agents, merge results with full context.**

1. **Orchestrate Agents**: Decompose work into tasks, create isolated worktrees,
   spawn agents with task files, monitor progress, merge completed branches,
   and clean up — the full orchestrator lifecycle.
2. **Agent Coordination**: Broadcasts, directed messages, and Q&A threads
   keep agents aligned without blocking each other.
3. **Conflict Resolution**: When merges conflict, paw generates context-rich
   briefs built from PR descriptions and journal entries so the resolver
   has full intent — not just raw diff markers.
4. **Automated Workflow**: `paw go` handles the full loop (up → spawn → watch →
   merge → down), or run each step manually for fine-grained control.
5. **Shortcuts & Guidelines**: Reusable agent instructions for orchestrator and
   worktree workflows, plus reference knowledge loaded on demand via
   `paw guidelines <name>` and `paw shortcut <name>`.

## Installation

Requires **tmux** (`sudo apt install tmux` on Linux/WSL, `brew install tmux` on macOS).
On Windows, run paw from inside WSL.

```bash
npm install -g get-paw@latest
paw init
```

## Detached Mode

paw auto-detects the terminal environment. Inside tmux, you get the full TUI
with panes. Outside tmux (VS Code, Warp, any terminal), paw runs agents in
background tmux sessions — no configuration needed.

- `paw go` and `paw launch` auto-detect via `$TMUX`
- `paw go --detached` / `paw launch --detached` forces background mode
- `paw watch` and `paw status` monitor from any terminal
- `paw down` cleans up both attached panes and detached sessions

## Routine Commands

```bash
paw --help                       # Command reference
paw status                       # Check progress across all tasks
paw prime                        # Restore full context on paw after compaction
paw init                        # Refresh setup (run after upgrades)
```

## CRITICAL: You Operate paw — The User Doesn't

**You are the paw operator.** Users describe what they want built; you translate
that into paw actions. DO NOT tell users to run paw commands — that's your job.

- **WRONG**: "Run `paw go` to start the session"
- **RIGHT**: *(you write .paw/paw.yaml, run `paw go`, and report results)*

There are two roles. You are one of them:

- **Orchestrator** — runs in the main repo. Decomposes work, sets up worktrees,
  monitors agents, merges results, handles conflicts, cleans up.
- **Worktree agent** — runs inside an isolated worktree. Reads its task, works
  autonomously, broadcasts changes, commits work, creates a PR, and submits for review.

Read the section for your role.

## How to Use paw to Help Users

**Action commands** do things: `paw go`, `paw merge`, `paw broadcast`, `paw down`.
**Informational commands** load workflow guidance you follow: `paw shortcut <name>`,
`paw guidelines <name>`, `paw template <name>`.

| User Intent | What You Do |
|---|---|
| Wants to plan a feature | Load `paw shortcut new-plan-spec`, follow it to create a spec, then decompose with `paw shortcut generate-paw-yaml` |
| Wants work parallelized | Load `paw shortcut generate-paw-yaml`, follow it to write `.paw/paw.yaml`, then `paw go` |
| Wants GitHub issues worked on | Load `paw shortcut from-github-issue`, follow it, then `paw go` |
| Wants open tracker issues done | Load `paw shortcut from-issues`, follow it, then `paw go` |
| Wants to see progress | `paw status` |
| Merge conflict happened | Load `paw shortcut resolve-merge-conflict` and follow it |
| Work is done, wants a PR | Load `paw shortcut to-pr` and follow it |
| Wants session cleaned up | `paw down` |
| Needs GitHub CLI set up | Load `paw shortcut setup-github-cli` and follow it |
| Needs paw installed/upgraded | `npm install -g get-paw@latest && paw init` |
| New to paw / getting started | Load `paw shortcut getting-started` and follow it |

Worktree agents use a different set — see the Worktree Agent section below.

---

## Orchestrator

You run in the main repo. Your job: decompose work, spawn agents, monitor
progress, merge results, handle conflicts, and clean up.

### Orchestrator workflow

1. **(Optional) Plan first.** For complex features, load
   `paw shortcut new-plan-spec` to create a feature spec in
   `docs/project/specs/active/` before decomposing.
2. **Decompose work.** Load `paw shortcut generate-paw-yaml` and follow it to
   write `.paw/paw.yaml`. If a spec exists, reference it in task `spec:` fields.
   Review and approve the yaml before continuing.
3. **Run the session.**
   ```bash
   paw go    # up → launch → watch → review → merge → down
   ```
4. **Handle conflicts.** If `paw go` exits on a conflict, load
   `paw shortcut resolve-merge-conflict` — it reads the brief, resolves
   files, and continues merging.
5. **Ask what's next.** When `paw go` completes, the merged work is on the
   target branch. Check `git remote -v` and `git branch`, then ask the
   user — PR, local merge, or iterate.

### Orchestrator action commands

**Primary — covers 90% of use:**

| Command | Purpose |
|---|---|
| `paw go` | Full lifecycle: up → launch → watch → review → merge → down |
| `paw go --no-review` | Skip the PR review phase |
| `paw go --detached` | Force background tmux sessions (auto-detected outside tmux) |
| `paw go --task <name>` | Spawn and watch a single task only |
| `paw go --no-merge` | Stop after all agents done (inspect before merging) |
| `paw go --no-teardown` | Merge but keep worktrees (inspect after merging) |
| `paw go --dry-run` | Preview what would happen without executing |
| `paw go --poll-interval 10` | Adjust watch polling frequency (default 5s) |
| `paw status` | Check progress across all tasks |
| `paw down` | Archive session, remove worktrees, reset config |
| `paw down --dry-run` | Preview what would be removed |

**Manual recovery — step-by-step control:**

| Command | Purpose |
|---|---|
| `paw up` | Create worktrees and branches for all tasks |
| `paw up --dry-run` | Preview what would be created |
| `paw launch` | Spawn agents (auto-detects attached vs detached mode) |
| `paw launch --task <name>` | Spawn agent in a specific worktree |
| `paw launch --detached` | Force detached mode (background tmux sessions) |
| `paw launch --dry-run` | Preview spawn commands without executing |
| `paw watch` | Continuous terminal monitor (auto-exits when done) |
| `paw watch --no-exit` | Keep running after all tasks are done |
| `paw merge` | Merge completed task branches (respects `depends_on` order) |
| `paw merge --continue` | Resume after conflict resolution |
| `paw merge --pick <task>` | Merge a specific task only |
| `paw` | Open TUI — attach to tmux session with agent panes |

**Coordination:**

| Command | Purpose |
|---|---|
| `paw send <task> "..."` | Send a directed message to an agent |
| `paw inbox --all` | See all broadcasts, open threads, and resolved threads |

### Orchestrator informational commands

These load workflow guidance — read the output and follow the instructions.

| Command | Purpose |
|---|---|
| `paw shortcut new-plan-spec` | How to create a feature spec before decomposing into tasks |
| `paw shortcut generate-paw-yaml` | How to analyze a codebase and create .paw/paw.yaml |
| `paw shortcut from-issues` | How to generate paw.yaml from CLI issue tracker |
| `paw shortcut from-github-issue` | How to generate paw.yaml from GitHub issue(s) |
| `paw shortcut resolve-merge-conflict` | How to read conflict brief, resolve files, `paw merge --continue` |
| `paw shortcut to-pr` | How to create PR from merged agent work |
| `paw shortcut setup-github-cli` | How to ensure gh CLI is installed and authenticated |

---

## Worktree Agent

You run inside an isolated worktree. Your job: complete your assigned task,
broadcast changes that affect other agents, and submit a PR for review when
finished.

### Agent workflow

Follow `paw shortcut build-task` for the full workflow:

1. **Build** — Broadcast intent, plan work, implement with TDD.
2. **Verify** — Review diff, format/lint/test, broadcast interface changes.
3. **Publish** — Commit, push branch, create PR (`paw template pr-template`),
   then `paw review` to submit for review.

### Agent action commands

| Command | Purpose |
|---|---|
| `paw broadcast "..."` | Announce a change to all agents |
| `paw send <task> "..."` | Send a directed message to another agent |
| `paw reply "..."` | Reply to the most recent message |
| `paw reply --to <thread> "..."` | Reply to a specific thread |
| `paw status` | Check progress across all tasks |
| `paw review` | Submit task for review (push + PR first) |

### Agent informational commands

| Command | Purpose |
|---|---|
| `paw shortcut build-task` | Build/Verify/Publish workflow from task assignment to review |
| `paw shortcut review-pr` | Review a task PR — return PASS or FAIL with findings |

---

## Reference

### Utility commands

| Command | Purpose |
|---|---|
| `paw shortcut --list` | List available shortcuts |
| `paw guidelines --list` | List available guidelines |
| `paw template --list` | List available templates |
| `paw skill` | Output full skill content to stdout |

### Available shortcuts

<!-- BEGIN SHORTCUT DIRECTORY -->
| Command | Purpose |
|---|---|
| `paw shortcut build-task` | Build, verify, and publish your paw task — the full worktree agent workflow |
| `paw shortcut from-github-issue` | Fetch GitHub issues, decompose them into tasks, and generate paw.yaml |
| `paw shortcut from-issues` | Detect the repo's issue tracker, read open issues, and generate paw.yaml |
| `paw shortcut generate-paw-yaml` | Analyze a codebase and generate .paw/paw.yaml with well-decomposed parallel tasks |
| `paw shortcut getting-started` | Install paw and run your first parallel agent session |
| `paw shortcut new-plan-spec` | Create a new feature planning specification document |
| `paw shortcut resolve-merge-conflict` | Read a conflict brief, resolve the merge conflict, and continue merging |
| `paw shortcut review-pr` | Review a task PR — step-by-step workflow returning PASS or FAIL with structured findings |
| `paw shortcut setup-github-cli` | Ensure GitHub CLI (gh) is installed and authenticated |
| `paw shortcut setup-tmux` | Ensure tmux is installed for paw's terminal management |
| `paw shortcut to-pr` | Combine agent PR descriptions into a final PR with issue references |
<!-- END SHORTCUT DIRECTORY -->

### Available guidelines

<!-- BEGIN GUIDELINES DIRECTORY -->
| Command | Purpose |
|---|---|
| `paw guidelines code-comments` | Language-agnostic rules for writing clean, maintainable comments |
| `paw guidelines code-quality` | Rules for clean, maintainable code — duplication, dead code, types, and structure |
| `paw guidelines commit-conventions` | Conventional Commits format with extensions for multi-agent workflows |
| `paw guidelines error-handling` | Rules for handling errors, failures, and exceptional conditions |
| `paw guidelines paw-task-decomposition` | How to split work into independent parallel tasks that minimize conflicts |
| `paw guidelines security-patterns` | Concrete security patterns to flag during code review |
| `paw guidelines test-driven-development` | Use when implementing any feature or bugfix, before writing implementation code |
| `paw guidelines test-quality` | Rules for writing minimal, effective tests with maximum coverage |
| `paw guidelines testing-anti-patterns` | Common testing mistakes — mock misuse, test-only production methods, and incomplete test doubles |
| `paw guidelines typescript-testing` | Integration testing patterns for TypeScript — test behavior and data flow, not mock existence |
| `paw guidelines verify-completion` | Use when about to claim work is complete, fixed, or passing, before committing or creating PRs - requires running verification commands and confirming output before making any success claims; evidence before assertions always |
<!-- END GUIDELINES DIRECTORY -->

### Available templates

<!-- BEGIN TEMPLATE DIRECTORY -->
| Command | Purpose |
|---|---|
| `paw template paw-yaml` | Annotated config structure for .paw/paw.yaml |
| `paw template plan-spec` | Template for feature planning specification documents |
| `paw template pr-template` | Pull request body template for paw worktree agents |
<!-- END TEMPLATE DIRECTORY -->

---

## Quick Reference

- **Orchestrator** runs in main repo, **Worktree agent** runs in isolated worktree
- Config: `.paw/paw.yaml` — tasks, target branch, base, dependencies
- Session state: `paw-sync` branch (managed by paw CLI)
- Full lifecycle: `paw go` (up → launch → watch → review → merge → down)
- TUI: `paw` (bare command) attaches to tmux session with agent panes
- Resource discovery: `paw shortcut --list`, `paw guidelines --list`, `paw template --list`
