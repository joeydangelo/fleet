---
name: new-plan-spec
description: Create a new feature planning specification document
---
Create a feature spec that captures requirements, design decisions, and
implementation approach — before decomposing into parallel tasks.

## Step 1: Understand the request

Gather enough context to write a useful spec.

1. **Read the user's request.** Identify the feature name, goals, and any
   constraints they mentioned.

2. **Ask clarifications** — only what you can't infer. Use `AskUserQuestion`:
   - What problem does this solve? (if not obvious)
   - Are there existing patterns or prior art to follow?
   - Any hard constraints (performance, compatibility, API stability)?

   Don't ask about implementation details — you'll figure those out in Step 2.

## Step 2: Research the codebase

Explore before writing. Load relevant guidelines first:

```
paw guidelines general-tdd-guidelines
```

Then investigate:

1. **Directory structure.** Identify module boundaries, existing patterns, and
   where new code would naturally live.

2. **Related code.** Search for similar features, shared types, utilities, and
   conventions the new feature should follow.

3. **Dependencies.** Check what the feature would import or extend. Note
   interfaces that other modules depend on — these become integration points
   in the spec.

4. **Existing specs.** Check `.paw/specs/` for prior specs. Review any that
   overlap with the new feature for context and consistency.

## Step 3: Write the spec

1. **Create the spec file:**

   ```bash
   mkdir -p .paw/specs
   ```

   Use `paw template plan-spec` for the structure. Write the spec to:

   ```
   .paw/specs/spec-YYYY-MM-DD-feature-name.md
   ```

   Fill in the date and a descriptive feature name (kebab-case).

2. **Fill in the template** based on your research. Follow these rules:

   - **Phases:** Use as few as possible. One phase is ideal for straightforward
     features. Only split into phases when incremental testing requires it.

   - **No time estimates.** Never include timeframes like "4-6 hours" or
     "1 week". Work will be done in one session.

   - **Diagrams:** Use Mermaid diagrams in the Design section when they clarify
     multi-component flows, state transitions, or dependency relationships that
     are hard to follow in prose alone. Skip diagrams when a bullet list says
     the same thing.

   - **Concrete file paths.** Reference actual files and directories from your
     research, not hypothetical ones.

   - **Testing strategy.** Be specific about what to test (unit, integration,
     edge cases) based on the project's existing test patterns.

## Step 4: Review with the user

Present the spec for feedback. Iterate until approved:

- Walk through the key design decisions and trade-offs
- Highlight anything you're uncertain about
- Call out scope boundaries (what this spec covers vs. what it doesn't)

## Step 5: Transition to task decomposition

After the spec is approved, suggest decomposing into parallel tasks:

```
paw shortcut generate-paw-yaml
```

Set the top-level `spec:` field in `.paw/paw.yaml` to point to your spec:

```yaml
spec: .paw/specs/spec-YYYY-MM-DD-feature-name.md
```
