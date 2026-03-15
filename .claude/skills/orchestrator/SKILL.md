---
name: orchestrator
description: |-
  Splits work into parallel tasks and swarms agents across worktrees. Plans, decomposes, monitors, merges, and ships.
  Use for: planning features, writing specs, decomposing tasks, splitting issues, running parallel agents, swarming worktrees, monitoring progress, merging branches, resolving conflicts, finishing branches, creating PRs.
  Invoke when user mentions: fleet, swarm, orchestrate, decompose, parallel, worktrees, split work, break into tasks, spawn agents, fleet go, merge, conflicts, finish branch, PR, plan, spec, commit.
allowed-tools: Bash(fleet:*)
globs: ".fleet/**"
---

Coordinate by reasoning about change shape — which files move, which modules
interact, which interfaces break — rather than about code. Delegate research to
scouts; synthesize their findings into routing decisions, specs, and task
decompositions.

Calibrate process to stakes in both directions. Over-processing simple work wastes
cycles; under-processing cross-module changes ships unresolved design decisions.
When assessment signals conflict, take the lighter path. Proceed on reversible
choices; escalate when consequences are irreversible, ambiguous with multiple valid
interpretations, or require context only the user holds.

Enforce non-overlapping file ownership across tasks. Tests belong with the feature
task that owns those files. Every shared boundary gets an explicit interface
contract with one designated producer. Task prompts are self-contained builder
briefings — concrete deliverables, acceptance criteria, and interface dependencies
included; spec file referenced for shared context, not duplicated.

Spawn parallel agents in a single message — serial fan-out is a structural
failure, not a style preference.

Ground decisions in artifacts — specs, briefs, summaries, config files — not
accumulated conversation. Reconstruct intent from evidence when resolving conflicts
between builders: read what each agent accomplished before choosing a resolution
strategy. The already-merged branch is canonical; the incoming task adapts to it.
Verify that discarded contributions are genuinely unnecessary before dropping them.
Favor re-imagination over merge archaeology when divergence exceeds the cost of
fresh implementation.

Match verification depth to change scope. Blanket validation on trivial changes
erodes trust; skipped validation on risky changes introduces defects.

## Commands

**Primary — covers 90% of use:**

| Command | Purpose |
|---|---|
| `fleet go` | Full lifecycle: up, launch, watch, review, merge, down |
| `fleet go --dry-run` | Preview what would happen without executing |
| `fleet status` | Check progress across all tasks |
| `fleet down` | Archive session, remove worktrees, reset config |

**Manual recovery — step-by-step control:**

| Command | Purpose |
|---|---|
| `fleet up` | Create worktrees and branches for all tasks |
| `fleet launch` | Spawn agents (detached by default; attached in tmux) |
| `fleet watch` | Continuous terminal monitor (auto-exits when done) |
| `fleet merge` | Merge completed task branches (respects `depends_on` order) |
| `fleet merge --continue` | Resume after conflict resolution |

**Context:**

| Command | Purpose |
|---|---|
| `fleet prime` | Restore full context after compaction |
| `fleet summary --show` | Read a builder's task summary |

**Coordination:**

| Command | Purpose |
|---|---|
| `fleet broadcast "..."` | Announce a message to all agents |
| `fleet send <task> "..."` | Send a direct message to an agent |
| `fleet reply <task> "..."` | Reply to a direct message from an agent |
| `fleet nudge <task> "..."` | Send a nudge message to wake a stalled agent |
| `fleet inbox` | Check for broadcasts and unanswered messages |

## Shortcuts

<!-- BEGIN SHORTCUT DIRECTORY -->
| Command | Purpose |
|---|---|
| `fleet shortcut assess-work` | Scout the codebase, assess task complexity, and route to the optimal workflow |
| `fleet shortcut decompose-work` | Decompose a spec into parallel tasks with explicit file ownership and write .fleet/fleet.yaml |
| `fleet shortcut finish-branch` | Verify the merged target branch and integrate via the user's chosen path |
| `fleet shortcut resolve-merge-conflict` | Read a conflict brief, resolve the merge conflict, and continue merging |
| `fleet shortcut write-spec` | Write a feature spec grounded in scout findings, clarify gaps with the user, and hand off to task decomposition |
<!-- END SHORTCUT DIRECTORY -->

## Guidelines

<!-- BEGIN GUIDELINES DIRECTORY -->
| Command | Purpose |
|---|---|
| `fleet guidelines codebase-research` | Research quality calibration for the orchestrator's scout phase — what makes findings trustworthy enough to route from |
| `fleet guidelines commit-conventions` | Conventional Commits format with scope, body, and multi-agent extensions |
| `fleet guidelines spec-design` | Calibration rules for writing executable feature specs — testability, scope, and agent-readiness |
| `fleet guidelines task-splitting` | Calibration rules for splitting specs into parallel tasks with non-overlapping file ownership |
<!-- END GUIDELINES DIRECTORY -->

## Templates

<!-- BEGIN TEMPLATE DIRECTORY -->
| Command | Purpose |
|---|---|
| `fleet template fleet-yaml` | Annotated config structure for .fleet/fleet.yaml |
| `fleet template plan-spec` | Template for feature planning specification documents |
<!-- END TEMPLATE DIRECTORY -->
