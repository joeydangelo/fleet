---
name: commit-conventions
description: Conventional Commits format with scope, body, and multi-agent extensions
roles: [orchestrator, builder]
---

Commit messages serve three audiences: humans scanning `git log`, agents mining history
for pattern learning, and automation parsing structured prefixes for routing. Conventional
Commits syntax balances brevity for humans with structure for machines.

## Format

- Structure: `<type>(<scope>): <description>` — scope is optional, use only when it
  disambiguates (e.g., `fix(parser):` when multiple modules could apply).
- First line: imperative mood, 72 characters or fewer.
- Body: optional. Explain *why*, not *what* — the diff shows what changed.
- Breaking changes: add `!` before `:` and include `BREAKING CHANGE:` in the footer.
- Commit messages contain decisions, not reasoning. Omit agent thought process,
  meta-commentary, and conversational filler.

## Type Selection

| Type | Artifact Category |
|---|---|
| `feat` | New capability or behavior |
| `fix` | Bug correction |
| `refactor` | Code restructuring (no behavior change) |
| `perf` | Performance improvement |
| `test` | Test additions or updates |
| `docs` | Documentation (README, API docs, help text) |
| `style` | Formatting (no logic change) |
| `build` | Build system or external dependencies |
| `ci` | CI/CD configuration |
| `chore` | Maintenance (deps, config, upgrades) |

- Select type by the *category of artifact changed*, not the motivation. A typo fix in
  docs is `docs:`, not `fix:`. A test refactor is `refactor:`, not `test:`.

## Multi-Agent Metadata

- Include the task or issue number in the description when available
  (e.g., `feat: add retry logic for webhook delivery (#42)`).

## Examples

Correct:
- `feat: add OAuth2 login flow with Google and GitHub`
- `fix(api): return 404 for missing user profiles`
- `docs: update CLI usage examples`
- `refactor: extract token refresh logic to separate module`
- `chore: update dependencies`

Incorrect:
- `update files` — no type prefix; unmineable by pattern analysis
- `Added OAuth2 login flow` — past tense, missing type
- `fix: fix typo in README` — artifact is docs, use `docs:`
- `Based on the analysis, this commit updates auth` — reasoning leakage, not a decision
