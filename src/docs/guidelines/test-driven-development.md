---
name: general-tdd-guidelines
description: Red-Green-Refactor cycle, test-first methodology, and TDD workflow rules
---
# Test-Driven Development (TDD)

## Overview

Write the test first. Watch it fail. Write minimal code to pass.

**Core principle:** If you didn't watch the test fail, you don't know if it
tests the right thing.

**Use for:** new features, bug fixes, refactoring, behavior changes.

**Skip for:** throwaway prototypes, generated code, configuration files.

If you wrote production code before a test, delete it and start fresh from a
failing test. Don't keep it as "reference" — you'll adapt instead of
test-driving.

## Red-Green-Refactor

### RED — Write Failing Test

Read the requirement (feature request, bug report, spec). Translate it into a
test — don't start coding. Tests-first answer "what *should* this do?" while
tests-after only answer "what *does* this do?" — you get coverage but lose
proof the tests actually catch bugs.

Write one minimal test showing what should happen. Avoid heavy mocking — if
you need it, run `paw guidelines testing-anti-patterns` first.

<Good>
```typescript
test('retries failed operations 3 times', async () => {
  let attempts = 0;
  const operation = () => {
    attempts++;
    if (attempts < 3) throw new Error('fail');
    return 'success';
  };

  const result = await retryOperation(operation);

  expect(result).toBe('success');
  expect(attempts).toBe(3);
});
```
Clear name, tests real behavior, one thing
</Good>

<Bad>
```typescript
test('retry works', async () => {
  const mock = jest.fn()
    .mockRejectedValueOnce(new Error())
    .mockRejectedValueOnce(new Error())
    .mockResolvedValueOnce('success');
  await retryOperation(mock);
  expect(mock).toHaveBeenCalledTimes(3);
});
```
Vague name, tests mock not code
</Bad>

**Requirements:**
- One behavior
- Clear name
- Real code (no mocks unless unavoidable)

### Verify RED — Watch It Fail

```bash
npm test path/to/test.test.ts
```

Confirm:
- Test fails (not errors)
- Failure message is expected
- Fails because feature missing (not typos)

**Test passes?** You're testing existing behavior. Fix test.

**Test errors?** Fix error, re-run until it fails correctly.

### GREEN — Minimal Code

Write simplest code to pass the test.

<Good>
```typescript
async function retryOperation<T>(fn: () => Promise<T>): Promise<T> {
  for (let i = 0; i < 3; i++) {
    try {
      return await fn();
    } catch (e) {
      if (i === 2) throw e;
    }
  }
  throw new Error('unreachable');
}
```
Just enough to pass
</Good>

<Bad>
```typescript
async function retryOperation<T>(
  fn: () => Promise<T>,
  options?: {
    maxRetries?: number;
    backoff?: 'linear' | 'exponential';
    onRetry?: (attempt: number) => void;
  }
): Promise<T> {
  // YAGNI
}
```
Over-engineered
</Bad>

Don't add features, refactor other code, or "improve" beyond the test.

### Verify GREEN — Watch It Pass

```bash
npm test path/to/test.test.ts
```

Confirm:
- Test passes
- Other tests still pass
- Output pristine (no errors, warnings)

**Test fails?** Fix code, not test.

**Other tests fail?** Fix now.

### REFACTOR — Clean Up

After green only. One refactoring at a time, keep steps reversible.

- Remove duplication
- Improve names
- Extract helpers
- Apply known refactoring patterns (extract method, inline variable, etc.)

Re-run tests after each refactor. Keep tests green. Don't add behavior.

### Repeat

Next failing test for next feature.

## Good Tests

| Quality | Good | Bad |
|---------|------|-----|
| **Minimal** | One thing. "and" in name? Split it. | `test('validates email and domain and whitespace')` |
| **Clear** | Name describes behavior | `test('test1')` |
| **Shows intent** | Demonstrates desired API | Obscures what code should do |

## Design for Testability

Code that's hard to test is hard to use. These design principles make TDD natural:

- **Prefer pure functions.** Given the same input, return the same output. No hidden state.
- **Keep dependencies explicit.** Pass collaborators in rather than reaching out for them.
  Use dependency injection where needed.
- **Contain side effects at boundaries.** Push I/O, network calls, and filesystem access to
  the edges. Keep core logic pure and testable without mocks.
- **Use the simplest solution that works.** Premature abstractions make tests harder to write
  and harder to read.

If you find yourself needing heavy mocking, that's a design signal — simplify the interface.

## Example: Bug Fix

Bug found? Write a failing test reproducing it, then follow the cycle. The test
proves the fix and prevents regression.

**Bug:** Empty email accepted

**RED**
```typescript
test('rejects empty email', async () => {
  const result = await submitForm({ email: '' });
  expect(result.error).toBe('Email required');
});
```

**Verify RED**
```bash
$ npm test
FAIL: expected 'Email required', got undefined
```

**GREEN**
```typescript
function submitForm(data: FormData) {
  if (!data.email?.trim()) {
    return { error: 'Email required' };
  }
  // ...
}
```

**Verify GREEN**
```bash
$ npm test
PASS
```

**REFACTOR**
Extract validation for multiple fields if needed.

## When Stuck

| Problem | Solution |
|---------|----------|
| Test too complicated | Design too complicated. Simplify interface. |
| Must mock everything | Code too coupled. Use dependency injection. |
| Test setup huge | Extract helpers. Still complex? Simplify design. |
