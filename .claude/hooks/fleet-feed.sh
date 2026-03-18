#!/bin/bash
# Emit tool-level events to .fleet/run/feed.ndjson
# Installed by: fleet init
# Fires on PostToolUse (all tools)

# Resolve main repo root (worktrees write to the shared feed file)
MAIN_ROOT=$(cd "$(git rev-parse --git-common-dir)/.." 2>/dev/null && pwd)
if [ -z "$MAIN_ROOT" ]; then
  MAIN_ROOT="$(pwd)"
fi
export FLEET_MAIN_ROOT="$MAIN_ROOT"

# Only emit when a fleet session is active (feed file is created by fleet up)
if [ ! -f "$MAIN_ROOT/.fleet/run/feed.ndjson" ]; then
  exit 0
fi

# Detect task name from .fleet/tasks/*.md
task_file=$(ls .fleet/tasks/*.md 2>/dev/null | head -1)
if [ -n "$task_file" ]; then
  export FLEET_TASK=$(basename "$task_file" .md)
else
  export FLEET_TASK="orchestrator"
fi

mkdir -p "$MAIN_ROOT/.fleet/run"
# Pipe stdin directly to node — avoids MAX_ARG_STRLEN limit on large tool outputs
node "$MAIN_ROOT/.claude/hooks/fleet-feed.cjs"

exit 0
