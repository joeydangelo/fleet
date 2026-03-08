---
name: summary-template
description: Task summary template for paw worktree agents
roles: [builder]
---
Use this template when writing your task summary in the Publish phase.
Write the filled-in structure to `.paw/summary.md`.
Fill in any issue references from your task's `issue:` field and specs from `spec:`.

```markdown
---
branch: {your task branch}
task: {your task name}
---

## Summary

<!-- What changed and why. Reference issues from your task's issue: field. -->

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
