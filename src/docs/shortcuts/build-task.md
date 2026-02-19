---
title: Build Task
description: Take a task from assignment to done with TDD, testing, and atomic commits
category: worktree agent
---
A workflow for implementing your paw task assignment with full test coverage and
clean commits.

## Steps

1. **Start.** Run `paw shortcut session-start` to orient yourself, load
   context, and broadcast your intent.

2. **Plan the work.** Break your task into small, testable increments. Bugs first,
   then features.

3. **Implement with TDD.** For each increment:
   - Write a failing test first (Red)
   - Write the minimum code to pass (Green)
   - Refactor (still Green)
   - Follow `paw guidelines general-tdd-guidelines` for the methodology
   - Follow `paw guidelines general-testing-rules` for test quality
   - For TypeScript projects, also see `paw guidelines typescript-testing-guidelines`
   - Find the existing test directory (`tests/`, `__tests__/`, etc.) or create one
   - Run the full test suite after each change

4. **Commit when green.** Follow `paw shortcut precommit-process` for the full
   checklist: review, test, broadcast interface changes, commit. Use
   `paw guidelines commit-conventions` for message format. Each commit should be a
   single logical unit with passing tests.

5. **Finish.** When all increments are done and tests pass, run
   `paw shortcut session-end` to broadcast final state and write your done summary.

## Principles

- **Broadcast interface changes.** If you change a type, export, or API another task
  depends on, `paw broadcast` before committing. This is the most important
  coordination action.
- **Ask when blocked.** If you need something from another task — a type definition,
  an interface shape, a decision — don't guess. Use `paw ask <task> "..."` to direct
  a question, then `paw threads` to check when the answer arrives.
- **Commit when tests are green,** not when you feel "done." Small, frequent commits
  with passing tests beat large commits at the end.
- **Stay in your focus area.** Your task file lists which files you own. Edits outside
  your focus cause merge conflicts.
- **Write a good summary.** `paw done` requires a structured summary. See
  `paw template task-summary` for the format.
