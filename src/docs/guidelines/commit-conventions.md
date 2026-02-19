---
title: Commit Conventions
description: Conventional Commits format with extensions for multi-agent workflows
---
# Commit Conventions

[Conventional Commits](https://www.conventionalcommits.org/) with extensions for
multi-agent development.

## Format

```
<type>[optional scope][!]: <description>

[optional body]

[optional footer(s)]
```

- First line short, ideally 72 characters or less
- Imperative mood ("Add feature" not "Added feature")
- No scope by default; only use when disambiguation is needed (e.g., `fix(parser):`)
- Breaking changes: add `!` before `:` AND include `BREAKING CHANGE:` in the footer

## Types

Software development:

- `feat`: New feature
- `fix`: Bug fix
- `style`: Code formatting (no logic change)
- `refactor`: Code restructuring (no behavior change)
- `perf`: Performance improvement
- `test`: Adding or updating tests
- `build`: Build system or external dependencies
- `ci`: CI/CD configuration and scripts
- `chore`: Maintenance (deps, config, upgrades)
- `docs`: User-facing documentation

Agentic project work:

- `plan`: Design docs, specs, architecture decisions
- `research`: Investigation, notes, comparison reports
- `ops`: Operational tasks (issue tracking, publishing, maintenance)
- `process`: Methodology, conventions, workflow changes
- `resolve`: Merge conflict resolution (from `paw merge` conflicts)

The type reflects the *category of artifact* being changed. Fixing a typo in docs is
`docs:`, not `fix:`.

**Key distinctions:** `docs` is for users; `plan` is internal design for building;
`research` is internal learning; `ops` is operational; `process` is methodology.

## Scope in Multi-Agent Sessions

When multiple agents commit to the same branch (or branches that merge into a shared
target), scope helps reviewers and resolver agents trace which task produced which change.
Use the paw task name as scope when it adds clarity:

```
feat(auth): Add OAuth2 login flow with Google and GitHub
feat(api): Add user profile REST endpoints
fix(dashboard): Handle missing profile gracefully
```

This isn't mandatory — skip scope for unambiguous changes.

## Examples

```
feat: Add OAuth2 login flow with Google and GitHub
fix(api): Return 404 for missing user profiles
docs: Update CLI usage examples
refactor: Extract token refresh logic to separate module
test: Add integration tests for merge conflict flow
chore: Update dependencies
plan: Design user notification preferences spec
resolve(api): Reconcile auth types after parallel agent edits
```
