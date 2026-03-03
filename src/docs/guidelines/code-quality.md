---
title: Code Quality Rules
description: Rules for clean, maintainable code — duplication, dead code, types, and structure
---
# Code Quality Rules

Flag code that compiles but accumulates maintenance debt. These rules cover what
to look for beyond correctness.

## Duplication

- **Duplicate types**: Flag types that define the same shape. Consolidate or
  alias rather than maintaining parallel definitions.
- **Duplicate code**: Flag repeated logic across files. Three similar blocks
  is a sign something should be extracted.
- **Duplicate components**: Flag UI or utility components that overlap in
  purpose. Reuse beats copy-paste.

## Dead Code

- Flag unreachable branches, unused exports, commented-out blocks, and
  leftover debug code (`console.log`, stray test scripts, temporary helpers).
- If dead code might be genuinely useful later, it should have a TODO
  explaining why it's kept. Otherwise remove it.

## Type Discipline

- **No `any`**: Flag explicit `any` types. Use proper types from data sources
  or let TypeScript infer. Interfaces where most properties are `any` should
  be deleted and replaced with inferred or properly sourced types.
- **Minimize optionals**: Optional fields and parameters are error-prone —
  they get silently dropped during refactors. Flag new optionals and prefer
  explicit nullable parameters. Optional booleans are especially ambiguous
  and should be simple booleans instead.
- **Make illegal states unrepresentable**: Use the type system to prevent
  invalid combinations rather than relying on runtime checks. Flag types
  where construction can produce an invalid instance — validation belongs
  in the constructor or factory, not scattered across call sites.
- **Don't expose mutable internals**: Returning internal arrays, maps, or
  objects by reference lets callers silently break invariants. Return
  copies, read-only views, or immutable types instead.

  ```typescript
  // BAD — caller can mutate internal state
  getItems() { return this.items; }

  // GOOD — defensive copy
  getItems() { return [...this.items]; }
  ```

## Function Hygiene

- **Stale parameters**: Flag function parameters that are unused or left over
  from a previous refactor.
- **Guard early, normalize once**: All optional/conditional logic belongs at
  the top of a function. After early returns and input normalization, the
  remaining code should be straight-line — no repeated null checks or
  conditional branches for the same value.
- **No nested ternaries**: Chained or nested ternary expressions are hard
  to read and debug. Use if/else or switch for multiple conditions.

## Constants

- Flag hard-coded magic numbers and strings that belong in a shared constants
  or settings file. If the project has a `constants.ts` or `settings.ts`,
  values should live there.

## Async Performance

- **N+1 queries**: Flag loops that make individual async calls when a batch
  call or `Promise.all` would work.
- **Sequential awaits**: Flag `for` loops with sequential `await` that could
  run in parallel with `Promise.all`.
