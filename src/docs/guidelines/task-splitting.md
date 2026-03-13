---
name: task-splitting
description: Calibration rules for splitting specs into parallel tasks with non-overlapping file ownership
roles: [orchestrator]
---

The core tension is parallelism vs. coordination overhead. More tasks increase
throughput but add merge risk, interface contracts, and decomposition effort. Fewer
tasks reduce overhead but create serial bottlenecks. Right-size to design throughput —
10 well-fed agents outperform 30 starving agents.

## File Ownership

- Assign every changed file to exactly one task. Explicit file ownership eliminates
  merge conflicts and removes coordination overhead between builders.
- When a file serves multiple tasks, designate one task as owner and make the others
  consumers via `depends_on`. The owner merges first; consumers merge against the
  owner's changes.
- When cross-cutting changes span many files, assign them to one task rather than
  scattering partial edits across several tasks. A single owner for a cross-cutting
  concern is cleaner than shared ownership with contracts.

## Interface Contracts

- When tasks share a boundary, state the contract explicitly in both task prompts —
  the producer's prompt names what it exports, the consumer's prompt names what it
  imports.
- One task owns the definition (types, schemas, API surface); the other consumes it.
  Set `depends_on` so the consumer merges after the producer.
- Point both prompts to the spec file for shared context. Embedding research findings
  in prompts creates drift between tasks that should agree on the same design.

## Task Sizing

- Each task represents a meaningful independent unit — a module, a service boundary,
  a layer in the stack. Split along natural seams in the codebase, not along
  arbitrary line counts.
- Colocate tests with their feature task. The task that owns `src/foo.ts` also owns
  `src/foo.test.ts`. Separating tests into a different task splits files that change
  together.
- Front-load architectural decisions into producer tasks (schemas, types, interfaces)
  so consumer tasks can start from stable contracts. Ambiguity in shared definitions
  cascades failures across every consumer.

## Decision Criteria

- **Split** when two areas of change touch different files, have no shared interface,
  and can be verified independently.
- **Split with `depends_on`** when two areas touch different files but share an
  interface — the producer defines it, the consumer imports it.
- **Combine** when two areas modify the same files, or when the interface between them
  is so tight that separating them would require more contract specification than the
  implementation itself.
- **Reduce task count** when decomposition effort exceeds the parallelism benefit —
  a 2-task split that takes 10 minutes to specify saves nothing over a single task.
