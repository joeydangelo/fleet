---
title: Pre-Commit Process
description: Review, test, broadcast, and commit -- the checklist before every commit
category: worktree agent
---
Follow this process before every commit. It keeps your work clean and keeps other
agents informed.

## Checklist

1. **Review your changes.**

   Look at the diff. Check for:
   - Leftover debug code, TODOs, commented-out blocks
   - Files outside your focus area that you didn't mean to touch
   - Interface changes that other agents depend on

2. **Run tests.**

   Run whatever test command the project uses. Fix failures before committing.
   If you're unsure what to run, check the project's README, package.json scripts,
   or Makefile.

3. **Broadcast interface changes.**

   If your changes affect anything other agents might depend on (types, exports,
   API endpoints, shared config), broadcast before committing:

   ```
   paw broadcast "Changed UserProfile.email to optional, added UserProfile.emailVerified"
   ```

   This gives other agents a chance to see the change via `paw check` before they
   hit a merge conflict.

4. **Check for incoming messages.**

   ```
   paw check
   ```

   If another agent sent you a message or broadcast something relevant, handle it
   now rather than after committing. Adapting before you commit is cheaper than
   fixing after.

5. **Commit with a clear message.**

   Use conventional commit format (see `paw guidelines commit-conventions`):

   ```
   feat(auth): Add OAuth2 login flow with Google and GitHub
   ```

   If all checks pass, commit directly. Only ask the user if there are unresolved
   problems.
