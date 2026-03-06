#!/bin/bash
# Check GitHub CLI (gh) availability for paw workflows
# Installed by: paw init
# This script runs on SessionStart — check-only, never installs software

if ! command -v gh &> /dev/null; then
    echo "[gh] WARNING: gh CLI not found"
    echo "[gh] Install: https://cli.github.com/"
    exit 0
fi

echo "[gh] CLI found at $(command -v gh)"

if gh auth status &> /dev/null; then
    echo "[gh] Authenticated successfully"
elif [ -n "$GH_TOKEN" ]; then
    echo "[gh] NOTE: GH_TOKEN not set - some operations may require authentication"
    echo "[gh] See: docs/general/agent-setup/github-cli-setup.md"
else
    echo "[gh] NOTE: Not authenticated - some operations may require authentication"
    echo "[gh] Run: gh auth login"
fi

exit 0
