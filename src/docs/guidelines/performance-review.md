---
name: performance-review
description: Performance issue detection and severity calibration for code review
roles: [reviewer]
---

The core tension is premature optimization vs. real performance problems — agents generate
correct code first and rarely optimize. A reviewer that flags every suboptimal pattern
wastes review cycles; one that misses unbounded growth or blocking I/O lets production
incidents through. Every finding requires a plausible hot path, not just a pattern that
could theoretically be faster.

## Algorithmic Complexity

- Check nested iterations over collections for hidden O(n²) behavior. Trace whether the
  inner collection scales with user data or is bounded by design.
- Verify repeated lookups in arrays or lists use an index structure (Map, Set, dict) when
  the collection grows with input size.
- Confirm pagination or streaming for queries and API responses that return unbounded
  result sets.

## I/O and Concurrency

- Verify file reads, network calls, and database queries in loops use batching or parallel
  dispatch rather than sequential per-item execution.
- Check that synchronous blocking calls (file I/O, HTTP requests, sleep) do not appear in
  async hot paths where they would serialize concurrent work.
- Confirm connections, handles, and streams are closed or released in all code paths,
  including error branches.

## Unnecessary Work

- Check for redundant computation inside loops — repeated parsing, re-fetching unchanged
  data, or rebuilding structures that could be hoisted.
- Verify that expensive operations (sorting, serialization, cryptographic hashing) execute
  only when their result is consumed, not speculatively.

## Severity Calibration

- **CRITICAL** when the diff introduces unbounded growth that degrades over time: resource
  leaks that accumulate per request, infinite or runaway loops on user input, or blocking
  the event loop in a concurrent server.
- **MAJOR** when the diff creates measurable inefficiency at user scale: O(n²) on
  collections sized by user data, sequential I/O in a loop that should batch, missing
  pagination on an endpoint returning full tables.
- **MINOR** is rare for performance. Reserve for suboptimal-but-correct patterns on small
  bounded data: linear scan instead of Map lookup on a known-small collection, redundant
  but inexpensive computation.

## Premature Optimization Checks

- **Trace the hot path.** Verify the code runs frequently or handles scale before filing.
  A startup-time initialization or a CLI command that runs once is not a performance finding.
- **Require measurable impact.** Flag only when the inefficiency produces observable cost
  (wall time, memory, connections) — not when a theoretically faster alternative exists.
- **Weigh fix complexity.** When the optimization adds abstraction, indirection, or
  concurrency control that outweighs the gain, it is not a finding.
- **Skip test code.** Tests run infrequently. Optimizing test performance is not in scope.

## Examples

- `CRITICAL/performance src/server/handler.ts:87 -- database connection opened per request but never closed in error path — connection pool exhaustion under load`
- `MAJOR/performance src/api/export.ts:34 -- nested loop builds O(n²) lookup over user records array — use a Map keyed by ID`
- Not a finding: `Array.filter().map()` chain on a 20-element config list — bounded, readable, no hot path
