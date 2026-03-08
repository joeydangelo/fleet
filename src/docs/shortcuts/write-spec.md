---
name: write-spec
description: Create a new feature planning specification document
roles: [orchestrator]
---
Create a feature spec that defines the end state before any code is written.

Load the spec planning guideline first:

```
paw guidelines spec-planning
```

Follow its principles throughout this workflow.

## Step 1: Understand the request

1. **Read the user's request.** Identify the feature name, goals, and constraints.

2. **Ask clarifications** — only what you can't infer from the request and
   codebase. Use `AskUserQuestion` for genuine ambiguity, not low-stakes details.

## Step 2: Research the codebase

Explore autonomously. Don't ask permission to read files or investigate.

Launch 3-4 Explore agents in parallel to cover independent areas of the codebase
simultaneously. Each agent should target a specific research question:

- **Structure and patterns.** Module boundaries, directory layout, existing
  conventions, and where new code would naturally live.
- **Related code.** Similar features, shared types, utilities, and interfaces
  the new feature should follow or extend.
- **Dependencies and boundaries.** What the feature would import, what other
  modules depend on, and where data enters and leaves the system.

Use `medium` thoroughness for most research. Use `very thorough` when the feature
touches unfamiliar or sprawling parts of the codebase.

After the Explore agents report back, synthesize their findings and form an opinion.
If multiple viable approaches exist, compare their tradeoffs against codebase
patterns and the feature's goals.

## Step 3: Clarify gaps from research

Research typically reveals things the original request didn't cover —
underspecified behavior, edge cases, scope boundaries, design choices, or
conflicts with existing patterns. Resolve these before writing the spec.

Use `AskUserQuestion` to present the user with specific, research-informed
questions. For each question, include your recommendation with reasoning. The
user may agree, redirect, or defer to your judgment — but the agent should
always have an opinion ready.

Common gaps to check:
- **Approach.** If multiple viable approaches exist, present a brief tradeoff
  comparison and your recommendation.
- **Scope boundaries.** What's in vs. what's deferred — especially when research
  shows the work is larger than the request implied.
- **Edge cases.** Specific inputs or states where the intended behavior isn't
  obvious from the request.
- **Design preferences.** Where the codebase has multiple established patterns
  and the choice isn't clear-cut.

Skip this step if research confirmed the request is straightforward and
unambiguous. Don't manufacture questions for the sake of asking.

## Step 4: Write the spec

1. **Create the spec file:**

   ```bash
   mkdir -p .paw/specs
   ```

   Use `paw template plan-spec` for the structure. Write the spec to:

   ```
   .paw/specs/spec-YYYY-MM-DD-feature-name.md
   ```

2. **Fill in the template** based on your research:

   - Reference concrete file paths from your research, not hypothetical ones.
   - Show data shapes as actual types or schemas, not prose descriptions.
   - Match expression format to content: prose for intent, pseudocode for
     branching logic, diagrams for state machines, tables for edge cases.
   - No time estimates. Work ships in one session.

## Step 5: Review with the user

Present the spec for feedback. Iterate until approved:

- Walk through key design decisions
- Highlight anything you're uncertain about
- Call out scope boundaries (what's in vs. what's out)

## Step 6: Transition to task decomposition

After the spec is approved, decompose into parallel tasks:

1. Run `paw shortcut decompose-work`
2. The shortcut uses your spec as its primary input
3. Set the top-level `spec:` field in paw.yaml:

   ```yaml
   spec: .paw/specs/spec-YYYY-MM-DD-feature-name.md
   ```
