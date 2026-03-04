---
name: new-plan-spec
description: Create a new feature planning specification document
---
Instructions:

Create a to-do list with the following items then perform all of them:

1. Find where specs live in this repo. Look for an existing specs directory
   (e.g. `docs/specs/`, `specs/`, etc.). If none exists,
   create `docs/specs/`. Review any existing specs for context.

2. Create the spec file using the template:
   ```
   paw template plan-spec > <specs-dir>/plan-YYYY-MM-DD-feature-name.md
   ```
   (Fill in the date and an appropriate feature name.)

3. Begin to fill in the new feature plan doc based on the user's instructions, stopping
   and asking for clarifications as soon as you need them.

   Rules:

   - You may break work into a few phases (phases) if it helps with incremental testing.
     But **use as few phases as possible.** If it is straightforward, use one phase.

   - NEVER GIVE TIME FRAMES IN PLANS, like "4-6 hours" or "1 week".
     Work will be done in one day.

   - Use Mermaid diagrams in the Design section when they clarify multi-component
     flows, state transitions, or dependency relationships that are hard to follow
     in prose alone. Don't add diagrams when a bullet list says the same thing.

4. After completing the spec, suggest using it to drive task decomposition:
   ```
   paw shortcut generate-paw-yaml
   ```
   When generating `paw.yaml`, reference the spec in each task's `spec:` field so
   agents have full context:
   ```yaml
   spec: <specs-dir>/plan-YYYY-MM-DD-feature-name.md
   ```
