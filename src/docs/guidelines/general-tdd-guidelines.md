---
title: TDD Guidelines
description: Test-Driven Development methodology — Red, Green, Refactor in small slices
---
# Test-Driven Development (TDD) Guidelines

Red, Green, Refactor in small slices. Write one failing test, make it pass, clean up.
Repeat.

## Core Cycle

1. **Red** — Write the simplest failing test that describes a behavior.
2. **Green** — Write only the code needed to pass. No polish, no extras.
3. **Refactor** — Remove duplication, improve names, extract helpers. Only in Green.

## Test Writing

- One failing test at a time. Keep the failure clear and specific.
- Name tests by observable behavior (`should_reject_empty_input`, not `test_validate`).
- Prefer state-based assertions over interaction checks. Only mock at external
  boundaries (network, filesystem, databases).
- Keep tests fast, deterministic, and isolated — no real time, network, or randomness.
- Minimize setup. Use simple helpers/builders when they improve clarity.
- Grow functionality by adding the next smallest behavior-focused test.

## Tidy First

Separate structural changes from behavioral changes:

- **Structural** — rename, extract, move. No behavior change.
- **Behavioral** — add or modify functionality.
- Don't mix them in one commit.
- When both are needed: tidy first, then implement behavior. Run tests before and after.

## Commit Discipline

- Commit only when all tests pass and linters are clean.
- Each commit is a single logical unit. Prefer small, frequent commits.
- State in the message whether the commit is structural or behavioral.
- See `paw guidelines commit-conventions` for message format.

## Practical Workflow

When approaching a new feature:

1. Write a simple failing test for a small part of the feature (Red)
2. Implement the bare minimum to make it pass (Green)
3. Run all tests to confirm (still Green)
4. Refactor if needed, commit structural changes separately
5. Add the next test for the next small increment
6. Repeat until the feature is complete

Always run the full test suite (except slow E2E tests) after each change.

## Related Guidelines

- For test quality rules, see `paw guidelines general-testing-rules`
- For TypeScript-specific patterns, see `paw guidelines typescript-testing-guidelines`
- For commit format, see `paw guidelines commit-conventions`
