---
name: summary-template
description: Task summary template for fleet worktree agents
roles: [builder]
---

```markdown
---
branch: {your task branch}
task: {your task name}
---

## Summary

<!-- 1-3 sentences: What does this PR add or change? -->

**Spec**: <!-- .fleet/specs/{spec-file}.md — if present -->

## Changes

<!-- Bullet list of what was built or modified. -->

## Validation

<!-- Include actual command output, not promises.
     - Docs/config: lint + typecheck
     - Features/bug fixes: lint + typecheck + integration tests
     - Migrations/auth/releases: lint + typecheck + all tests + build -->

- ✅/❌ `lint` - {status/output snippet}
- ✅/❌ `typecheck` - {status/output snippet}
- ✅/❌ `integration tests` - {X tests passed}
- ✅/❌ `full test suite` - {X tests passed}
- ✅/❌ `build` - {build output}

Closes #{issue_number}
```
