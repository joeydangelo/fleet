---
name: error-handling-review
description: Error handling and silent failure detection calibration for code review
roles: [reviewer]
---

The core tension is resilience vs. visibility — catch blocks and fallbacks exist to keep
software running, but every swallowed error is a debugging session someone pays for later.
Every finding requires a plausible failure scenario where the current handling leaves the
operator or user without the information they need to act.

## Catch Block Specificity

- Verify catch blocks handle only the expected error types. A broad catch that traps
  unrelated errors (network failures caught by a JSON-parse handler) masks root causes
  and delays diagnosis.
- Check that catch blocks change control flow — propagate, return, or recover. Logging
  alone is not handling; a catch that logs and continues executes the success path after
  a failure. The control flow after a catch must differ from the success path.
- Confirm error variables are used, not ignored. A catch block that names the error
  but never references it discards the only diagnostic signal available.

## Fallback Behavior

- Verify fallbacks are explicit and expected by the caller. A function that silently
  returns a default value on failure when the caller assumes success produces incorrect
  downstream behavior without any error signal.
- Check that fallback paths log or report that they activated. A retry chain, cache
  fallback, or degraded-mode path that executes without visibility makes intermittent
  failures invisible in production.
- Confirm fallbacks do not mask the condition that triggered them. Returning cached
  data on network failure is valid; returning cached data without recording that fresh
  data was unavailable hides a connectivity problem.

## Error Propagation

- Verify errors that indicate caller-relevant failure propagate rather than being
  caught locally. A low-level function that catches and logs a database connection error
  instead of throwing deprives the caller of the ability to retry, circuit-break, or
  report to the user.
- Check that re-thrown errors preserve the original cause. Wrapping without attaching
  the original error (cause property, chained exception) forces debuggers to guess at
  the root cause.

## Success Verification

- Verify success messages and completion reports execute only after checking the result
  of the operation they describe. Reporting "done" without verifying the outcome is a
  silent failure — the user believes the operation succeeded when it may not have.
- Check that Result types and status returns are consumed by the caller. A function
  that returns `{ success: boolean }` or a Result type where the caller discards the
  return value is an unchecked failure path — the error signal exists but nobody reads it.

## Error Message Actionability

- Verify user-facing error messages state what failed and what the user can do about it.
  A generic "something went wrong" provides no diagnostic value and no recovery path.
- Check that log-level error messages include operation context — what was being
  attempted, with which inputs or identifiers — sufficient for an operator to reproduce
  or locate the failure.

## Severity Calibration

- **CRITICAL** when the diff introduces a path where an error is silently discarded
  and no signal (log, metric, user message) reaches any observer: empty catch blocks,
  catch-and-continue without logging, promise chains with no rejection handler.
- **MAJOR** when the diff handles the error but inadequately: generic messages that
  prevent diagnosis, fallbacks that activate without visibility, re-throws that discard
  the original cause.
- **MINOR** when error handling works but could be more precise: broad catch that
  happens to cover only one realistic error type, log message missing a secondary
  identifier.

## False Positive Checks

- **Verify the error path is reachable.** Trace the operation that could throw — if
  the function is infallible in practice (pure computation, type narrowing), an empty
  catch is dead code, not a silent failure.
- **Respect intentional suppression.** Some catch blocks exist to handle expected,
  non-exceptional conditions (file-not-found on optional config, ENOENT on cleanup).
  Flag only when the suppression hides unexpected failures.
- **Distinguish log levels.** A catch that logs at debug/trace level for an expected
  condition is not a silent failure — it is appropriate visibility for the severity.

## Examples

- `CRITICAL/error-handling src/sync/push.ts:67 -- empty catch block on network request — sync failures produce no log, metric, or user feedback`
- `MAJOR/error-handling src/api/client.ts:42 -- fallback to cached response on fetch error without logging that fresh data was unavailable — intermittent connectivity issues invisible to operators`
- `MINOR/error-handling src/db/query.ts:18 -- re-thrown error wraps message but drops original cause — stack trace stops at the wrapper`
