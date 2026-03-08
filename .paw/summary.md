---
branch: feature/clean-merge-working-tree-clean-merge
task: clean-merge
---

## Summary

Fixed merge pollution where local WIP files leaked into the target branch
and conflict briefs during `paw merge`. Two root causes addressed:
`commitUntrackedFiles()` committed everything untracked into the target
branch, and `getDiffOutput()` captured all working tree changes in conflict
briefs instead of just the conflicting files.

## Changes

- Replaced `commitUntrackedFiles()` with `stashWorkingTree()`/`unstashWorkingTree()` in `src/lib/git.ts`
- Wrapped merge loop in try/finally with stash in `src/commands/merge.ts`; changed `process.exit(1)` to `return` so finally block always pops the stash
- Replaced `getDiffOutput()` (bare `git diff`) with `getMergeConflictDiff()` (`git diff --diff-filter=U`) to scope conflict briefs to unmerged files only
- Updated `src/lib/conflict.ts` to use `getMergeConflictDiff`
- Replaced `commitUntrackedFiles` tests with stash tests (save/restore, clean merge, conflict pop)
- Added test verifying conflict brief excludes unrelated working tree changes
- Fixed `git init -b main` in test helpers for environments where default branch is not 'main'

## Testing

- `npx vitest run tests/merge.test.ts tests/conflict.test.ts` — 20/20 pass
- `npx tsc --noEmit` — clean
- `npx prettier --check` — clean
- Pre-commit hooks (format, typecheck, lint) — all passed

Test scenarios covered:
- Stash saves and restores untracked files around merge
- Stash returns false when working tree is clean
- Merge succeeds with unrelated untracked files (no junk commit)
- Unstash returns false during active merge conflict; stash preserved for user to pop later
- After aborting merge, stash can be popped successfully
- Conflict brief only contains diffs for conflicting files, not unrelated changes

## References

- Spec: `.paw/specs/spec-2026-03-08-clean-merge-working-tree.md`

---

## Review — Cycle 1
**Verdict:** FAIL

### Strengths
Clean separation of concerns: stash replaces junk commit, scoped diff filter is correct (--diff-filter=U), old references fully removed, try/finally structure is right pattern, tests are thorough and cover real scenarios, git init -b main fix is a good bonus.

### Issues
CRITICAL: src/commands/merge.ts:207 -- unstashWorkingTree called with active merge conflict -- After a merge conflict, the finally block calls unstashWorkingTree(repoRoot) but git is in MERGING state with unmerged entries. git stash pop will fail with "Your index contains unmerged entries" because git refuses to pop stash when the index has conflicts. The test (merge.test.ts:393) masks this by calling git merge --abort before unstashWorkingTree, but the production code has no merge abort on the conflict path. Result: stash pop throws, user WIP stays trapped in stash, and the unhandled error crashes the process. Fix: either abort the merge before popping the stash on the conflict path, or catch the stash pop error and warn the user their changes are in git stash.

### Suggestions
MINOR: The conflict-path test should mirror production behavior (no manual merge --abort before unstash) to catch this kind of divergence. Consider adding error handling in unstashWorkingTree for robustness.

## Fixed — Cycle 1

| Finding | Resolution |
|---------|------------|
| CRITICAL/merge.ts:207 — unstashWorkingTree called with active merge conflict | Fixed: `unstashWorkingTree` now returns `boolean` (catches errors), and `runMergeLoop` warns user to `git stash pop` after resolving the conflict |
| MINOR/testing — conflict-path test masks bug with manual merge --abort | Fixed: test now mirrors production behavior — verifies unstash returns false during active conflict, then verifies stash pop works after abort |
