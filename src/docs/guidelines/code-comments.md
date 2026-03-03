---
title: Code Comments
description: Language-agnostic rules for writing clean, maintainable comments
---
# Code Comments

## When to Comment

- Comment when intent is subtle, non-obvious, or avoids a known bug.
- Never restate what's already clear from function names, variable names, or types.

- Never echo a log message in a comment above it:

  ```typescript
  // BAD — comment just restates the log call
  // Log LLM response details
  await logger.info('llm-response', 'LLM response received', {
    contentLength: content.length,
    toolCalls: result.toolCalls?.length || 0,
    ...
  ```

- No changelog-style comments like "Added this function" — they're meaningless
  to anyone reading the code later. That context belongs in commit messages.
- No decorated headings (`===== SECTION =====`).
- No numbered steps (`// Step 3: …`) — they break when code moves. Use
  plain sequencing (`// Now fetch from cache`).
- No emojis or special Unicode characters in comments.

## Stale Comments

Flag comments that describe something other than the current code:

- **Historical notes**: "Types moved to runtimeContext.ts" — belongs in a
  commit message, not the codebase.
- **Removed-code narration**: `// other fields are now removed` — just
  delete the comment along with the code.
- **Constant parroting**: `const MAX_RETRIES = 5; // Maximum number of retries is 5`
  — the code already says this.

## Syntax

- In TypeScript/JavaScript, use `/** ... */` for functions, methods, variables,
  and file headers — enables IDE hover and documentation tooling.

## Docstrings

Docstrings belong on public types, interfaces, major functions/methods, and
non-obvious helpers. Skip test functions and trivial helpers whose purpose is
obvious from the name.

- **Explain the why, not the what.** If a function is called `getUserById(id)`,
  don't write "Gets a user by ID." Explain non-obvious behavior, side effects,
  or constraints.
- **Keep it concise.** One to three sentences. Don't repeat parameter names or
  return types already visible in the signature.
- **Use `/** ... */`** in TypeScript/JavaScript for IDE hover support.
- **Use backticks** around variable names and inline code references.

```ts
/**
 * Render a ContextSummary as readable markdown for both LLMs and users.
 */
export function formatContextMarkdown(
  summary: ContextSummary,
  options?: { maxHoldings?: number },
): string {
  ...
}
```

Flag docstrings that restate the function name, parrot parameter types, or
describe behavior that no longer matches the code.
