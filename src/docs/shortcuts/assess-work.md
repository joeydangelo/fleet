---
name: assess-work
description: Assess task complexity and route to the right workflow — direct implementation, task decomposition, or spec-first planning
---
Assess complexity, then follow the right path. When in doubt, choose the simpler
path — a moderate task treated as simple wastes no time, but a simple task treated
as complex wastes a full spec cycle.

## Step 1: Assess complexity

Read the user's request. Check it against these criteria:

### Simple — implement directly

ALL of these must be true:
- Touches 1-3 files
- Changes are well-understood (bug fixes, config, docs, small code changes)
- No cross-cutting concerns or complex dependencies
- No architectural decisions needed
- No benefit from parallelism

### Moderate — decompose into parallel tasks

ANY of these:
- Touches 4+ files across multiple modules
- Work can be split into 2-5 independent tasks with non-overlapping file ownership
- Clear scope — you can write task prompts without a spec
- No unresolved design questions

### Complex — spec first, then decompose

ANY of these:
- New feature or subsystem with design decisions to make
- Multiple viable approaches that need evaluation
- Cross-cutting concerns spanning 3+ modules
- User-facing behavior changes that need explicit agreement
- Scope is ambiguous or larger than it appears

## Step 2: Route

### If Simple

Implement directly in this session. No paw session needed.

1. Make the changes
2. Run tests, lint, typecheck
3. Commit using conventional commit format

Done. No worktrees, no paw.yaml, no builders.

### If Moderate

Skip to task decomposition:

```
paw shortcut decompose-work
```

This decomposes the work into parallel tasks, generates `.paw/paw.yaml`, and after
approval launches builder agents via `paw go`.

### If Complex

Design before building. This path writes a spec, gets approval, then decomposes.

1. **Load the spec planning guideline:**

   ```
   paw guidelines spec-planning
   ```

2. **Research the codebase.** Launch 2-3 Explore agents in parallel to cover
   independent areas. Each agent targets a specific research question:
   - Structure and patterns — module boundaries, directory layout, conventions
   - Related code — similar features, shared types, interfaces to extend
   - Dependencies and boundaries — imports, data flow, system edges

3. **Clarify gaps with the user.** Research reveals things the request didn't
   cover. Use `AskUserQuestion` to present specific, research-informed questions
   with your recommendation for each.

4. **Write the spec.** Use `paw template plan-spec` for the structure:

   ```
   .paw/specs/spec-YYYY-MM-DD-feature-name.md
   ```

   Reference concrete file paths from research. Show data shapes as actual types.
   Match format to content: prose for intent, pseudocode for branching logic,
   tables for edge cases.

5. **Review with the user.** Walk through key design decisions. Highlight
   uncertainties. Call out scope boundaries.

6. **After approval, decompose into tasks:**

   ```
   paw shortcut decompose-work
   ```

   Set the top-level `spec:` field in paw.yaml pointing to your spec:

   ```yaml
   spec: .paw/specs/spec-YYYY-MM-DD-feature-name.md
   ```
