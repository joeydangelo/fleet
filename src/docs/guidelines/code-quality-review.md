---
name: code-quality-review
description: Code quality and maintainability calibration for code review
roles: [reviewer]
---

The core tension is signal vs. noise — code quality is the broadest review domain and
the most subjective. Every finding must identify a maintenance cost, not a style
preference. Flag patterns that will hurt the next developer who reads this code, not
code you would have written differently.

## Naming and Readability

- Verify names describe what the thing *is* or *does*, not how it's implemented. A
  name that forces the reader to check the implementation to understand call sites is
  a finding.
- Check that similar concepts use consistent names across the diff. A type called
  `User` in one file and `Account` for the same concept in another makes code
  unsearchable.

## Codebase Consistency

- Compare the diff's patterns against surrounding code. Follow the existing style for
  error handling, file structure, and naming conventions visible in the diff context.
- Check that new code uses the same libraries and utilities already present for the
  same concern — not a parallel implementation.
- Match the abstraction level of surrounding code. A new wrapper class where
  neighboring code uses direct calls, or a new utility for a one-time operation,
  introduces complexity the codebase doesn't use.

## Control Flow

- Check that conditions exit early rather than wrapping the remainder in else
  branches — deeply nested logic with multiple indentation levels is a finding.
- Flag nested ternaries and complex conditional expressions that require
  re-reading to parse — guard clauses and switch/if-else are preferred.
- Verify functions serve a single purpose — a function with comment-separated
  sections doing unrelated work should be split.

## Dead Code and Duplication

- Flag unreachable code, unused parameters, and commented-out blocks introduced by the
  diff. Pre-existing dead code outside the diff is not a finding.
- Check for logic duplicated within the diff that could use an existing helper visible
  in the diff context. Duplication across distant modules requires cross-file reasoning
  beyond diff scope — skip it.

## Type Design

- Verify new types enforce their invariants at construction time rather than relying on
  callers to supply valid state. A type that can be instantiated in an invalid
  configuration is a bug waiting for a new call site.
- Check that mutable types guard all mutation points against invalid state transitions.
  A setter or method that accepts any value without validation undermines the type's
  contract.

## Comment Accuracy

- Verify comments and docstrings match the current implementation — parameters, return
  types, described behavior, and referenced functions. A stale comment that contradicts
  the code is worse than no comment.
- Flag changelog-style comments that narrate what changed rather than describing the
  current state ("removed old auth flow", "refactored from X to Y", "previously this
  used Z"). History belongs in git, not in source files.
- Check for references to renamed or removed code — function names, variable names,
  file paths, or module names that no longer exist. Outdated references send readers
  searching for code that isn't there.
- Confirm comments explain *why*, not *what*. A comment restating the code adds noise;
  a comment explaining a non-obvious business rule or workaround adds value.

## Severity Calibration

- **CRITICAL** — rare. Reserve for changes that break existing contracts: renamed
  exports without updating consumers, removed public API, or logic errors introduced
  by incorrect patterns.
- **MAJOR** — real maintenance cost: inconsistent naming that makes code unsearchable,
  duplicated logic that will drift, stale comments that contradict code, dead code that
  obscures intent, types constructable in invalid states.
- **MINOR** — style preferences: verbose-but-clear code, acceptable-but-not-ideal
  names, redundant comments.
- **Not a finding** when code works, reads clearly, and follows codebase conventions —
  even if you would have written it differently.

## False Positive Checks

- **Trace the pattern before filing.** Confirm the surrounding code actually establishes
  the pattern you claim the diff violates. "Inconsistent" requires a visible baseline.
- **Respect linter territory.** Builders run lint and typecheck. Formatting, unused
  imports, and type errors are already caught — skip them.
- **Different is not wrong.** Two valid approaches to the same problem are not a
  finding. Flag only when the diff contradicts a pattern visible in the surrounding code.

## Examples

- `MAJOR/quality src/models/order.ts:22 -- Order type accepts negative quantity at construction — caller must validate, no invariant enforcement`
- `MINOR/quality src/utils/format.ts:12 -- redundant comment "formats the date" on formatDate() — comment restates the function name`
- NOT a finding: builder used a for-of loop where the reviewer prefers .map() — both are idiomatic, surrounding code uses both styles
