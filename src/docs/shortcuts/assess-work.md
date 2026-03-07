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
- Touches 1-4 files
- Changes are well-understood (bug fixes, config, docs, small code changes)
- No cross-cutting concerns or complex dependencies
- No architectural decisions needed
- No benefit from parallelism

### Moderate — decompose into parallel tasks

ANY of these:
- Touches 5+ files across multiple modules
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

1. **Understand the request.** Identify what's changing and why. Use
   `AskUserQuestion` only for genuine ambiguity you can't resolve from the request
   and codebase.

2. **Quick codebase scan.** Launch 2 Explore agents in parallel at `quick`
   thoroughness:
   - **Affected code** — files to change, current behavior, callers/consumers.
   - **Patterns** — how similar code is structured, naming and test conventions.

3. **Implement.** Bias toward action — don't ask permission to read files or make
   straightforward decisions. Stop for scope surprises, conflicting requirements,
   or missing context only the user has.

4. Run format, lint, typecheck, and tests.
5. Commit using `paw guidelines commit-conventions`.

Done. No worktrees, no paw.yaml, no builders.

### If Moderate

Skip to task decomposition:

```
paw shortcut decompose-work
```

This decomposes the work into parallel tasks, generates `.paw/paw.yaml`, and after
approval launches builder agents via `paw go`.

### If Complex

Skip to spec planning:

```
paw shortcut write-spec
```

This writes a spec, gets approval, then decomposes into parallel tasks.
