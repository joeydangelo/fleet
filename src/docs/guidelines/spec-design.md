---
name: spec-design
description: Calibration rules for writing executable feature specs — testability, scope, and agent-readiness
roles: [orchestrator]
---

A spec is a contract agents execute from, not documentation written after the fact.
The core tension is precision vs. flexibility: a spec too precise prescribes
implementation steps and is harder to maintain than code; a spec too vague is
unexecutable — agents cannot generate correct code from it. Calibrate every statement
to be testable without dictating the implementation path.

## Testability

- Make every statement verifiable. If you cannot test whether the spec was followed,
  the statement is too vague — add a concrete example, a type definition, or a
  behavioral constraint.
- Write verification criteria as behavioral truths ("the API returns 404 for missing
  resources"), not vague goals ("error handling is improved"). Use the `must_haves`
  pattern: `truths` (behavioral assertions), `artifacts` (files that must exist),
  `key_links` (issue and PR traceability).
- Define success criteria before writing the intent section. Goal-backward
  verification prevents scope expansion — without it, implementations drift beyond
  the original request.

## Scope and Grounding

- Reference concrete file paths confirmed by exploration. Hypothetical paths that
  do not exist in the codebase cause agents to create wrong structures.
- State scope boundaries explicitly: what is in, what is deferred, what is a
  non-goal. Unstated boundaries expand under agent interpretation.
- Ground architectural decisions in research findings, not assumptions. Cite specific
  code patterns, existing interfaces, and module boundaries discovered during
  exploration. A spec that references "the existing auth module" without a file path
  is ungrounded.
- Front-load architectural choices — data structures, module boundaries, interface
  contracts. Ambiguity in architecture cascades across parallel agents.

## Agent Executability

- Capture intent and constraints, not line-by-line implementation. Specify the end
  state and the invariants that hold; leave implementation sequence and intermediate
  steps to builder judgment.
- Include enough context that downstream consumers — decomposition, review, or
  implementation — can proceed without re-researching the codebase. Name dependencies,
  interface contracts, and file scope in the spec or link them by path.
- Provide 2-3 concrete examples when the spec describes a pattern or format. Examples
  anchor correct output without over-constraining approach. Trust agents to generalize
  from examples to edge cases.

## Precision Calibration

- **Precise enough** when every statement has a verifiable outcome — you can write a
  test or run a command to check compliance.
- **Too precise** when the spec prescribes implementation steps, function signatures
  the agent could derive, or file-level sequencing. If removing a statement would not
  change whether the outcome is correct, the statement over-specifies.
- **Constrain** interfaces, data shapes, behavioral invariants, and scope boundaries.
  **Leave to builder** implementation order, internal naming, intermediate
  abstractions, and error handling strategy within stated constraints.
