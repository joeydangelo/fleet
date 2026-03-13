---
name: testing
description: Test design calibration for builder agents — what to test, where to draw the mock boundary, and how to avoid testing theatre
roles: [builder]
---

The core tension is testing theatre vs. real verification. Agents generate tests that
pass — that's the easy part. The hard part is writing tests that would fail if the
implementation were wrong. Tests that mock internal components, verify implementation
details, or cover only the happy path give false confidence while reporting green.

## What to Test

- Test behavior and outcomes, not implementation details. Assert what the code produces,
  not how it produces it — tests coupled to internal structure break on refactor without
  catching bugs.
- Cover failure paths and edge cases, not just the happy path. Target at least 30% of
  test cases for error conditions, boundary values, and malformed input.
- Write each test so it would fail if the targeted behavior were removed or broken. A
  test that passes regardless of the code under test is theatre.

## Test Isolation

- Use real services for components you own: your database, your filesystem, your internal
  modules. Mocking your own code hides whether the real integration works.
- Mock only at external boundaries — third-party APIs, payment providers, and services
  you do not control. The mock replaces the external service's boundary, not your own
  abstractions around it.
- Verify integration evidence against real service artifacts: actual database records,
  real queue entries, genuine API responses. Stubbed responses as proof of integration
  are testing theatre.

## Test Quality Signals

- A test suite proves the implementation works when every test would fail if its
  targeted behavior were removed. Redundant tests verifying the same behavior through
  different syntax add maintenance cost without verification value.
- Treat coverage as a stop condition (80% threshold), not a goal to maximize. Tests
  written only to increase a coverage number without verifying meaningful behavior are
  theatre.

## Mock Boundary Decision

- **Use real services** when the dependency is code you own or infrastructure you
  control — your database, your queue, your internal APIs.
- **Mock at the boundary** when the dependency is external and you do not control its
  availability, cost, or side effects — third-party payment APIs, external webhooks,
  rate-limited services.
- **Default to real** when a shared service sits between internal and external — staging
  environments, shared test databases, partner APIs with test modes. If a real service
  is available, use it.

## Examples

- Theatre: `test("saves user", () => { mockDb.save(user); expect(mockDb.save).toHaveBeenCalled() })` — mocks the database you own, asserts the mock was called, proves nothing about real persistence.
- Real: `test("saves user", async () => { await db.save(user); const row = await db.get(user.id); expect(row.name).toBe("Alice") })` — uses real database, verifies actual stored state.
- Theatre: test passes even when the function under test is replaced with a no-op — the test asserts framework behavior, not application behavior.
