# Skill Template Guide

Skills represent a third category beyond tools and prompts. Tools define what an agent
can *do*. Prompts define how an agent *thinks*. Skills activate domain-specific
**thinking modes** — temporary reasoning specialization injected on demand.

## Progressive Disclosure

| Layer | Artifact | Token Cost | Loaded When |
|---|---|---|---|
| **Discovery** | Skill frontmatter `description` | ~50 tokens | Always (system prompt) |
| **Activation** | Skill body (SKILL.md) | ~200-300 tokens | Agent invokes the Skill tool |
| **Resources** | Shortcuts, guidelines, templates | ~1,000+ tokens | Agent runs `<cli> shortcut <name>` |

The skill body sits between a one-line trigger and the full shortcut payload.
Shortcuts contain all procedural knowledge. The skill never duplicates this.

## How Invocation Works

```
1. Agent sees skill metadata in system prompt: "code review skill available"
2. Agent encounters relevant task, invokes Skill tool
3. System injects skill body + enables declared tools
4. Agent now reasons with specialized thinking mode
5. Agent loads shortcuts on demand for detailed procedures
6. After task completion, injected context expires
```

Discoverability (the agent knows what's possible) balanced with context efficiency
(token cost deferred until invocation).

## Structure

Every skill has the same four parts in the same order:

1. **Frontmatter** — context contract: `name`, `description`, `allowed-tools`, `globs`
2. **Behavioral instructions** — what the agent temporarily becomes. Domain-specific
   reasoning strategies, constraints, decision criteria. Brief prose, not steps.
3. **Commands** — table of CLI commands available in this thinking mode.
4. **Directories** — three auto-generated tables (shortcuts, guidelines, templates)
   wrapped in `<!-- BEGIN/END -->` comment markers. The CLI populates these.

## Frontmatter as Context Contract

```yaml
name: kebab-case-name
description: |-
  Starts with a verb phrase — what thinking mode this activates.
  Use for: comma-separated noun phrases.
  Invoke when user mentions: lowercase trigger keywords.
allowed-tools: Bash(cli:*)
globs: ".system/**"
```

- **`name`** — Skill identity. Kebab-case. Matches the directory name.
- **`description`** — Three lines, pipe-literal. First line drives Skill tool matching.
  `Use for:` aids LLM relevance reasoning. `Invoke when:` catches natural language.
- **`allowed-tools`** — What tools this thinking mode enables. The platform enforces
  boundaries. No `disallowed-tools` field.
- **`globs`** — File patterns this skill manages.

## Behavioral Instructions

The body of the skill is *not* a workflow. It describes how the agent should reason
differently when this thinking mode is active:

- What domain expertise to apply
- What constraints govern decisions
- What quality criteria matter
- What trade-offs to favor

Procedures, step-by-step workflows, and multi-phase processes belong in shortcuts.
The behavioral instructions change *how* the agent thinks; shortcuts tell it *what
to do*.

## Writing Rules

- **Third-person only.** No "you", "I", or "we". Use imperative for instructions.
- **Active voice.** Direct statements only.
- **No workflows.** All procedures live in shortcuts.
- **No embedded guides.** Any instruction longer than a few sentences belongs in a
  shortcut, guideline, or template.
- **Under 300 tokens.** The skill body pays its token cost on every invocation.

## Anti-Patterns

| Anti-Pattern | Why It Fails | Better Approach |
|---|---|---|
| Embedding workflows in the skill body | Inflates token cost; duplicates shortcut content | Shortcuts contain all procedures |
| Mixing concerns | A skill that covers two domains loses specialization | One thinking mode per skill |
| Large skill bodies (500+ tokens) | Defeats progressive disclosure | Extract to shortcuts; keep under 300 tokens |
| Bolting on system-specific conventions | Couples skills to one system's patterns | Skill describes the thinking mode, not the system |

## Checklist

- [ ] Frontmatter: `name`, `description`, `allowed-tools`, `globs`
- [ ] Description: three-line format (action, use-for, triggers)
- [ ] Behavioral instructions: reasoning strategies, not procedures
- [ ] Commands table: primary commands only
- [ ] Three directory sections with `<!-- BEGIN/END -->` markers
- [ ] No procedural content — all workflows in shortcuts
- [ ] Third-person voice throughout
- [ ] Under 300 tokens
