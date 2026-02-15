---
title: Setup GitHub CLI
description: Ensure GitHub CLI (gh) is installed and authenticated
category: orchestrator
---
The `from-github-issue` and `to-pr` shortcuts require the GitHub CLI (`gh`).

## Verify First

Don't assume gh works just because it's on the system. Old versions, broken
installs, and expired tokens all look like "gh exists" but fail when you
actually use it. The real test:

```bash
gh auth status
```

If this shows "Logged in to github.com" with a valid account, you're done.
If it fails for any reason, follow the steps below.

## Common Problems

1. **gh not found:** Install it.
   - **macOS:** `brew install gh`
   - **Windows:** `winget install GitHub.cli` or download from
     https://cli.github.com
   - **Linux (Debian/Ubuntu):**
     ```bash
     curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
       | sudo dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg
     echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] \
       https://cli.github.com/packages stable main" \
       | sudo tee /etc/apt/sources.list.d/github-cli.list > /dev/null
     sudo apt update && sudo apt install gh
     ```

2. **gh exists but not authenticated or token expired:** Tell the user:
   > gh needs authentication. Either run `gh auth login` interactively, or
   > set the `GH_TOKEN` environment variable with a personal access token.
   >
   > The token needs `repo` scope (and `workflow` if you use GitHub Actions).
   > Create one at: https://github.com/settings/tokens

3. **gh exists but broken or outdated:** `gh --version` fails, segfaults, or
   returns a very old version. Reinstall using the steps above.

4. **gh installed but not in PATH:** Use the full path, or add its directory
   to PATH (e.g., `~/.local/bin`).

## Quick Reference

| Problem | Solution |
|---|---|
| `gh: command not found` | Install gh (see step 1) |
| `token in keyring is invalid` | `gh auth login` or set `GH_TOKEN` |
| `Bad credentials` | Token expired -- regenerate or `gh auth login` |
| `Resource not accessible` | Token lacks `repo` scope |
| `gh --version` fails | Broken install -- reinstall |
