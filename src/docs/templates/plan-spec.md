---
name: plan-spec
description: Template for feature planning specification documents
---
# Feature: [Feature Name]

**Date:** YYYY-MM-DD | **Status:** Draft | In Review | Approved | Implemented

## Overview

What this feature does and why it exists. Include enough context for an agent to
understand the motivation without external references.

## Goals

- Goal 1
- Goal 2

## Non-Goals

- What this feature explicitly does NOT cover

## Design

### Target Experience

What the user (or consuming system) sees: commands, output, UI flow, error messages,
the core interaction loop. Lead with behavior, not internals.

### Data Shapes

Core types, schemas, and data models. Show the actual structure — TypeScript
interfaces, YAML examples, or database schemas — not prose descriptions of them.

### System Boundaries

Where data enters and leaves the system (CLI args, API endpoints, config files,
external services). Validation and error handling live here; internal code trusts
its inputs.

## Verification

How to prove this works. Not "it compiles" — describe how to exercise the real
feature path end-to-end and confirm the intended behavior.

## Open Questions

- Unresolved decisions or unknowns that need answers before implementation
