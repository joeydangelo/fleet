---
title: Task Summary Template
description: Structure for paw done summaries — what you did, interface changes, warnings
---
```markdown
## What I did
- [Major accomplishment 1]
- [Major accomplishment 2]

## Interface changes
- [Type/export/API changes other agents need to know about]
- [New exports, renamed functions, changed signatures]

## Watch out
- [Non-obvious things: env vars, ordering dependencies, breaking changes]
- [Anything that isn't clear from the diff alone]
```

## Usage

Use a heredoc to pass the summary to `paw done`:

```bash
paw done << 'EOF'
## What I did
- Added OAuth2 login flow with Google and GitHub providers
- Refactored AuthMiddleware to accept OAuthConfig

## Interface changes
- AuthMiddleware now takes OAuthConfig instead of raw token string
- New export: refreshToken() from src/auth/oauth.ts
- Token type is now AccessToken | RefreshToken

## Watch out
- Any code importing from src/auth/types.ts needs to handle OAuthConfig
- Token refresh requires OAUTH_SECRET env var
EOF
```

## Guidelines

- **Interface changes** is the most important section. This is what resolver agents
  and other agents reading your summary actually need.
- **Watch out** is for things invisible in the diff — environment requirements,
  ordering constraints, implicit dependencies.
- Skip file lists. The git history already has that. Focus on what another agent
  needs to *understand* about your changes, not *enumerate* them.
- If your work is incomplete, say so: what's done, what's not, and why.
