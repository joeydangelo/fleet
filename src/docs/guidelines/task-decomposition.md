---
name: task-decomposition
description: Split work into independent parallel tasks that minimize merge conflicts
roles: [orchestrator]
---
# Task Decomposition for Parallel Agents

Splitting work into parallel tasks is the core design decision in a paw session. Bad
decomposition causes merge conflicts, wasted work, and agents blocking each other. Good
decomposition lets agents work independently and merge cleanly.

## The Fundamental Rule

**Each task should own its files.** If two agents edit the same file, you get a merge
conflict. Sometimes that's unavoidable (shared config, package.json), but most conflicts
come from sloppy task boundaries, not genuine overlap.

## Finding the Seams

Look for natural boundaries in the codebase where work can be split without agents
stepping on each other.

**Module boundaries.** Most codebases have directory-level modules (`src/auth/`,
`src/api/`, `src/dashboard/`). If the feature touches multiple modules, each module is
often a natural task.

**Layer boundaries.** Frontend vs backend, data layer vs business logic, API routes vs
middleware. These layers usually live in different files and can be worked on in parallel.

**Interface contracts.** When two tasks share an interface (a type definition, an API
endpoint, a config schema), one task must own the definition and the other must consume
it. Call this out explicitly in both tasks' instructions. Set `depends_on` on the
consumer task so it merges after the producer.

## Sizing Tasks

- **2-5 tasks** is the sweet spot. Fewer than 2 and you don't need paw. More than 5
  and coordination overhead starts to eat into the parallelism gains.
- **Roughly equal size.** If one task takes 10x longer than the others, those agents
  sit idle while the slow one finishes. Rebalance by splitting the large task or
  absorbing the small ones.
- **Each task should be meaningful.** A task that just "creates a types file" isn't
  worth a separate agent. Fold it into the task that consumes those types.

## Independence Test

Before finalizing, check each pair of tasks:

1. **Can both start immediately?** If task B needs task A's output to begin, they're
   sequential — combine them or put them in separate sessions.
2. **Do they touch the same files?** Overlap means merge conflicts. Restructure until
   each file has one owner.
3. **Do they share interfaces?** Fine if ownership is explicit and the consumer
   sets `depends_on`.

## Common Decomposition Patterns

### Frontend + Backend
UI in one task, API/data in another. Define the API contract upfront in both tasks'
instructions.

### Core + Consumers
One task builds a shared library or service, others build features on top. Put the
most critical shared work in the core task and set `depends_on` on consumers.

### Module-Per-Task
Each task owns a distinct module or package. The cleanest decomposition when the
feature naturally spans multiple modules. Shared types or config files need an explicit
owner.

## Writing Task Prompts

A task prompt is the builder's entire briefing. It should be specific enough that the
agent can start immediately without asking questions.

**Include:**
- What to build — the concrete deliverable, not a vague goal
- Interface dependencies — what this task consumes from or provides to other tasks
- Acceptance criteria — specific behaviors, edge cases, or constraints that matter

**Leave to the builder:**
- File paths and internal structure — the focus area defines scope, the builder
  decides organization based on codebase patterns

A prompt like "Add user authentication" forces the agent to guess scope. A prompt like
"Add OAuth2 login with Google and GitHub providers. Define an AuthConfig type with
provider, clientId, and callbackUrl fields — the api task imports this type. Support
login, logout, and token refresh flows. Return 401 with a JSON error body on expired
tokens." gives the agent a clear target.

## What Not to Parallelize

- **Tightly coupled changes.** If the feature is one function that touches one file,
  splitting it across agents adds overhead for zero benefit.
- **Sequential workflows.** Database migration then code that uses the new schema.
  The second step can't start until the first is done. Run them in sequence, or put
  both in one task.
- **Tests as a separate task.** Each builder writes tests alongside its implementation
  (TDD). Splitting tests into their own task means the test agent can't start until
  features are done, and it creates file overlap with the feature tasks' test files.
- **Refactoring.** Wide-reaching refactors (renaming, moving files, changing import
  paths) touch many files and conflict with everything. Do them in a dedicated session,
  not alongside feature work.
