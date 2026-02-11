import { describe, it, expect } from "vitest";
import { validateSummary, REQUIRED_SECTIONS, generateErrorTemplate } from "../src/lib/summary.js";
import { generateTaskFile } from "../src/lib/session.js";
import type { PawConfig } from "../src/lib/config.js";

describe("validateSummary", () => {
  const validSummary = `## What I did
- Added OAuth2 login flow

## Interface changes
- AuthMiddleware now takes OAuthConfig

## Watch out
- Token refresh requires OAUTH_SECRET env var`;

  it("accepts a summary with all required sections", () => {
    const result = validateSummary(validSummary);

    expect(result.valid).toBe(true);
    expect(result.missing).toEqual([]);
  });

  it("rejects a summary missing 'What I did'", () => {
    const summary = `## Interface changes
- Changed exports

## Watch out
- Nothing`;

    const result = validateSummary(summary);

    expect(result.valid).toBe(false);
    expect(result.missing).toContain("What I did");
  });

  it("rejects a summary missing 'Interface changes'", () => {
    const summary = `## What I did
- Built the thing

## Watch out
- Be careful`;

    const result = validateSummary(summary);

    expect(result.valid).toBe(false);
    expect(result.missing).toContain("Interface changes");
  });

  it("rejects a summary missing 'Watch out'", () => {
    const summary = `## What I did
- Built the thing

## Interface changes
- New export`;

    const result = validateSummary(summary);

    expect(result.valid).toBe(false);
    expect(result.missing).toContain("Watch out");
  });

  it("rejects a flat paragraph with no sections", () => {
    const summary = "I finished the auth work, everything should be good.";

    const result = validateSummary(summary);

    expect(result.valid).toBe(false);
    expect(result.missing).toEqual(REQUIRED_SECTIONS);
  });

  it("accepts sections with ### heading level", () => {
    const summary = `### What I did
- Built the thing

### Interface changes
- New export

### Watch out
- Be careful`;

    const result = validateSummary(summary);

    expect(result.valid).toBe(true);
    expect(result.missing).toEqual([]);
  });

  it("is case-insensitive for section headers", () => {
    const summary = `## what i did
- Built the thing

## interface changes
- New export

## watch out
- Be careful`;

    const result = validateSummary(summary);

    expect(result.valid).toBe(true);
    expect(result.missing).toEqual([]);
  });

  it("reports all missing sections at once", () => {
    const summary = "Just a paragraph.";

    const result = validateSummary(summary);

    expect(result.missing).toHaveLength(3);
    expect(result.missing).toContain("What I did");
    expect(result.missing).toContain("Interface changes");
    expect(result.missing).toContain("Watch out");
  });
});

describe("summary template single source of truth (paw-em2l)", () => {
  it("generateErrorTemplate contains all REQUIRED_SECTIONS", () => {
    const template = generateErrorTemplate();
    for (const section of REQUIRED_SECTIONS) {
      expect(template).toContain(`## ${section}`);
    }
  });

  it("task file template contains all REQUIRED_SECTIONS as headings", () => {
    const config: PawConfig = {
      base: "main",
      target: "feature/dash",
      tasks: { auth: { focus: "src/auth/" } },
    };
    const worktree = {
      taskName: "auth",
      branch: "feature/dash-auth",
      worktreePath: "/projects/acme-app-paw-auth",
    };

    const taskFile = generateTaskFile(config, "auth", worktree);
    for (const section of REQUIRED_SECTIONS) {
      expect(taskFile).toContain(`### ${section}`);
    }
  });
});
