---
name: codebase-research
description: Research quality calibration for the orchestrator's scout phase — what makes findings trustworthy enough to route from
roles: [orchestrator]
---

Research quality compounds exponentially downstream. Excellent research grounds a plan
that lands in hours; bad research produces a plan that requires a complete rewrite
in months. The core tension is thoroughness vs. speed — research too shallow produces
vague findings that compound into bad plans, while research too deep fills the
orchestrator's context with raw data and delays routing.

## Finding Quality

- Ground every finding in a file path, line range, or concrete evidence. "Module X
  uses pattern Y (see lines 45-67 in file.py)" is actionable; "the code probably does
  something with databases" is noise.
- State root causes with reproduction evidence, not symptoms. "Race condition between
  handlers (reproduced in test)" grounds a plan; "something is timing out" does not.
- Make findings falsifiable — each claim should be verifiable by reading the cited
  source. Hedged language ("I think," "probably," "might be") signals insufficient
  investigation, not appropriate caution.

## Research Artifacts

- Require four sections in every research summary: Current Architecture, Problem Root
  Cause, Constraints, and Recommended Approach — each grounded in file paths and
  evidence.
- Validate that the summary is self-sufficient: the next phase executes from the
  summary alone without re-deriving information scouts already found.
- Accept scout output as synthesized conclusions, not raw data. A scout returns "Found
  47 files across 3 modules; validation logic concentrated in /src/validators" — not
  47 file paths.

## Sufficiency

- Findings are sufficient when every dependency is concrete (file paths, not module
  guesses), root causes cite evidence, and the recommended approach is justified
  against stated constraints.
- Findings are insufficient when dependencies remain vague ("probably in auth.py"),
  root causes lack evidence, or the recommendation cannot be justified.
- Stop exploring when additional scouts would refine confidence but not change the
  routing decision. The goal is routing accuracy, not exhaustive understanding.
