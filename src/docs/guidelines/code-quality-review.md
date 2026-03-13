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
- Confirm comments explain *why*, not *what*. A comment restating the code adds noise;
  a comment explaining a non-obvious business rule or workaround adds value.

## Codebase Consistency

- Compare the diff's patterns against surrounding code. Follow the existing style for
  error handling, file structure, and naming conventions visible in the diff context.
- Check that new code uses the same libraries and utilities already present for the
  same concern — not a parallel implementation.

## Dead Code and Duplication

- Flag unreachable code, unused parameters, and commented-out blocks introduced by the
  diff. Pre-existing dead code outside the diff is not a finding.
- Check for logic duplicated within the diff that could use an existing helper visible
  in the diff context. Duplication across distant modules requires cross-file reasoning
  beyond diff scope — skip it.

## Error Handling Quality

- Verify catch blocks and error callbacks do something meaningful — log, propagate, or
  recover. Swallowed errors (empty catch, catch-and-ignore) are findings.
- Check that error messages include enough context (what failed, with what input) to be
  actionable in logs.
- Verify success messages and completion reports only execute after checking the result
  of the operation they describe. Reporting success without verifying it is a silent
  failure path.

## Severity Calibration

- **CRITICAL** — rare. Reserve for changes that break existing contracts: renamed
  exports without updating consumers, removed public API, or logic errors introduced
  by incorrect patterns.
- **MAJOR** — real maintenance cost: inconsistent naming that makes code unsearchable,
  duplicated logic that will drift, swallowed errors on failure paths, dead code that
  obscures intent.
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

- `MAJOR/quality src/handlers/upload.ts:34 -- empty catch block swallows file-system errors — upload failures will succeed silently with no log or user feedback`
- `MINOR/quality src/utils/format.ts:12 -- redundant comment "formats the date" on formatDate() — comment restates the function name`
- NOT a finding: builder used a for-of loop where the reviewer prefers .map() — both are idiomatic, surrounding code uses both styles
