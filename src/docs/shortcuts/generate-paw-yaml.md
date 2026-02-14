---
title: Generate paw.yaml
description: Analyze a codebase and generate .paw/paw.yaml with well-decomposed parallel tasks
category: orchestrator
---
Generate `.paw/paw.yaml` to split the user's feature request into parallel agent tasks.

## Instructions

1. **Gather context.** If you already have a spec, feature plan, or clear build
   description, use that directly. Otherwise, ask the user what they want to build.
   Ask good questions — clarify scope, priorities, and constraints until you have
   enough detail to identify the major pieces of work.

2. **Analyze the codebase.** Look at the directory structure, module boundaries, and
   existing patterns. Identify natural seams where work can be parallelized without
   agents stepping on each other.

3. **Decompose into tasks.** Run `paw guidelines paw-task-decomposition` for
   the full decomposition framework. Each task should:
   - Have a clear, independent focus area (files/directories the agent owns)
   - Minimize overlap with other tasks' focus areas
   - Be roughly similar in size
   - Have explicit instructions the agent can act on without further clarification

   Use `paw template paw-yaml` for the config structure reference.

4. **Check for interface boundaries.** Where tasks share interfaces (types, APIs,
   function signatures), call this out explicitly in each task's instructions:
   - Which task owns the interface definition
   - What other tasks should expect from it
   - Tell the owning agent to `paw broadcast` when it changes the interface

5. **Write `.paw/paw.yaml`:**

   ```yaml
   target: feature/branch-name
   tasks:
     task-name:
       focus:
         - src/relevant/directory/
       prompt: |
         What to build. Be specific.
         Mention interfaces shared with other tasks.
   ```

6. **Validate the decomposition:**
   - [ ] No two tasks share the same focus files (minimal overlap)
   - [ ] Each task can start immediately (no hidden sequencing)
   - [ ] Instructions mention shared interfaces and who owns them
   - [ ] 2-5 tasks (fewer is better; more agents != faster)
   - [ ] A `tests` task exists if the feature needs cross-cutting test coverage

## Common Patterns

| Pattern | When to Use |
|---|---|
| Feature + tests | One task builds the feature, another writes tests for it |
| Frontend + backend | Separate UI work from API/data work |
| Module-per-task | Each task owns a distinct module or package |
| Core + consumers | One task builds the shared layer, others build on top |

## Anti-Patterns

- **Too many tasks.** 6+ agents means coordination overhead exceeds parallelism gains.
- **Sequential dependencies.** If task B can't start until task A finishes, they
  shouldn't be parallel. Combine them or make B a second session.
- **Overlapping focus areas.** Two agents editing the same files guarantees merge
  conflicts.
- **Vague instructions.** "Build the API" isn't actionable. "Build REST endpoints for
  user profiles at src/api/users.ts, returning UserProfile from src/types.ts" is.
