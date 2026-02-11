---
title: Implement and Validate
description: Take a task from assignment to done with TDD, testing, and atomic commits
category: planning
---
A workflow for implementing your paw task assignment with full test coverage and
clean commits.

## Steps

1. **Load context.** Run `paw prime` to get your task assignment, team status, and
   recent broadcasts. Load relevant guidelines with `paw guidelines <name>`. Read
   the task prompt in your `.paw/tasks/<task>.md` file. If it references external
   specs, issues, or beads, read those too.

2. **Plan the work.** Break your task into small, testable increments. Bugs first,
   then features. If the project uses an external tracker (beads, GitHub Issues, etc.)
   and your task's paw.yaml entry has a `bead:` reference, update the tracker as you
   go. If not, the paw task file is your tracking.

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
- **Commit when tests are green,** not when you feel "done." Small, frequent commits
  with passing tests beat large commits at the end.
- **Stay in your focus area.** Your task file lists which files you own. Edits outside
  your focus cause merge conflicts.
- **Write a good summary.** `paw done` requires a structured summary. See
  `paw template task-summary` for the format.
