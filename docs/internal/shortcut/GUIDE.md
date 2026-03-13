# Shortcut Template Guide

Shortcuts are pre-built workflows injected into agent prompts. Skills define *how* an
agent thinks. Shortcuts define *what* an agent does — step-by-step procedures executed
within a skill's thinking mode.

## Progressive Disclosure

| Layer | Artifact | Token Cost | Loaded When |
|---|---|---|---|
| **Discovery** | Shortcut `description` in skill directory | ~10 tokens | Always (skill body) |
| **Activation** | Full shortcut body | ~500-1,500 tokens | Agent runs `<cli> shortcut <name>` |
| **Resources** | Referenced files, specs, guidelines | ~1,000+ tokens | Agent reads on demand |

The skill directory advertises available shortcuts. The shortcut body contains the full
procedure. Referenced resources load only when a step requires them.

## How Invocation Works

```
1. Skill body lists shortcut in its directory table
2. Agent encounters relevant task, runs `<cli> shortcut <name>`
3. System injects full shortcut body into agent context
4. Agent executes the workflow phases sequentially
5. Agent loads referenced resources (specs, guidelines) on demand per step
6. Agent produces output in the declared format
```

The skill decides *when* to invoke a shortcut. The shortcut decides *what* happens next.

## Structure

Every shortcut has the same sections in the same order:

1. **Frontmatter** — `name`, `description`, and `roles`
2. **Variables** — inputs, defaults, and static configuration
3. **Failure Modes** — named anti-patterns the agent must avoid
4. **Workflow** — phases with objectives, tools, steps, gates, and artifacts
5. **Stopping Conditions** — when to halt execution
6. **Output Format** — exact structure and forbidden patterns

## Frontmatter

```yaml
name: kebab-case-name
description: Verb phrase — what the shortcut accomplishes.
roles: [orchestrator, builder, reviewer]
```

- **`name`** — Matches the shortcut file name. Kebab-case.
- **`description`** — Single line starting with a verb. Populates the skill's shortcut
  directory table.
- **`roles`** — Which skill(s) surface this shortcut in their directory. Controls discovery.

Keep it minimal. The skill handles selection logic. The shortcut does not need to justify
its own invocation.

## Variables

Declare all inputs the shortcut expects. Distinguish required from defaulted.

```markdown
| Variable | Source | Default |
|---|---|---|
| `TASK_ID` | `$1` (required) | — |
| `SPEC_PATH` | `$2` | `docs/specs/$TASK_ID.md` |
| `MAX_RETRIES` | static | `3` |
```

Every variable referenced in the workflow must appear in this table. No implicit state.

## Failure Modes

Declare named failure modes the agent must avoid. Each mode has a short `SCREAMING_SNAKE`
name and a concrete trigger — what the agent did wrong, observable from the outside.

```markdown
| Mode | Trigger |
|---|---|
| `SCOPE_DRIFT` | Changed files outside task assignment |
| `SERIAL_FANOUT` | Spawned parallel agents in separate messages instead of one |
```

Failure modes serve two purposes:

1. **Prevention** — naming a failure makes it salient. The agent recognizes the pattern
   before falling into it.
2. **Diagnosis** — when a workflow produces bad output, failure mode names give operators
   a shared vocabulary for post-mortems ("this was a `PHANTOM_FINDINGS` failure").

Rules:

- **Observable triggers.** The trigger must be something you can detect from tool calls or
  output, not an internal reasoning state.
- **Shortcut-specific.** Generic failures ("made a mistake") are useless. Each mode should
  be unique to this shortcut's failure landscape.
- **3-8 modes per shortcut.** Fewer than 3 means the shortcut is trivial or under-analyzed.
  More than 8 means the shortcut is doing too much.

This section is optional for simple shortcuts but recommended for any workflow with
delegation, parallelism, or multi-phase coordination.

## Workflow Phases

Each phase follows the same structure:

```markdown
### Phase N: Name

**Objective:** Measurable goal.
**Tools:** Minimal set for this phase.

1. Imperative step.
2. Imperative step.

**Gate:** Machine-verifiable condition.
**Artifact:** What this phase produces and where.
```

### Objectives

State what the phase achieves in measurable terms. A reader should know whether the
objective was met without reading the steps.

- Good: "Produce a spec file covering all modified modules with acceptance criteria."
- Bad: "Research the codebase and understand the problem."

### Tool Boundaries

Declare the minimal tool set each phase requires. This is architecture, not just security.

| Role | Typical Tools |
|---|---|
| Scout / Research | Read, Glob, Grep |
| Plan / Spec | Read, Glob, Grep, Write |
| Build / Implement | Read, Write, Edit, Bash, Glob |
| Review / Verify | Read, Grep, Bash (test-only) |

Restricting tools forces proper delegation. A read-only scout cannot implement — it must
report findings for others to act on.

### Steps

Write each step as a bare imperative with a concrete action.

- Good: "Read `src/auth/token.ts` and extract the validation interface."
- Bad: "Consider reviewing the authentication module for potential improvements."

Rules:

- **Imperative mood.** Direct commands, not suggestions.
- **Concrete verbs.** Read, write, create, extract, verify, compare, run. Never improve,
  enhance, ensure, consider, or attempt.
- **One action per step.** If a step has "and" connecting two distinct actions, split it.
- **Positive framing.** Specify desired behavior, not forbidden behavior. "Use dependency
  injection for state" not "Don't use global state." Reserve negative constraints for the
  stopping conditions section only.

### Gates

Gates are machine-verifiable conditions that must be true before the next phase starts.
They prevent bad outputs from compounding downstream.

- Good: "Spec file exists at `$SPEC_PATH` and contains at least one acceptance criterion."
- Good: "All tests pass. Lint reports zero errors."
- Bad: "The plan looks reasonable."

If a gate cannot be checked programmatically, rewrite it until it can.

### Artifacts

Every phase that produces output must declare what it writes and where. Artifacts are the
handoff mechanism between phases — not message chains, not accumulated context.

- Good: "Write results to `docs/specs/$TASK_ID.md`."
- Bad: "Pass the findings to the next phase."

## Context Flow

For multi-phase shortcuts, document what passes between phases. Each phase reads artifacts
from the previous phase — it does not inherit accumulated context.

```markdown
## Context Flow
- Phase 1 -> Phase 2: spec file path, list of modified files
- Phase 2 -> Phase 3: commit hash, changed file paths
```

This section is optional for single-phase shortcuts. Required for multi-phase workflows.

## Stopping Conditions

List binary conditions that halt execution. Agents loop indefinitely without explicit
stopping criteria.

```markdown
Stop and report when ANY of these are true:
- All tests pass and coverage meets threshold.
- 3 retries exhausted for the same error.
- Scope exceeded original request.
- Information required that only the user can provide.
```

At least two stopping conditions per shortcut. One for success, one for failure.

## Output Format

Define the exact structure the shortcut must produce. Specify format type (markdown, YAML,
JSON, plain text).

Explicitly forbid meta-commentary:

```markdown
Forbidden in output:
- Preambles ("I have...", "Let me...", "Based on...", "Here is...")
- Meta-commentary about what the agent is doing
- Reasoning that belongs in tool calls, not artifacts
```

Production artifacts contain decisions, not reasoning.

## Writing Rules

- **Imperative mood throughout.** No "you should" or "the agent will."
- **Active voice.** Direct statements only.
- **One purpose per shortcut.** Define what the shortcut does and does not do. If a
  shortcut handles two unrelated workflows, split it.
- **500-1,500 tokens.** Shortcuts that exceed 1,500 tokens should extract detail into
  referenced guidelines or templates.
- **No embedded domain knowledge.** Domain expertise belongs in guidelines loaded on
  demand. Shortcuts contain procedures, not encyclopedias.
- **Self-contained execution.** The shortcut must work as a one-shot injection with no
  assumption of follow-up clarification. Include all context needed for decisions.

## Recovery

For workflows where steps can fail, include recovery paths inline:

```markdown
3. Run the test suite.
   - If tests fail: read failure output, fix the failing test, re-run (max 3 attempts).
   - If 3 attempts exhausted: stop and report the failure with diagnostic output.
```

Recovery logic lives inside the step, not in a separate section. Keep it close to the
action that might fail.

## Scale-Adaptive Shortcuts

Not every task needs the full workflow. Shortcuts may branch on task characteristics to
match investment to risk:

```markdown
**If bug fix or single-file refactor:** Skip Phase 1 (Research). Begin at Phase 2.
**If change crosses module boundaries or touches security:** Add specialist agents.
**If new system or multi-team scope:** Add approval gate after Phase 2 before proceeding.
```

Use signals the agent can measure: task type, file count, module boundaries, dependency
depth, domain risk (auth, payments, CI). Start simple, add complexity when justified.

## Anti-Patterns

| Anti-Pattern | Why It Fails | Better Approach |
|---|---|---|
| Vague verbs (improve, ensure, consider) | Agent cannot verify completion | Concrete imperatives with measurable outcomes |
| Missing gates between phases | Bad research compounds into bad builds | Machine-verifiable gate after every phase |
| Context accumulation | Bloats downstream agents, causes drift | Spec files as handoff artifacts |
| Kitchen-sink scope | Agent loses focus, skips steps | One purpose per shortcut |
| Large shortcuts (2,000+ tokens) | Defeats progressive disclosure | Extract to guidelines; keep under 1,500 tokens |
| Negative constraints only | Pink elephant problem — stating what not to do increases likelihood | Positive framing of desired behavior |
| Missing stopping conditions | Agent loops indefinitely or exits prematurely | At least two: one success, one failure |
| Embedded domain knowledge | Couples shortcut to one domain, inflates token cost | Domain knowledge in guidelines loaded on demand |
| Meta-commentary in output | Breaks downstream parsing and orchestration | Explicit forbidden patterns list |

## Checklist

- [ ] Frontmatter: `name`, `description` (verb phrase), and `roles`
- [ ] Variables table: all inputs declared, required vs. defaulted
- [ ] Failure modes: named anti-patterns with observable triggers (optional for simple shortcuts)
- [ ] Workflow: phases with objective, tools, steps, gate, artifact
- [ ] Steps: imperative mood, concrete verbs, one action each
- [ ] Gates: machine-verifiable, binary conditions
- [ ] Artifacts: declared output path per phase
- [ ] Stopping conditions: at least two (success + failure)
- [ ] Output format: exact structure, forbidden meta-commentary
- [ ] Self-contained: works as one-shot injection without clarification
- [ ] Under 1,500 tokens
