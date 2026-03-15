#!/bin/bash
# Check inbox for messages from orchestrator and other agents
# Installed by: fleet init
# Fires on SessionStart and UserPromptSubmit

# Only in fleet worktrees with active tasks
if ! ls .fleet/tasks/*.md 1>/dev/null 2>&1; then
  exit 0
fi

# Get npm global bin in PATH
NPM_PREFIX=$(npm config get prefix 2>/dev/null)
if [ -n "$NPM_PREFIX" ] && [ -d "$NPM_PREFIX/bin" ]; then
  export PATH="$NPM_PREFIX/bin:$PATH"
fi
export PATH="$HOME/.local/bin:$HOME/bin:/usr/local/bin:$PATH"

fleet inbox

exit 0
