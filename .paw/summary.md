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
- Stash pops even when merge hits a conflict
- Conflict brief only contains diffs for conflicting files, not unrelated changes

## References

- Spec: `.paw/specs/spec-2026-03-08-clean-merge-working-tree.md`
