---
name: decompose-work
description: Decompose a spec into parallel tasks with explicit file ownership and write .paw/paw.yaml
roles: [orchestrator]
---

## Variables

| Variable | Source | Default |
|---|---|---|
| `REQUEST` | User message (required) | — |
| `SPEC_PATH` | Upstream write-spec artifact (implicit) | — |

## Failure Modes

| Mode | Trigger |
|---|---|
| `OVERLAPPING_OWNERSHIP` | Two tasks list the same file or directory in `focus` |
| `IMPLICIT_INTERFACE` | Tasks share data across a boundary with no contract in either prompt |
| `SERIAL_FANOUT` | Spawned parallel Explore agents in separate messages instead of one |
| `VAGUE_PROMPT` | Task prompt lacks concrete deliverable, acceptance criteria, or interface dependencies |
| `HIDDEN_SEQUENCING` | Task cannot start immediately but has no `depends_on` |
| `CONTEXT_STUFFING` | Task prompt embeds research findings instead of pointing to the spec file |
| `SPLIT_TESTS` | Tests decomposed as a separate task instead of colocated with the feature task that owns those files |

## Workflow

### Phase 1: Analyze

**Objective:** Identify file boundaries, shared interfaces, and split points from the 
spec and codebase.
**Tools:** Read, Glob, Grep, Agent (Explore)

1. Read the spec at `SPEC_PATH`. Extract intended changes, constraints, and
   verification criteria.
2. Run targeted exploration for module boundaries, file ownership candidates, and
   shared interfaces. For 1-2 files: read directly. For 3+ files: spawn parallel
   Explore agents in a single message, each targeting one research question. Do not
   re-explore areas the spec already covers.
3. Map each area of change to a file scope owner. Identify interface contracts —
   one task owns the definition, the other consumes it.

**Gate:** Every changed file assigns to exactly one task. Shared interfaces have an
identified producer and consumer.
**Artifact:** File ownership map and interface contracts.

---

### Phase 2: Write

**Objective:** Produce `.paw/paw.yaml` where every task passes the decomposition
quality checklist.
**Tools:** Read, Write, Bash (mkdir only)

1. Load `paw guidelines task-splitting` and `paw template paw-yaml`.
2. Write `.paw/paw.yaml`. For each task:
   - `focus`: explicit file scope — no overlap between tasks.
   - `prompt`: self-contained builder briefing. Include the concrete deliverable,
     interface dependencies (what this task provides to or consumes from other tasks),
     and acceptance criteria. Point to the spec file for shared context — do not embed
     research findings. Use declarative framing for goals, imperative for steps.
     State constraints positively.
   - `depends_on`: set on consumers so they merge after producers.
3. Validate every task against the decomposition quality checklist:
   - [ ] Independently implementable (can start immediately, no hidden dependencies)
   - [ ] Acceptance criteria are machine-verifiable
   - [ ] File scope is explicit (every file has one owner)
   - [ ] Interface contracts are defined (how tasks interact)
   - [ ] Expected output format is specified

**Gate:** Every task passes all five checklist items.
**Artifact:** `.paw/paw.yaml` with decomposed tasks.

## Context Flow

- Upstream (write-spec) → Phase 1: spec file at `SPEC_PATH` with intent,
  constraints, and verification criteria
- Phase 1 → Phase 2: file ownership map, interface contracts, split points

## Stopping Conditions

Stop and report when ANY of these are true:

- `.paw/paw.yaml` written and `paw go` invoked.
- Request is ambiguous with multiple valid interpretations — ask before decomposing.
- Spec is missing or insufficient for decomposition — ask user to complete it.
- File ownership cannot be made non-overlapping — explain the conflict and ask for
  direction.

## Output Format

Present the task breakdown: task names, file ownership, interface contracts, and
dependency order. Run `paw go`.

Forbidden in output:

- Preambles ("I have...", "Let me...", "Based on...", "Here is...")
- Meta-commentary about decomposition methodology
- Reasoning traces that belong in tool calls, not artifacts
