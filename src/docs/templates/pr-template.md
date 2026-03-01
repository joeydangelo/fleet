---
title: PR Template
description: Pull request body template for paw worktree agents
---
Use this template when creating a pull request in the Publish phase.
Copy the structure below into your `gh pr create --body` argument.
Fill in issue references from your task's `issue:` field and specs from `spec:`.

```markdown
## Summary

<!-- What changed and why. Link issues from your task's issue: field.
     Use closing keywords: Closes #123, Resolves PROJ-456 -->

## Changes

<!-- Bullet list of what was built or modified. -->

-

## Testing

<!-- How changes were verified. Test commands run, scenarios covered. -->

-

## References

<!-- Link to specs from your task's spec: field, design docs,
     or related PRs if applicable. Remove section if none. -->

-
```
