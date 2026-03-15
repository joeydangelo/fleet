---
name: write-spec
description: Write a feature spec grounded in scout findings, clarify gaps with the user, and hand off to task decomposition
roles: [orchestrator]
---

## Variables

| Variable | Source | Default |
|---|---|---|
| `REQUEST` | User message (required) | — |
| `SCOUT_CONTEXT` | Upstream assess-work findings (implicit) | — |
| `SPEC_PATH` | derived | `.fleet/specs/spec-YYYY-MM-DD-feature-name.md` |

## Failure Modes

| Mode | Trigger |
|---|---|
| `REDUNDANT_RESEARCH` | Re-explored codebase areas already covered by upstream research |
| `VAGUE_SPEC` | Spec contains untestable statements with no concrete examples or type definitions |
| `OVER_SPECIFICATION` | Spec prescribes implementation steps instead of intent, constraints, and end state |
| `SILENT_DECISION` | Made a high-stakes or irreversible decision without presenting options via `AskUserQuestion` |
| `UNGROUNDED_PATHS` | Spec references hypothetical file paths not confirmed by exploration |

## Workflow

### Phase 1: Clarify

**Objective:** Resolve ambiguities the user must decide before spec writing begins.
**Tools:** Read, Glob, Grep, Agent (Explore), AskUserQuestion

1. Identify what blocks spec writing: unresolved approach choices, unclear scope
   boundaries, missing context only the user has.
2. Run targeted exploration for any codebase knowledge gaps. Do not re-explore
   areas already covered by upstream research.
3. Use `AskUserQuestion` for each genuine ambiguity, presenting a recommendation
   with reasoning. Ask when: request is ambiguous with multiple valid
   interpretations, change has significant consequences, or critical context is
   missing. Proceed when: choice is stylistic, assumption is verifiable, action
   is reversible.
4. Skip this phase if the request and available context are unambiguous.

**Gate:** High-stakes and irreversible decisions resolved. Can define system
boundaries and verification criteria from known findings.
**Artifact:** Resolved decisions and research findings in context.

---

### Phase 2: Write

**Objective:** Produce a spec file that downstream agents can execute from without
clarification.
**Tools:** Read, Write, Bash (mkdir only)

1. Load `fleet guidelines spec-design` and `fleet template plan-spec`.
2. Write the spec to `SPEC_PATH`. Fill each section grounded in research findings
   and Phase 1 decisions:
   - Make every statement testable. Add concrete examples and constraints.
   - **Verification criteria.** What commands to run, what output to expect, what
     state to confirm. Include behavioral truths the implementation must satisfy.
   - Reference concrete file paths from exploration, not hypothetical ones.
   - Capture intent and constraints, not line-by-line implementation. Leave room
     for agent judgment on implementation sequence.

**Gate:** Spec contains testable statements and verification criteria.
**Artifact:** Spec file at `SPEC_PATH`.

---

### Phase 3: Review

**Objective:** Human approves the spec as the approval artifact before implementation.
**Tools:** AskUserQuestion

1. Present the spec to the user. Walk through key design decisions, scope boundaries
   (what's in vs. out), and any remaining uncertainties.
2. Self-check before presenting: Are completion criteria testable? Are ambiguities
   resolved? Are dependencies documented? Can a downstream agent execute from this
   artifact?
3. Iterate on feedback until the user approves.

**Gate:** User confirms spec is testable, complete, and executable.
**Artifact:** Approved spec at `SPEC_PATH`.

---

### Phase 4: Decompose

**Objective:** Transition to parallel task decomposition.

1. Run `fleet shortcut decompose-work`.
2. The spec at `SPEC_PATH` becomes the primary input for decomposition.

**Gate:** `decompose-work` invoked with `SPEC_PATH`.
**Artifact:** Task breakdown produced by `decompose-work`.

## Context Flow

- Upstream (assess-work) → Phase 1: file scope, module count, shared interfaces,
  constraints, domain risk areas
- Phase 1 → Phase 2: resolved decisions, additional research findings
- Phase 2 → Phase 3: spec file at `SPEC_PATH`
- Phase 3 → Phase 4: approved spec

## Stopping Conditions

Stop and report when ANY of these are true:

- Spec approved by user and decompose-work invoked.
- Request is ambiguous with multiple valid interpretations — ask before writing.
- Scope exceeds the original request — confirm with user before proceeding.
- Information required that only the user can provide.

## Output Format

Phase 3 presents the spec with a brief walkthrough of design decisions and scope
boundaries. No separate summary artifact — the spec file is the output.

Forbidden in output:

- Preambles ("I have...", "Let me...", "Based on...", "Here is...")
- Meta-commentary about spec methodology
- Reasoning traces that belong in tool calls, not the spec artifact
