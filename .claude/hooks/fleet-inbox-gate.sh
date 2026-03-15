#!/bin/bash
# Block all tool calls when the agent has unanswered messages
# Installed by: fleet init
# Fires on PreToolUse (all tools), uses exit 2 to block — works even in bypass-permissions mode

input=$(cat)

# Only gate worktrees with active tasks
if ! ls .fleet/tasks/*.md 1>/dev/null 2>&1; then
  exit 0
fi

# Read task name from the task file
task_file=$(ls .fleet/tasks/*.md 2>/dev/null | head -1)
task_name=$(basename "$task_file" .md)

# Check for unanswered-message flag file
FLAG_FILE=".fleet/run/.unanswered-${task_name}"
if [ ! -f "$FLAG_FILE" ]; then
  exit 0
fi

# Flag file exists — check if this is a fleet Bash command (always allowed)
# Extract the command value and check that a command segment starts with "fleet "
if echo "$input" | grep -q '"Bash"'; then
  cmd=$(echo "$input" | sed -n 's/.*"command"[[:space:]]*:[[:space:]]*"\(.*\)".*/\1/p')
  if echo "$cmd" | grep -qE '(^|&& |; )fleet '; then
    exit 0
  fi
fi

# Deny — exit 2 blocks the tool call even in bypass-permissions mode
# stderr is fed back to the agent as the error message
cat "$FLAG_FILE" >&2
exit 2
