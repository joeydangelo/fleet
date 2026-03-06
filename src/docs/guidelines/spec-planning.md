---
name: spec-planning
description: Principles for designing specs that explore alternatives, define end states, and prevent bolt-on complexity
---
# Spec Planning

A spec is the first artifact in any feature or fix. It defines the end state before
any code is written. Bad specs produce bad code — vague goals, bolt-on designs, and
unbounded scope. Good specs explore alternatives, commit to a clear target, and give
agents enough context to implement faithfully without constant clarification.

This guideline covers what makes a spec good. Task decomposition (splitting spec work
into parallel agent tasks) is covered separately in the `task-decomposition`
guideline.

## Explore Before You Write

Before committing anything to the spec, explore the design space. Read the relevant
code, understand existing patterns, consider multiple approaches, and form an opinion
on which fits best given the codebase architecture, the reason for the feature, and
the constraints at hand.

When the right approach isn't obvious, present the user with a brief comparison of
viable options — tradeoffs, fit with existing patterns, and your recommendation with
reasoning. Let the user decide. This exploration happens in conversation, not in the
spec itself.

The spec records the chosen direction. It doesn't catalog rejected alternatives or
document the deliberation process. A clean spec is a source of truth for what to
build, not a history of how the decision was made.

## Data Structures and System Shape First

Get the data model right before describing behavior. The right structure makes
downstream logic obvious; the wrong one fights you at every turn. A spec that jumps
straight to feature behavior without defining the underlying types and data flow is
building on sand.

A good spec addresses structural decisions early:
- **Core types and data models.** Define them explicitly. These are the foundation
  everything else builds on.
- **Access patterns.** How will data be read, written, iterated, and looked up? The
  data structure should match the dominant access pattern, not just the simplest
  representation.
- **Scaffolding.** If something benefits all subsequent work (shared types, config
  schema, directory structure), call it out as a prerequisite. Scaffold before
  features — not after.

## Anchor on the Target Experience

A spec should describe the end state from the user's perspective before diving into
how it's built. What does the user see? What do they type? What feedback do they get?
Technical decisions exist to serve this experience, not the other way around.

This means specs for user-facing work should lead with behavior: CLI output, UI flow,
error messages, the core interaction loop. Implementation details follow as the
mechanism that delivers that experience. When a tradeoff exists between implementation
convenience and user experience, the spec should favor the experience and let the
implementation adapt.

Specs for internal or infrastructure work still benefit from this framing — the "user"
is the developer or the consuming system. What does the API look like from the
caller's side? What does the config file look like to someone editing it? Start there.

## Simplify Before You Build

Before proposing additions, identify what can be removed. Dead code, unused features,
unnecessary abstractions, and speculative edge-case handling all add surface area that
makes the new work harder. A spec that starts with "remove X, Y, Z" before "add A, B,
C" produces a simpler substrate for the new feature to land on.

This applies to scope too. Cut ruthlessly to the minimum viable behavior before
investing in polish or edge cases. Design for observed usage patterns, not hypothetical
ones — add complexity only when real usage demands it.

## Redesign, Don't Bolt On

When a spec introduces a new requirement into an existing system, don't design it as
a patch. Ask: "If we'd known about this requirement from the start, what would we have
built?" The spec should describe that target state — the most natural design that
incorporates the new requirement holistically.

This means reading all affected code and understanding the current design before
writing the spec. A bolt-on spec produces bolt-on code: special cases, feature flags,
and awkward seams that accumulate into a system nobody can reason about. A
first-principles spec produces code that reads like the requirement was always there.

## Define the End State, Not Every Step

A spec should be precise about *where you're going* and flexible about *how you get
there*. Over-constraining intermediate steps robs agents of the ability to find better
paths during implementation. Under-defining the end state leaves "done" ambiguous.

Describe the target architecture, the final behavior, the types, and the invariants
that must hold. Let the implementing agent choose the sequence of commits, the order
of refactoring, and the intermediate states — that's execution, not planning.

## Scope Explicitly

Without explicit boundaries, work expands to fill available resources. A spec that
says "improve error handling" without defining which modules, which error paths, and
what "improved" looks like is an invitation for unbounded work.

Every spec should make scope clear:
- **What's in.** The specific files, modules, or behaviors being changed.
- **What's out.** Adjacent concerns that are explicitly deferred. Naming what you're
  *not* doing is as important as naming what you are.
- **How big is this.** A rough sense of magnitude — is this a single-file change, a
  multi-module refactor, or a new subsystem? This informs task decomposition and
  helps catch specs that are trying to do too much.

## Identify System Boundaries

A spec should call out where data enters and leaves the system. These boundaries —
CLI args, API endpoints, config files, external services — are where validation,
error handling, and type narrowing live. Everything inside the boundary can trust
its inputs.

When a spec doesn't identify boundaries, agents scatter defensive checks throughout
the implementation. The result is noisy, redundant code that validates the same data
multiple times. A good spec names the boundaries explicitly so agents know: validate
here, trust everywhere else.

## Define How to Verify It

Every spec needs a verification plan. Without one, "done" is undefined and agents
will either stop too early or gold-plate indefinitely.

A verification plan answers: **"How do we prove this actually works?"** Not "it
compiles" or "tests pass" — those are necessary but not sufficient. The plan should
describe how to exercise the real feature path end-to-end and confirm the intended
behavior.

For most specs this is straightforward:
- **New features:** What commands to run, what output to expect, what state changes
  to confirm.
- **Bug fixes:** How to reproduce the original bug and verify it no longer occurs.
- **Refactors:** What existing tests must still pass, and what behavioral invariants
  to spot-check.

## Target Root Causes, Not Symptoms

Specs for bug fixes or improvements should trace the problem to its root cause and
fix it there. A spec that says "add a guard to prevent the crash" is a symptom fix.
A spec that says "the config parser doesn't validate X, which allows invalid state
to propagate to Y" targets the root cause.

Before writing a fix spec, reproduce the problem and ask "why" until you hit
structural bedrock. If the same pattern exists elsewhere in the codebase, the spec
should address all instances — or better, make the pattern structurally impossible.

## How to Express Spec Content

Match the format to what you're communicating. A good spec blends multiple formats,
each carrying the part of the message it's best suited for.

**Prose** — for intent, goals, and user-facing behavior. Use when the "why" matters as
much as the "what," or when covering error handling philosophy and UX decisions.

**Pseudocode** — for logic with branching, loops, or sequencing that's ambiguous in
prose. Use when specifying algorithms, data transformations, or when the exact order
of operations matters.

**Data shapes and schemas** — for defining the structure of types, configs, API
payloads, or database records. A TypeScript interface or YAML example eliminates
ambiguity that prose can't. These are the concrete artifact of getting data structures
right — show the shape, don't just describe it.

**State diagrams and lifecycle definitions** — for entities with discrete states and
transitions. When something moves through a lifecycle (`pending` → `running` →
`done`), prose gets tangled describing all valid paths. A transition table or Mermaid
state diagram makes legal transitions explicit and illegal ones obvious by omission.

**Edge case tables** — for specific inputs or states that need defined behavior. Use
when the boundary between "expected" and "error" needs to be drawn precisely, or when
multiple edge cases interact in non-obvious ways.

Don't pick one format and force everything into it. A spec section might open with a
prose paragraph explaining the goal, show a type definition for the data shape, drop
into pseudocode for the core logic, and close with a table of edge cases and their
expected behavior.

## When to Stop and Get the Human

Agents should bias toward action for reversible work — read files, explore the
codebase, form opinions, draft content. Don't ask permission to research. But spec
planning is where product direction gets decided, and product direction belongs to the
human.

**Agent decides (proceed without asking):**
- What files to read, what code to explore, what context to gather
- Implementation details: code structure, patterns, naming conventions
- How to express spec content (which format, level of detail)

**Human decides (pause, present options, get input):**
- Which approach to take when multiple viable alternatives exist
- Scope tradeoffs that affect what gets built or deferred
- Priorities when goals conflict with each other

**Surface immediately:**
- Scope surprises — research reveals the work is significantly larger or more
  entangled than expected
- Conflicting requirements — two goals in the request contradict each other
- Missing context — the agent can't form a reasonable opinion without information
  only the human has

The goal is to do the legwork autonomously, form an informed recommendation, and
pause at product-level forks where the human's judgment matters. Don't block on
decisions the agent can make. Don't make decisions the agent shouldn't.

