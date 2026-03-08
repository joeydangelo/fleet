---
name: test-quality
description: Write the fewest tests that cover the most behavior — no trivial or duplicate tests
roles: [builder, reviewer]
---
# Test Quality

Every test should justify its existence. Write the fewest tests that cover
the most behavior.

## Core Rules

- **Minimize tests, maximize coverage.** Similar tests that overlap in what
  they exercise should be consolidated or removed.
- **Test behavior, not implementation.** Focus on outcomes. Tests that break
  on every refactor are testing the wrong thing.
- **Test edges and failure paths.** Empty inputs, nulls, boundary values,
  error conditions, and rejection paths — not just the happy path.

## Trivial Test Patterns

Flag tests that match these — they add maintenance cost without meaningful
coverage:

- **Object construction**: Instantiates a class/object and checks fields
  match the values just passed in.
- **Identity assertions**: `expect(obj.name).toBe('test')` right after
  `const obj = { name: 'test' }`.
- **Declared-value checks**: Validates that a constant equals what it was
  set to.
- **Implementation coupling**: Tests internal mechanics rather than behavior,
  making them brittle to any refactor. Common forms: mocking three layers
  deep, asserting on method call order, checking internal state instead of
  observable output.
- **Duplicate coverage**: Tests something already exercised by another test
  in the same codebase.

## What to Keep

- Edge cases and boundaries (empty, null, max, min, error conditions)
- Behavior that would silently break without the test
- Integration between components
- Error handling and failure modes
- Unique coverage not provided by other tests
