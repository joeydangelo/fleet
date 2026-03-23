---
name: <shortcut-name>
description: <What this shortcut accomplishes — verb phrase.>
roles: [orchestrator, builder, reviewer]
---

## Variables

| Variable | Source | Default |
|---|---|---|
| `VAR_NAME` | `$1` (required) | — |

## Failure Modes

| Mode | Trigger |
|---|---|
| `MODE_NAME` | <What the agent did wrong — concrete, observable.> |

## Workflow

### Phase 1: <Name>

**Objective:** <Measurable goal for this phase.>
**Tools:** <Minimal tool set — e.g., Read, Glob, Grep>

1. <Imperative step with concrete action.>
2. <Imperative step with concrete action.>

**Gate:** <Machine-verifiable condition before proceeding.>
**Artifact:** <What this phase produces and where — e.g., `docs/specs/$TASK_ID.md`>

---

### Phase 2: <Name>

**Objective:** <Measurable goal for this phase.>
**Tools:** <Minimal tool set>

1. <Imperative step.>
2. <Imperative step.>

**Gate:** <Machine-verifiable condition.>
**Artifact:** <Output path.>

## Stopping Conditions

Stop and report when ANY of these are true:

- <Binary condition — e.g., all tests pass.>
- <Binary condition — e.g., 3 retries exhausted for the same error.>
- <Binary condition — e.g., scope exceeded original request.>

## Output Format

<Exact structure the shortcut must produce. Specify format (markdown, YAML, JSON).>

Forbidden in output:

- Preambles ("I have...", "Let me...", "Based on...", "Here is...")
- Meta-commentary about what the agent is doing
- Reasoning that belongs in tool calls, not artifacts
