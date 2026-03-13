# Guideline Template Guide

Guidelines are domain-specific calibration rules that shape agent judgment. Skills define
*how* an agent thinks. Shortcuts define *what* an agent does. Guidelines define *what
counts as correct* within a domain — the constraints, decision criteria, and quality
thresholds that a shortcut's procedure cannot encode on its own.

A shortcut says "review this code." A guideline says "in this codebase, security review
means checking revocation lists when JWT validation is present and verifying constant-time
comparison for all secret comparisons." The shortcut is the procedure; the guideline is
the domain knowledge that makes the procedure's judgments sharp.

## Progressive Disclosure

| Layer | Artifact | Token Cost | Loaded When |
|---|---|---|---|
| **Discovery** | Guideline `description` in skill directory | ~10 tokens | Always (skill body) |
| **Activation** | Full guideline body | ~300-800 tokens | Shortcut step reads it on demand |

Guidelines sit at the deepest layer of the progressive disclosure stack. They pay zero
token cost until a shortcut explicitly loads them. This deferred cost is the design's
central constraint: a guideline that is too large defeats the economics that justify
on-demand loading over front-loading everything into the skill body.

The book frames this as the injection-vs-retrieval balance: "Inject what the agent *must*
know upfront. Let it retrieve what it *might* need." Guidelines are the *might* — loaded
only when a shortcut's procedure enters a domain that requires calibration.

## Structure

Every guideline has the same parts in the same order:

1. **Frontmatter** — `name`, `description`, and `roles`
2. **Domain context** — brief prose establishing scope, motivation, and the domain's
   core tension
3. **Rules** — the calibration rules, grouped by topic
4. **Decision criteria** — when-to-use-which guidance for ambiguous judgment calls
   (conditional)
5. **Examples** — 2-3 canonical cases demonstrating correct application (conditional)

The rules section is the core. Everything else exists to make the rules land correctly.

## Frontmatter

```yaml
name: kebab-case-name
description: What domain this guideline calibrates — noun phrase.
roles: [orchestrator, builder, reviewer]
```

- **`name`** — Matches the guideline file name. Kebab-case.
- **`description`** — Single line. Populates the skill's guideline directory table. Write
  it for the agent that is deciding whether to load this guideline — what domain does it
  calibrate?
- **`roles`** — Which skill(s) surface this guideline in their directory. Controls
  discovery.

## Domain Context

One to three sentences establishing why this domain needs explicit rules. Name the core
tension — the competing concerns that make judgment difficult without calibration.

Good domain context tells the agent *what problem these rules solve* so it can weight
them appropriately against other loaded context. It does not teach the domain from
scratch — that belongs in documentation, not guidelines.

## Rules

Rules are the guideline's payload. Each rule is a single, self-contained statement that
an agent can apply without reading the surrounding rules.

### Writing Effective Rules

**Positive framing.** State desired behavior, not forbidden behavior. Negative
constraints create semantic association with the forbidden action — the model must
represent the action to understand the prohibition, which increases its activation weight.
Research shows negative constraints backfire at scale: "prompts with 'NEVER use global
variables' produced more global variable usage than prompts without the constraint."

| Backfires at Scale | Effective |
|---|---|
| Never use global state | Use dependency injection for state management |
| Don't expose internal errors | Return user-friendly error messages |
| Don't create new patterns | Follow existing patterns in the codebase |

Reserve explicit negative constraints for true hard boundaries — and when used, place them
in a dedicated block labeled clearly (e.g., `## Hard Boundaries`). This concentrates
negative framing in a single high-attention position rather than scattering it.

**Imperative mood for actions, declarative for criteria.** Use imperative verbs (validate,
return, check, separate, use) when the rule prescribes an action. Use declarative framing
(the implementation meets..., commits reflect...) when the rule defines a quality
criterion. The book recommends using declarative framing for high-level goals and
imperative for operational steps.

**Concrete verbs.** Read, write, validate, check, separate, return, use, run, extract,
compare, verify. These are actions an agent can execute and an observer can confirm. Vague
verbs — improve, ensure, consider, enhance, attempt — cannot be verified and get
deprioritized by the model.

**Self-contained statements.** Each rule should be understandable in isolation, without
reading the surrounding rules. A rule that says "use the pattern" requires external
context. A rule that says "for multi-step workflows, use plan-build-review to separate
planning from execution" is self-describing.

**Specificity where it matters.** Be explicit about output format, constraints, success
criteria, and external dependencies. Stay flexible on implementation approach, intermediate
reasoning, and stylistic choices. Over-specifying implementation details robs agents of
the ability to adapt to codebase-specific patterns. Under-specifying constraints leaves
the agent guessing at boundaries.

### Organizing Rules

Group rules by topic within the domain — not by importance tier. The book says "the model
weights earlier content more heavily," so place the rules most likely to be relevant (or
most likely to be violated) first in each group. Priority tiers (CRITICAL / IMPORTANT /
PREFERRED) are useful in system prompts that must balance competing concerns across
domains. Within a single-domain guideline, all rules carry equal authority — grouping by
topic is more useful than ranking by priority.

Use markdown headers (`##`, `###`) to create named topic groups. A guideline with a flat
list of 15 rules is harder to scan than one with 3-4 groups of 4-5 rules each.

### Rule Density

When rules grow too dense, model attention dilutes across too many concerns — a failure
mode the book documents for monolithic prompts that applies equally to overloaded
guidelines. The practical signal is when you find yourself adding edge-case qualifications
to rules rather than writing clean statements. At that point, split the guideline into
two focused guidelines, or extract edge cases into decision criteria.

## Decision Criteria

When a domain involves judgment calls that depend on context, provide explicit decision
criteria — not more rules. Decision criteria answer "when to use which" rather than "what
to do."

```markdown
## When to Split vs. Combine

- **Split** when the types serve different consumers with different access patterns.
- **Combine** when the types share a lifecycle and are always read together.
- **Ask the user** when the types share a lifecycle but serve different consumers.
```

Decision criteria are the guideline's mechanism for handling ambiguity without vague
rules. They give the agent a concrete decision tree rather than a principle it must
interpret.

This section is conditional — include it when the domain has genuine ambiguity that rules
alone cannot resolve. Omit it for reference-style guidelines (commit formats, naming
conventions) where rules are sufficient.

## Examples

Include 2-3 canonical examples when the rules describe a *format* or *pattern* that is
easier to show than to specify. Examples anchor the model's output distribution toward
the correct form. The book warns that examples "can also anchor the model too strongly.
Use them for format, not for content creativity."

Show both correct and incorrect forms when the distinction is non-obvious:

```markdown
## Examples

Correct:
- `feat: Add OAuth2 login flow with Google and GitHub`

Incorrect:
- `Added OAuth2 login flow` (past tense, missing type)
```

Examples are conditional — include them for format-heavy or reference guidelines. Omit
them for philosophy-heavy guidelines (like spec planning) where the rules themselves carry
the message.

## Scope

A guideline calibrates one domain. The boundaries of that domain determine the
guideline's scope.

**When one guideline should become two:** If the rules divide into groups that evolve
independently, serve different agent roles, or would be loaded by different shortcuts,
they are two guidelines sharing a file. Split them. The signal: you find yourself editing
one group while leaving the other untouched across multiple revisions.

**When two guidelines should stay one:** If the rules are deeply interrelated — where
understanding rule A requires the context established by rule B — keep them together.
Splitting would force agents to load both anyway, paying double the discovery cost with
no composition benefit.

**Token budget.** Target 300-800 tokens for the full guideline body — a range calibrated
to sit between skills (~300 tokens, loaded on every invocation) and shortcuts (~500-1,500
tokens, loaded per-procedure). Below 300, the guideline is probably too thin to justify
its own file — fold it into the shortcut that would load it. Above 800, the guideline is
approaching the cost of a shortcut and should be examined for scope creep, embedded
procedures, or content that belongs in a template.

The book quantifies the economics that motivate compactness: "A system with 100 items x
1,000 tokens each costs 100k tokens with eager loading, but only ~5k tokens with
progressive disclosure." Each guideline that stays compact preserves this multiplier.

## Composition

Shortcuts may load multiple guidelines in a single workflow. When two guidelines are
loaded simultaneously, their rules must not conflict.

**Prevent conflicts at authoring time.** Each guideline owns its domain. If two
guidelines both want to say something about error handling, one owns the error handling
rules and the other references it. Do not duplicate rules across guidelines — when the
same rule appears in two places, they drift apart and eventually contradict.

**Category-based loading.** Guidelines compose well when each one covers a distinct
domain category. A code review shortcut might load `security-patterns`, `test-quality`,
and `commit-conventions` simultaneously because each covers a non-overlapping concern.
If two guidelines cover overlapping concerns, merge them or redraw the boundary.

**When contradictions exist,** the book recommends a four-step process: verify the
contradiction is real, document both approaches with a comparison, seek synthesis into a
higher-level pattern, and mark for investigation if uncertain. In practice for paw
guidelines:
resolve contradictions before shipping by redrawing domain boundaries until each rule has
exactly one authoritative source.

## Writing Rules

- **Positive framing throughout.** Specify desired behavior. Reserve negative constraints
  for a dedicated hard-boundaries block.
- **Imperative mood for actions, declarative for criteria.**
- **One concern per rule.** If a rule has "and" connecting two distinct prescriptions,
  split it.
- **Self-contained.** Each rule understandable without reading the others.
- **300-800 tokens total.** Guidelines that exceed 800 tokens should be split or have
  content extracted into templates.
- **No procedures.** Step-by-step workflows belong in shortcuts. A guideline that says
  "first do X, then do Y, then do Z" is a shortcut in disguise.
- **No thinking-mode instructions.** Domain reasoning strategies belong in skills. A
  guideline that says "approach this problem by considering X, then evaluating Y" is a
  skill in disguise.
- **Context flows through files.** Guidelines are file-based injections, not
  conversational instructions. Write for an agent reading a file cold, not for an agent
  mid-conversation.

## Anti-Patterns

| Anti-Pattern | Why It Fails | Better Approach |
|---|---|---|
| Vague rules (ensure quality, consider security) | Agent cannot verify compliance; model deprioritizes unverifiable instructions | Concrete verbs with observable outcomes |
| Negative constraint lists | Pink elephant problem — semantic association increases the forbidden action's activation weight | Positive framing of desired behavior; dedicated hard-boundaries block for true limits |
| Embedded procedures | Couples the guideline to one workflow; inflates token cost beyond the resource budget | Procedures in shortcuts; guidelines contain rules only |
| Kitchen-sink scope | Covers multiple unrelated domains; forces agents to load irrelevant rules | One domain per guideline; split when groups evolve independently |
| Rule duplication across guidelines | Duplicates drift and eventually contradict; agents receive conflicting instructions | Single authoritative source per rule; other guidelines reference, not repeat |
| Over-specified implementation | Robs agents of ability to adapt to codebase patterns; creates brittleness | Specify constraints and criteria; leave implementation approach flexible |
| Large guidelines (1,000+ tokens) | Defeats progressive disclosure economics; approaches shortcut cost for resource-layer content | Target 300-800 tokens; split or extract to templates |
| Missing domain context | Agent loads rules without understanding the tension they resolve; applies them mechanically | 1-3 sentences establishing scope and the core competing concern |

## Checklist

- [ ] Frontmatter: `name`, `description` (noun phrase), and `roles`
- [ ] Domain context: 1-3 sentences establishing scope and core tension
- [ ] Rules: positive framing, imperative/declarative mood, concrete verbs, self-contained
- [ ] Rules grouped by topic with markdown headers
- [ ] Decision criteria included if the domain has genuine ambiguity (conditional)
- [ ] Examples included if the domain is format-heavy (conditional)
- [ ] No procedures — all step-by-step workflows live in shortcuts
- [ ] No thinking-mode instructions — reasoning strategies live in skills
- [ ] Single domain — rules that evolve independently belong in separate guidelines
- [ ] No rule duplication with other guidelines
- [ ] 300-800 tokens total
