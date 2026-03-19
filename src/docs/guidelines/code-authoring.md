---
name: code-authoring
description: Code clarity and anti-slop discipline at authoring time — naming, structure, comments, and codebase alignment
roles: [builder]
---

Every line a builder writes becomes the example future agents learn from. The core
tension is shipping speed vs. codebase coherence — slop compounds when agents
introduce novel patterns, vague names, or undocumented rationale, because subsequent
agents replicate whatever structure they encounter first.

## Naming & Types

- Use descriptive names that reveal intent for variables, functions, and types — a
  reader should understand purpose without checking the implementation.
- Give recurring or domain-meaningful data shapes a named type.
- Use precise types (literals, enums, unions) over broad primitives like string or number.
- Make absence explicit with `| null` or `| None` rather than relying on optional parameters or falsy values.
- Use explicit return type annotations for top-level functions.
- Define explicit types for function parameters, especially complex objects and
  configuration.

## Function Design & Control Flow

- Handle edge cases early with guard clauses and use switch/if-else over nested
  ternaries — keep the happy path flat and left-aligned.
- Return early from conditions rather than using else branches — reduce indentation and make the exit path obvious.
- Keep functions focused on a single task — if a function needs a comment to separate sections, those sections should be separate functions.
- Prefer named functions over anonymous ones for better stack traces and
  readability.
- Always handle errors explicitly — never silently swallow failures.
- Extract repeated logic into shared functions — if the same pattern appears three or more times, abstract it.

## Code Organization

- Group and sort imports: standard library, external packages, then internal
  modules — separated by blank lines.
- Follow a predictable directory structure — group by feature or domain, not by file type.
- Replace magic numbers and hard-coded literals with descriptively named constants, co-located in a relevant constants or config file.
- Dependencies should point inward — business logic never imports from infrastructure, HTTP handlers, or UI layers.
- Default to immutable data — use const, readonly, frozen, or final unless mutation is specifically needed.
- When in doubt, choose clarity over cleverness — explicit, readable code beats compact code.

## Comments & Observability

- Write comments that explain *why*, not *what* — capture rationale, tradeoffs, and non-obvious pitfalls.
- Write self-contained comments — state full context without relying on numbered sequences or positional references.
- Give exported functions concise docstrings focused on purpose; omit param/return docs when names and types are self-evident.
- Document fields on type definitions as the single source of truth, not at usage sites.
- Use the language's idiomatic doc comment syntax (`/** */` in TypeScript, `"""`
  in Python, `///` in Rust) so IDE tooling surfaces documentation at call sites.
- Log at boundaries (API entry, external calls, errors) with structured key-value pairs, not string interpolation.

