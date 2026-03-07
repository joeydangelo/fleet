---
name: commit-conventions
description: Conventional Commits format with scope, body, and multi-agent extensions
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
- `docs`: User-facing documentation (README, API docs, help text)
- `resolve`: Merge conflict resolution (from `paw merge` conflicts)

The type reflects the *category of artifact* being changed. Fixing a typo in docs is
`docs:`, not `fix:`.

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
