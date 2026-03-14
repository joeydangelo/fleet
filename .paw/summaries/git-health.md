# Task Summary: git-health (edge-case tests)

## Changes

### tests/conflict.test.ts (Finding 15)
- Added section ordering assertions to `generateConflictBrief` test: verifies header appears before files list, files list before task section, task section before diff, diff before inbox entries. Uses `indexOf` comparisons.

### tests/merge.test.ts (Finding 16)
- After successful merge in "merges clean tasks and tracks state", added `git log --oneline` assertion to verify task commit message ("auth commit") appears in history.
- After conflict resolution and resumed merge in "resolves conflict and resumes merging remaining tasks", added `git log --oneline` assertion to verify both "auth commit" and "api commit" appear.

### tests/review.test.ts (Finding 21)
- Added test "calls submitForReview before reviewTask" that verifies the sync state shows `in_review` status at the moment `reviewTask` is invoked. Includes TODO comment noting this will be naturally testable when reviewTask is de-mocked (HIGH spec).

### tests/watch.test.ts (Finding 22)
- Added "excludes entries with timestamp equal to lastSeenTs (strict >)" test.
- Added "handles duplicate timestamps" test verifying consistent include/exclude for all entries sharing the same timestamp.
- Added "handles out-of-order entries" test verifying per-entry filtering regardless of array order.

### tests/health.test.ts (Finding 23)
- Added "returns zombie when lastActivity is empty string" test (falsy path).
- Added "returns zombie when lastActivity is an invalid date string" test (NaN elapsed).
- Added "returns working when lastActivity is in the future" test (negative elapsed).

### src/lib/health.ts (production fix)
- Added explicit `Number.isNaN(activityMs)` guard before computing elapsed time. Previously, an invalid date string would produce NaN that fell through comparisons to return 'zombie' implicitly. The guard makes this behavior explicit and intentional.

## Test Results
All 5 modified test files pass: 29 health tests, 15 watch tests, 7 review tests, 5 conflict tests, 15 merge tests.
