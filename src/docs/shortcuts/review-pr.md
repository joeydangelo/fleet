---
title: Review PR
description: Review a task PR for design, testing, code quality, and security — return PASS or FAIL
category: orchestrator
---
A structured code review for a paw task PR. This is a **read-only** review — do not
edit or write files. Return a verdict (PASS or FAIL) with structured findings.

## Instructions

1. **Get the PR diff.**

   ```bash
   gh pr diff <PR_NUMBER>
   ```

   Or for a branch diff:

   ```bash
   git diff <target>...<task-branch>
   ```

2. **Identify files and languages.** List the files changed and note which
   languages are present (TypeScript, Python, Go, Rust, etc.).

3. **Load relevant guidelines.** Use these to calibrate your review:

   - `paw guidelines general-testing-rules` — always
   - `paw guidelines typescript-testing-guidelines` — if TypeScript files changed
   - `paw guidelines commit-conventions` — for commit message quality

4. **Perform comprehensive review.** Evaluate each area:

   - **Design**: Does the approach make sense? Are there simpler alternatives?
     Look for antipatterns, code duplication, and quick hacks.
   - **Test coverage**: Are edge cases tested? Are tests meaningful (not trivial)?
     Is there adequate coverage for the changes made?
   - **Code quality**: Leftover debug code, TODOs, commented-out blocks, dead code,
     inconsistent naming, overly complex logic.
   - **Error handling**: Are errors handled at system boundaries? No swallowed errors?
     Are failure modes accounted for?
   - **Security**: Injection risks, credential exposure, unsafe input handling,
     XSS vectors, SQL injection, command injection.

5. **Compile findings.** Use this format for each finding:

   ```
   <severity>/<category> <file>:<line> -- <description>
   ```

   **Severities:**
   - **CRITICAL** — Bugs, security issues, missing tests for critical paths,
     broken functionality.
   - **MAJOR** — Code quality issues, missing edge case tests, unclear logic,
     antipatterns.
   - **MINOR** — Style improvements, minor refactors, documentation gaps.

   **Categories:** `design`, `testing`, `quality`, `security`, `style`

6. **Return verdict.** Start your response with the verdict on the first line:

   **PASS** — No findings. The code is clean and ready to merge.

   **FAIL** — One or more findings. All findings are sent back to the builder
   for resolution, regardless of severity.

   Example:

   ```
   FAIL

   CRITICAL/security src/api/users.ts:12 -- User input passed directly to SQL query
   MAJOR/testing src/auth/login.ts:45 -- No test for invalid token handling
   MAJOR/quality src/utils/helpers.ts:78 -- console.log left in production code
   MINOR/style src/types/index.ts:3 -- Consider grouping related type exports
   ```
