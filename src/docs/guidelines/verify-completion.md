---
name: verify-completion
description: Run verification commands and confirm output before claiming done — evidence before assertions
---
# Verification Before Completion

**Core principle:** Evidence before claims, always.

If you haven't run the verification command in this turn, you cannot claim
it passes. "Should work," "looks correct," and "I'm confident" are not
evidence — they're guesses.

## The Gate

Before claiming any status:

1. **Identify** — What command proves this claim?
2. **Run** — Execute the full command (fresh, not a cached result)
3. **Read** — Full output, exit code, failure count
4. **Confirm** — Does the output support the claim?
   - Yes → state the claim with evidence (e.g., "42/42 tests pass")
   - No → state the actual result with evidence
5. **Then speak** — Only now make the claim

## Common Failures

| Claim | Evidence required | Not sufficient |
|---|---|---|
| Tests pass | Test output: 0 failures | Previous run, "should pass" |
| Linter clean | Linter output: 0 errors | Partial check, extrapolation |
| Build succeeds | Build command: exit 0 | Linter passing, "logs look good" |
| Bug fixed | Reproduce original symptom: now passes | Code changed, assumed fixed |
| Regression test works | Red-green cycle verified | Test passes once (no red step) |
| Requirements met | Line-by-line spec checklist | "Tests pass" (tests ≠ requirements) |

## Watch Words

If you catch yourself reaching for these words, stop and run the Gate:

- "should," "probably," "seems to"
- "Great!", "Perfect!", "Done!" (before verification)
- "I'm confident" (confidence ≠ evidence)
