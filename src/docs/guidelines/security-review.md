---
name: security-review
description: Security vulnerability detection and severity calibration for code review
roles: [reviewer]
---

The core tension is false positives vs. missed vulnerabilities — a reviewer that flags
everything loses credibility; one that misses real issues defeats its purpose. Every
finding requires an exploitable path, not just a pattern that looks suspicious.

## Input Handling

- Verify user-controlled data is validated before use in queries, commands, file paths,
  or HTML output. Trace the data flow from entry point to sink.
- Check deserialization of external input (JSON.parse, pickle, YAML.load) for type
  coercion or prototype pollution risks.
- Confirm URL and path construction uses library APIs, not string concatenation with
  user input.

## Authentication and Authorization

- Verify auth checks exist on every route or handler that accesses protected resources.
  Missing middleware on a single endpoint is a bypass.
- Check that role/permission validation happens server-side, not only in UI rendering
  or client-side guards.
- Confirm token comparison uses constant-time functions (timingSafeEqual, hmac.compare_digest)
  when comparing secrets or hashes.

## Data Exposure

- Check error handlers and logging for leaked stack traces, internal paths, database
  schemas, or connection strings in user-facing responses.
- Verify sensitive fields (passwords, tokens, PII) are excluded from serialization,
  API responses, and log output.
- Confirm that debug/verbose modes are gated behind environment checks, not left
  enabled by default.

## Credential and Secret Management

- Verify secrets, API keys, and tokens are read from environment variables or secret
  stores, not embedded as string literals in source.
- Check that credentials are excluded from git-tracked files (.env committed, config
  files with tokens, test fixtures with real keys).
- Confirm connection strings and webhook URLs are parameterized, not hardcoded.

## Severity Calibration

- **CRITICAL** when the diff introduces an exploitable path: unauthenticated access to
  protected data, SQL/command injection with user input reaching a sink, secrets
  committed to source, or disabled security controls (CSRF, CORS wildcard on
  credentialed endpoints).
- **MAJOR** when the diff creates conditions for exploitation but lacks a direct path
  in the current code: missing input validation on an internal API that may become
  external, overly broad error responses, or auth checks present but with logic gaps.
- **MINOR** is rare for security. Reserve for hardening suggestions where no
  vulnerability exists: adding rate limiting, tightening CSP headers, or preferring
  a more specific permission scope.

## False Positive Checks

- **Trace before filing.** Follow user input from entry to sink. Flag only when the
  data actually reaches a dangerous operation without sanitization.
- **Respect framework guarantees.** ORMs with parameterized queries prevent SQL
  injection by default. React escapes JSX by default. Flag only when the code bypasses
  these built-in protections (dangerouslySetInnerHTML, raw queries).
- **Distinguish configuration from vulnerability.** A permissive CORS policy in a
  local dev config is not a production finding. Check the file's purpose and environment.

## Examples

- `CRITICAL/security src/api/users.ts:42 -- SQL query built with string interpolation from req.query.id — enables SQL injection on public endpoint`
- `MAJOR/security src/auth/middleware.ts:18 -- permission check compares role string with === instead of constant-time comparison — timing side-channel on auth tokens`
