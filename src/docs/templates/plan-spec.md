---
name: plan-spec
description: Template for feature planning specification documents
roles: [orchestrator]
---
---
title: [Feature Name]
status: draft
created: YYYY-MM-DD
---

# [Feature Name]

## Overview

What this feature does and why it exists. Enough context for an agent to understand
the motivation and execute without external references.

## Intent

What to build. Make every statement testable — add concrete examples and constraints.
Capture the chosen approach and its rationale. Leave implementation sequence to the
agent; specify the end state, not the steps to get there.

## Constraints

What can't change. What assumptions must hold. Scope boundaries — what's in,
what's explicitly deferred, and explicit non-goals.

## Verification

How to prove this works. Define success criteria before implementation.

```yaml
must_haves:
  truths:
    - "Behavioral assertion the implementation must satisfy"
  artifacts:
    - "src/path/file.ts with specific property"
  key_links:
    - "Issue #N closed with validation evidence"
```

