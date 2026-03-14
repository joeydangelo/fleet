# Task Summary: docs-messaging

## What was done

Added edge-case and failure-path tests across 4 test files per spec findings 11, 12, 17, and 18.

### tests/doc-sync.test.ts (Finding 11)
- Added `isDocsStale` test for 0-hour threshold boundary (any elapsed time is stale)
- Added `isDocsStale` test for exact threshold boundary (elapsed == threshold is not stale, strict >)
- Added `syncDocs` failure path: `generateDefaultManifest` returns empty when bundled docs dir missing (via `findBundledDir` spy returning null)
- Added `syncDocs` failure path: returns empty result arrays when bundled dir missing mid-sync

### tests/doc-add.test.ts (Finding 12)
- Added test for `addDoc` when `fetchWithGhFallback` throws network error -- error propagates
- Added test for `addDoc` when fetch returns whitespace-only content -- triggers validation "empty" error
- Marked with TODO for HIGH spec (github-fetch de-mocking)

### tests/inbox-gate-hook.test.ts (Finding 17)
- Added Edit tool denial test when flag file exists (exit 2, stderr contains "unanswered")
- Added Write tool denial test when flag file exists (exit 2, stderr contains "unanswered")
- Follows same pattern as existing Read tool test

### tests/prime.test.ts (Finding 18)
- Added test proving `readMessagesForTask` filtering (not deletion): after setting cursor, appends a new message with later timestamp, asserts exactly 1 message returned with correct content

## Test results
All new tests pass. Pre-existing failures in `prime from root` suite (missing dist/bin.mjs) are unrelated.

## Files modified
- `tests/doc-sync.test.ts`
- `tests/doc-add.test.ts`
- `tests/inbox-gate-hook.test.ts`
- `tests/prime.test.ts`
