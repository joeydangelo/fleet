#!/bin/bash
# Remind agents to submit for review after committing
# Installed by: fleet init
# Fires on PostToolUse:Bash for git commit commands

input=$(cat)

# Remind about fleet review on git commit
if [[ "$input" == *"git commit"* ]]; then
  if ls .fleet/tasks/*.md 1>/dev/null 2>&1; then
    task_file=$(ls .fleet/tasks/*.md 2>/dev/null | head -1)
    task_name=$(basename "$task_file" .md)

    # Check if task is already in_review or done on sync branch
    task_status=$(git show "fleet-sync:state.json" 2>/dev/null | grep -A2 "\"$task_name\"" | grep -o '"status"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*"\([^"]*\)"/\1/')
    if [ "$task_status" != "in_review" ] && [ "$task_status" != "done" ]; then
      echo ""
      echo "FLEET REMINDER: You have not submitted for review yet."
      echo "  After committing, follow the Publish phase:"
      echo "    1. Write your summary: fleet summary <<'EOF' ... EOF"
      echo "    2. Submit for review: fleet review"
      echo ""
    fi
  fi
fi

exit 0
