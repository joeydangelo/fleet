---
name: code-authoring
description: Code clarity and anti-slop discipline at authoring time — naming, structure, comments, and codebase alignment
roles: [builder]
---

Every line a builder writes becomes the example future agents learn from. The core
tension is shipping speed vs. codebase coherence — slop compounds when agents
introduce novel patterns, vague names, or undocumented rationale, because subsequent
agents replicate whatever structure they encounter first.

## Naming and Structure

- Name variables, functions, files, and types to reveal purpose — a reader
  understands intent without reading the implementation.
- Extract and name inline or anonymous structures as named types when they recur or
  carry domain meaning.
- Flatten nested control flow by handling edge cases early with guard clauses,
  keeping the main logic path at the shallowest indentation level.
- Choose explicit, readable control flow over compact expressions — expand branching
  conditions into switch statements or if/else chains that scan at a glance.

## Constants and Types

- Assign every magic number and domain-specific literal to a descriptive named
  constant, defined in the module's appropriate configuration or constants file.
- Declare the most precise type the value can hold — use specific literal types,
  enums, or discriminated unions rather than broad primitives.
- Encode intentional absence as an explicit type (`| null` in TypeScript, `| None`
  in Python) rather than relying on optional parameters or implicit falsy values.

## Comments and Docstrings

- Use the language's idiomatic doc comment syntax (`/** */` in TypeScript, `"""`
  in Python, `///` in Rust) so IDE tooling surfaces documentation at call sites.
- Write comments that explain *why* code exists — capture rationale, tradeoffs, and
  non-obvious pitfalls. Do NOT restate what the code does.
- Give exported functions and public types concise docstrings focused on purpose;
  omit argument and return descriptions when names and types make them self-evident.
- Place field documentation on type and interface definitions as the single source
  of truth, not at usage sites.
- Write each comment to stand alone — state the full context it needs without
  relying on numbered sequences or positional references.
