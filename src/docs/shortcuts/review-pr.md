---
name: review-pr
description: Orchestrate a multi-specialist review of a task branch — triage, fan-out domain experts, synthesize findings, return verdict
roles: [reviewer]
---

## Variables

| Variable | Source | Default |
|---|---|---|
| `TASK_FILE` | review prompt | — |
| `REVIEW_FILE` | review prompt | — |
| `DIFF_CMD` | review prompt | — |
| `VERDICT_CMD` | review prompt | — |

## Failure Modes

| Mode | Trigger |
|---|---|
| `SERIAL_FANOUT` | Spawned specialists in separate messages instead of one (serialized, not parallel) |
| `SILENT_PARTIAL` | Specialist failed or timed out with no mention in suggestions |
| `DUPLICATE_FINDINGS` | Same file:line reported by multiple specialists without deduplication |
| `MISSED_CROSSCUT` | Issue flagged by 2+ specialists not recognized as systemic |
| `SEVERITY_INFLATION` | Style nit classified as CRITICAL — erodes builder trust |
| `PHANTOM_FINDINGS` | Manufactured issues when code is solid — triggers unnecessary fix cycles |
| `LENIENT_PASS` | Wrote PASS verdict despite non-empty issues array — MINOR issues are findings |

## Workflow

### Phase 1: Triage

**Objective:** Classify the change and select which specialist domains apply.
**Tools:** Read, Bash(git diff), Bash(git show fleet-sync:*)

1. Read the task file to understand scope and intent.
2. Run the review file command. Note prior review cycles and unresolved findings.
3. Run the diff command. Read the full diff. Count changed files and lines.
4. Classify which risk domains the diff touches:

| Domain | Applies when | Agent | Model | Guideline |
|---|---|---|---|---|
| **Security** | input handling, auth, data exposure, credentials | Explore | opus | `fleet guidelines security-review` |
| **Performance** | algorithmic complexity, I/O and concurrency, unnecessary work | Explore | sonnet | `fleet guidelines performance-review` |
| **Style/Code Quality** | naming, codebase consistency, dead code, error handling quality | Explore | haiku | `fleet guidelines code-quality-review` |

**Gate:** At least one domain applies. Domains identified.
**Artifact:** Domain list with model tier and guideline per domain.

---

### Phase 2: Fan-out

**Objective:** Spawn parallel Explore specialist agents with isolated context
and targeted expertise.
**Tools:** Agent

**If the diff is small (< 50 changed lines across ≤ 3 files):** Skip fan-out.
Review directly in Phase 3 by loading the most relevant guideline yourself.

Spawn all specialists in a **single message** for true parallel execution. Each
Explore specialist receives:

- **Model override** matching the domain's reasoning tier
- **`TASK_FILE`** — so it can read the builder's intent
- **`DIFF_CMD`** — so it runs the diff in its own fresh context
- **Domain scope** — what to examine, what to ignore
- **Guideline** — `fleet guidelines <name>` to load before reviewing
- **Finding format** — `SEVERITY/domain file:line -- what — why it matters`
- **Calibration** — CRITICAL = bugs, security vulns, broken functionality;
  MAJOR = antipatterns, missing coverage, poor error handling;
  MINOR = style nits, documentation gaps
- **Instruction** — trace code paths before judging; uncertain findings must
  note uncertainty; return ONLY findings, no preamble

Each specialist runs the diff command and reviews independently. Explore agents
are read-only by default — they cannot modify files. Context isolation prevents
one domain's analysis from biasing another.

**Gate:** All specialist agents return findings. Handle partial failures
gracefully — one specialist's failure does not block the review.
**Artifact:** Raw specialist findings per domain.

---

### Phase 3: Synthesize

**Objective:** Merge specialist findings into a calibrated, deduplicated verdict.
**Tools:** Read

1. Collect findings from all specialists (or from direct review if fan-out was
   skipped).
2. Deduplicate: same file:line from multiple specialists → keep highest severity.
3. Note cross-cutting concerns (flagged by 2+ specialists) — these signal
   systemic issues worth highlighting in strengths or suggestions.
4. If prior reviews exist, verify each prior finding against the current diff:
   - **Fixed** — diff resolves it → drop.
   - **Not fixed** — builder claimed fix but diff disagrees → re-file:
     `(unresolved — builder claimed fixed but [reason])`.
   - **Not addressed** — re-file: `(unresolved from prior review)`.
   - **Disputed** — evaluate builder's argument. Drop if valid, re-file if not.
5. Compose strengths: 1-3 brief, specific observations on what was done well.
6. Compose suggestions: optional non-blocking observations. Omit if none.

**Gate:** Every finding has severity, domain, file:line, and rationale.
**Artifact:** Deduplicated findings, strengths, and suggestions.

---

### Phase 4: Verdict

**Objective:** Write the verdict file to signal completion.
**Tools:** Bash(node -e)

- **PASS** — zero findings across all severities.
- **FAIL** — **ANY** issue at **ANY** severity.

Write the verdict using the `node -e` command from the review prompt. **This
must be the last action.** The review runner kills the session on detection.

**Gate:** Verdict matches issue count: PASS only when issues array is empty,
FAIL when issues array has one or more entries.
**Artifact:** Verdict JSON at the path from the review prompt.

## Stopping Conditions

Stop and write verdict when ANY of these are true:

- Synthesis is complete and verdict is determined.
- Diff is empty or branches are identical (PASS).
- All specialist spawns fail (write verdict with directly-reviewed findings).
- A prior review cycle exists and builder addressed zero findings (FAIL with
  re-filed findings).

## Output Format

Verdict JSON with four keys:

- **`verdict`** — `"PASS"` or `"FAIL"`.
- **`strengths`** — What was done well. Brief, specific. One to three bullets.
- **`issues`** — All findings grouped by severity (CRITICAL first, then MAJOR,
  then MINOR). Each as `SEVERITY/domain file:line -- what — why it matters`.
- **`suggestions`** — Optional. Non-blocking observations or cross-cutting
  themes worth considering. Omit if none.

Forbidden in output:

- Preambles ("I have...", "Let me...", "Based on...", "Here is...")
- Meta-commentary about what the agent is doing
- Reasoning that belongs in tool calls, not the verdict
