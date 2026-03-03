---
title: Error Handling Rules
description: Rules for handling errors, failures, and exceptional conditions
---
# Error Handling Rules

Errors "handled" in ways that satisfy the type checker but don't inform anyone
are the most common source of silent failures.

## Principles

### Failure paths are part of the feature

An operation that can fail has two behaviors: success and failure. If only
success is implemented, the feature isn't done. The failure path needs clear
messaging, correct exit codes, and actionable guidance.

**Litmus test**: Can a user diagnose and recover from every failure mode
without reading source code?

### Verify success before claiming it

Result types, status codes, and partial failures don't throw — they silently
continue. Always check before reporting success:

```typescript
const result = await operation();
if (!result.success) {
  console.error(`Failed: ${result.error}`);
  return;
}
console.log('Done!');  // Only reached after verified success
```

"Done" means "I checked, and it worked."

### Track state explicitly

Don't infer success from the absence of failure. Track outcomes with explicit
variables — more verbose, but the compiler forces you to handle both states:

```typescript
pullSucceeded = await pull();
pushSucceeded = await push();

if (pullSucceeded && pushSucceeded) {
  console.log('Sync complete');
} else {
  console.log('Sync incomplete');
}
```

### Choose throw vs Result by recoverability

Pick based on what the caller can do:

| Failure Type | Pattern | Why |
| --- | --- | --- |
| Caller cannot recover | `throw` | Forces handling, can't be ignored |
| Caller might retry or degrade | `Result<T>` | Makes recovery explicit |
| Should never happen | `throw` / assertion | Fail fast, debug fast |

For CLI tools, most failures should throw or exit.
Result types are better for library code where the caller has recovery options.

### Logging is not handling

After any error log, there must be a control flow change (`throw`, `return`,
`exit`) or explicit user notification. If execution continues past a
`logger.warn(error)`, the error is swallowed.

### Exit codes are contracts

- `0` = all operations succeeded. Non-zero = at least one failed.
- Partial success exits non-zero. Be explicit about what succeeded and what
  didn't.

### Test error behavior

Every operation that can fail needs a test that makes it fail, verifies the
user sees an error, and checks the exit code (for CLIs). These tests catch
the bugs that matter most — where the system lies about its state.

### Classify errors as transient or permanent

Make retriability explicit in error types:

| Error Type | Examples | Retry? | User Action |
| --- | --- | --- | --- |
| **Transient** | Network timeout, rate limit, 503 | Yes | Wait and retry |
| **Permanent** | 404, invalid input, auth failure | No | Fix the problem |

```typescript
// ✅ GOOD: Error types encode retriability
class TransientError extends Error {
  readonly retryable = true;
  constructor(message: string, public retryAfterMs?: number) {
    super(message);
  }
}

class PermanentError extends Error {
  readonly retryable = false;
}

// Caller can make informed decisions
if (error.retryable) {
  await sleep(error.retryAfterMs ?? 1000);
  return retry();
} else {
  throw error;  // Don't retry, surface to user
}
```

Without this distinction, code either retries permanent failures (wasting time)
or gives up on transient ones (losing resilience).

## Anti-Patterns

Patterns that lead to silent failures. Flag these in review.

### Debug-only error handling

Error logged to debug level, invisible to users. The type checker is
satisfied, but the user sees nothing.

```typescript
// BAD — error hidden from user
if (!result.success) {
  this.output.debug(`Operation failed: ${result.error}`);
}

// GOOD — user-visible output + control flow change
if (!result.success) {
  this.output.error(`Operation failed: ${result.error}`);
  return;
}
```

### Optimistic success messages

Success reported without checking that all operations actually succeeded.
Result types don't throw on failure — they silently continue.

```typescript
// BAD — push may have returned { success: false }
await pull();
await push();
console.log('Sync complete!');

// GOOD — guard success messages
const pullOk = await pull();
const pushOk = await push();
if (pullOk && pushOk) {
  console.log('Sync complete!');
} else {
  console.error('Sync incomplete. See errors above.');
  process.exit(1);
}
```

### Empty catch blocks

Exception caught and silently ignored. Either handle meaningfully or re-throw.

```typescript
// BAD — error swallowed
try { await riskyOperation(); } catch (e) { }

// GOOD — handle or re-throw
try {
  await riskyOperation();
} catch (e) {
  if (isExpectedError(e)) return fallbackValue;
  throw e;
}
```

### Catch-and-continue

Error caught and logged, but execution continues as if nothing happened.
The system is now in an inconsistent state.

```typescript
// BAD — logs but continues to lie about success
try { await saveToDatabase(); }
catch (e) { logger.error('Save failed:', e); }
await notifyUser('Save complete!');

// GOOD — error changes control flow
try {
  await saveToDatabase();
} catch (e) {
  logger.error('Save failed:', e);
  await notifyUser('Save failed. Please retry.');
  return;
}
await notifyUser('Save complete!');
```

### Inferring success from side effects

Deriving success from whether a message was built, a variable was set, or
some other indirect signal. Any code path that forgets to update the side
effect falsely indicates success. Track outcomes with explicit booleans.

### Ignored Result types

Function returns `{ success: boolean }` but the caller discards it.
TypeScript doesn't require you to use return values, so this compiles
silently. Always check Result types — or use `throw` for operations where
ignoring failure would be catastrophic.

### Default success returns

Function returns `{ success: true }` at the bottom, only guarding specific
failure branches. Any unhandled failure path falls through to success. Prefer
throwing on failure so reaching the end of the function proves success.

### Losing exception context

Re-throwing as `new Error(e.message)` discards status codes, headers,
request IDs, and the original stack. Use `Error.cause` (ES2022) to chain
errors, or wrap with type-specific details:

```typescript
// BAD — loses provider, status, request ID
throw new Error(`API call failed: ${e.message}`);

// GOOD — preserve context
throw new ProviderError('OpenAI chat failed', {
  cause: e,
  provider: 'openai',
  status: e.status,
  requestId: e.headers?.['x-request-id'],
});
```

### Catch-and-replace with generic error

Catching an exception and throwing `new CLIError('Failed to read issues')`
discards the actual cause (e.g., a YAML parse error from merge conflict
markers). Let errors propagate, or include the original message:

```typescript
// BAD — bare catch discards the real error
} catch {
  throw new CLIError('Failed to read issues');
}

// GOOD — preserve the original
} catch (error) {
  const msg = error instanceof Error ? error.message : String(error);
  throw new CLIError(`Failed to load data: ${msg}`, { cause: error });
}
```

Individual catch blocks should not replace errors unless adding genuinely
useful context. The central error handler is the right place for stack traces
and debug info.

### Optional chaining hiding failures

A `result?.data?.items` chain silently produces `undefined` when something
upstream broke. Flag optional chaining on values that should always exist
after a successful operation — it masks the failure instead of surfacing it.

### Overly broad catch blocks

Catching `Error` (or bare `catch`) when only a specific error type is
expected. Unrelated errors (type errors, assertion failures, out-of-memory)
get swallowed alongside the expected one. Narrow catches to the specific
error type, and re-throw anything unexpected.

## Error Messages

- **Be actionable**: Tell users what happened and what to do about it.
  `'Operation failed'` is useless. `'Push failed: HTTP 403 — check auth'` is
  useful.
- **Be honest about partial success**: If some operations succeeded and some
  failed, say so explicitly. Don't report "complete" when half of it broke.

## Review Checklist

For any operation that can fail, verify:

- [ ] Failure produces user-visible output (not just debug log)
- [ ] Success message only appears after verifying success
- [ ] Exit code reflects actual outcome (for CLIs)
- [ ] At least one test exercises the failure path
- [ ] Error message tells the user what to do next

## Detection Strategies

| Anti-Pattern | How to Find It |
| --- | --- |
| Debug-only handling | Grep for `debug.*error`, `debug.*fail` |
| Empty catch blocks | Grep for `catch.*\{\s*\}` or catch blocks without throw/return |
| Lost Result types | TypeScript: enable `@typescript-eslint/no-floating-promises` |
| Optimistic success | Search for success messages, trace back to verify guards |
| Catch-and-continue | Audit catch blocks that log but don't throw/return |
| Lost exception context | Grep for `new Error.*\.message` (wrapping without cause) |
| Catch-and-replace | Grep for `} catch {` followed by `throw new` (bare catch discards error) |

A bare `} catch {` (no error variable) followed by `throw new` means the
original error is discarded. Acceptable when transforming to a semantic error
(`NotFoundError`, `NotInitializedError`). Problematic when replacing with a
generic message that loses the root cause.
