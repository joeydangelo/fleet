---
name: assess-work
description: Scout the codebase, assess task complexity, and route to the optimal workflow
roles: [orchestrator]
---

## Variables

| Variable | Source | Default |
|---|---|---|
| `REQUEST` | User message (required) | — |
| `MAX_FIX_ATTEMPTS` | static | `3` |

## Failure Modes

| Mode | Trigger |
|---|---|
| `PHANTOM_RESEARCH` | Assessed complexity without reading any codebase files |
| `OVER_PROCESS` | Routed a bug fix or single-file change through spec and decomposition |
| `UNDER_PROCESS` | Routed work with unresolved architectural decisions to direct implementation |
| `SERIAL_SCOUTS` | Launched Explore agents in separate messages instead of one (serialized, not parallel) |
| `CONTEXT_HOARDING` | Orchestrator read 3+ source files directly instead of delegating to scouts |

## Workflow

### Phase 1: Scout

**Objective:** Produce a research summary covering codebase structure, dependencies,
root causes (if bug/fix), and constraints — grounded in file paths and evidence.
**Tools:** Read, Glob, Grep, Agent (Explore only)

1. Load `fleet guidelines codebase-research`.
2. For 1-2 files: read directly. For 3+ files: spawn parallel Explore agents,
   each targeting one research question:
   - **Codebase structure** — where does relevant code live, what are the existing
     patterns?
   - **Dependencies** — what does this component depend on, what depends on it?
   - **Root causes** — what actually broke, root cause vs. symptoms? (skip if not
     a bug or fix)
   - **Constraints** — what can't change, what assumptions must hold?
3. Synthesize scout summaries into the change shape: file count, module count,
   shared interfaces, domain risk areas. Do not re-read files scouts already
   explored.

**Gate:** All claims cite specific file paths. Module boundary crossings identified
with evidence.
**Artifact:** Change shape: file list, module count, shared interfaces, domain risk areas.

---

### Phase 2: Assess

**Objective:** Evaluate four signals and select an execution route.
**Tools:** None (reasoning only)

Evaluate these signals against scout findings:

| Signal | Question |
|---|---|
| **Task type** | Bug fix, refactoring, or prototype? Feature or enhancement? New subsystem? |
| **Design load** | Is the path obvious, or are there unresolved architectural decisions? |
| **Domain risk** | Does it touch auth, payments, schemas, CI, or public APIs? |
| **Approach clarity** | One clear approach, or multiple viable alternatives? |

Route using positive criteria — match process investment to stakes:

**Direct** — bug fix, refactoring, prototype, or small change where the path is
obvious, no architectural decisions are unresolved, and no domain risk requires
agreement. Implement in this session.

**Spec** — feature, enhancement, new subsystem, or any work with unresolved
architectural decisions, multiple viable approaches, or domain risk requiring
agreement. Write-spec adapts its own depth based on what it finds.

When assessment is ambiguous, choose the simpler route.

**Gate:** Assessment addresses all four signals (task type, design load, domain
risk, approach clarity) with explicit reasoning.
**Artifact:** Route decision (Direct or Spec) with signal justification.

---

### Phase 3: Route

**Objective:** Execute the selected path.

**If Direct:**

1. Implement the change.
   - **Proceed** when: choice is stylistic not functional, assumption is
     verifiable, action is reversible.
   - **AskUserQuestion** when: request is ambiguous with multiple valid
     interpretations, change has significant consequences, or you need
     information only the user can provide.
2. Validate: lint, typecheck, and tests appropriate to the change type.
3. Commit using `fleet guidelines commit-conventions`.

**If Spec:**

1. Run `fleet shortcut write-spec`.

**Gate:** Direct — lint, typecheck, tests pass. Spec — write-spec invoked.
**Artifact:** Direct — committed change. Spec — write-spec shortcut invoked.

## Context Flow

- Phase 1 → Phase 2: file scope, module count, shared interfaces, constraints,
  domain risk areas
- Phase 2 → Phase 3: route decision (direct / spec)

## Stopping Conditions

Stop and report when ANY of these are true:

- Direct route: requested change verified working.
- Spec route: downstream shortcut invoked.
- Request is ambiguous with multiple valid interpretations — ask before routing.
- Scope exceeds the original request — confirm with user before proceeding.
- `MAX_FIX_ATTEMPTS` exhausted for the same error.
- Information required that only the user can provide.

## Output Format

Present the route decision in 2-3 sentences: what the scouts found, which route,
and why. Then execute Phase 3.

Forbidden in output:

- Preambles ("I have...", "Let me...", "Based on...", "Here is...")
- Signal tables or formal rubrics shown to user
- Meta-commentary about assessment methodology
