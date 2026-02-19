---
title: General Testing Rules
description: Rules for writing minimal, effective tests with maximum coverage
---
# General Testing Rules

Write the fewest tests that cover the most behavior. Every test should justify its
existence.

## Core Rules

- **Minimize tests, maximize coverage.** If you see many similar tests, check whether
  any can be removed or consolidated without reducing coverage.

- **Don't test the obvious.** Skip tests that just instantiate an object and check its
  fields are set. These clutter the codebase and catch nothing.

- **Don't duplicate coverage.** If a behavior is already tested as part of another test
  in the same codebase, don't write a separate test for it.

- **Test behavior, not implementation.** Focus on outcomes, not internal mechanics.
  Tests should remain valid when you refactor.

- **Test edges and boundaries.** Empty inputs, nulls, maximums, minimums, error
  conditions. Not just the happy path.

## Test Types

1. **Unit** — fast, focused tests for small units of business logic. No network, no
   filesystem. Run in CI.

2. **Integration** — exercise multiple components together. Mock external APIs but test
   real interactions between internal modules. Run in CI.

3. **E2E** — test real system behavior with live services. Not run on every commit
   (can be slow, have costs, or cause side effects).

## Finding Tests

When working in an existing codebase:
- Check for an existing `tests/` or `__tests__/` directory
- Look at `package.json` scripts for the test runner (vitest, jest, pytest, etc.)
- Follow the project's existing patterns for test location and naming

## Related Guidelines

- For TDD methodology, see `paw guidelines general-tdd-guidelines`
- For TypeScript-specific patterns, see `paw guidelines typescript-testing-guidelines`
