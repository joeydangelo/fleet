---
title: Setup GitHub CLI
description: Ensure GitHub CLI (gh) is installed and authenticated
category: orchestrator
---
The `from-github-issue` and `to-pr` shortcuts require the GitHub CLI (`gh`).
This shortcut verifies it's working and guides you through fixing it if not.

## Instructions

1. **Check if gh works and is authenticated:**

   ```bash
   gh auth status
   ```

   If this succeeds (shows "Logged in to github.com"), you're done -- skip the
   rest.

2. **If gh is not found:** Install it.

   - **macOS:** `brew install gh`
   - **Linux (Debian/Ubuntu):**
     ```bash
     curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
       | sudo dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg
     echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] \
       https://cli.github.com/packages stable main" \
       | sudo tee /etc/apt/sources.list.d/github-cli.list > /dev/null
     sudo apt update && sudo apt install gh
     ```
   - **Windows:** `winget install GitHub.cli` or download from
     https://cli.github.com

   After installing, run `gh auth status` again to verify.

3. **If gh exists but is not authenticated:** The `GH_TOKEN` environment variable
   must be set with a GitHub personal access token.

   Tell the user:
   > gh is installed but not authenticated. Set the `GH_TOKEN` environment variable
   > with a GitHub personal access token before starting the session. The token
   > needs `repo` scope (and `workflow` scope if you use GitHub Actions).
   >
   > Create one at: https://github.com/settings/tokens

4. **If gh exists but is broken** (`gh --version` fails, segfaults, etc.):
   Reinstall using the steps above. An outdated or corrupted binary won't work.

## Quick Reference

| Problem | Solution |
|---|---|
| `gh: command not found` | Install gh (see step 2) |
| `gh auth status` shows errors | Set `GH_TOKEN` env var (see step 3) |
| `Bad credentials` | Token expired or lacks permissions -- regenerate it |
| `Resource not accessible` | Token lacks required scopes (needs `repo`) |
