#!/bin/bash
# Record agent heartbeat and check inbox on every tool use
# Installed by: fleet init
# Fires on PostToolUse (all tools)

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

# Record heartbeat (fast, fire-and-forget)
fleet heartbeat &

# Debounced inbox check (every 30s)
LAST_CHECK_FILE=".fleet/run/.last-inbox-check"
NOW=$(date +%s)
LAST=0
if [ -f "$LAST_CHECK_FILE" ]; then
  LAST=$(cat "$LAST_CHECK_FILE" 2>/dev/null || echo 0)
fi
ELAPSED=$((NOW - LAST))
if [ "$ELAPSED" -ge 30 ]; then
  echo "$NOW" > "$LAST_CHECK_FILE"
  fleet inbox
fi

exit 0
