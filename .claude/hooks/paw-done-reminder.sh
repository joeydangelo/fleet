#!/bin/bash
# Remind agents to run paw done before ending session
# Installed by: paw setup
# Fires on PostToolUse:Bash for git commit/push commands

input=$(cat)
command=$(echo "$input" | jq -r '.tool_input.command // empty')

# Only trigger on git push or git commit
if [[ "$command" == git\ push* ]] || [[ "$command" == *"git push"* ]] || \
   [[ "$command" == git\ commit* ]] || [[ "$command" == *"git commit"* ]]; then
  # Check if we're in a paw worktree
  if ls .paw/tasks/*.md 1>/dev/null 2>&1; then
    task_file=$(ls .paw/tasks/*.md 2>/dev/null | head -1)
    task_name=$(basename "$task_file" .md)

    # Check if summary exists on sync branch (paw done writes it there)
    if ! git show "paw-sync:summaries/$task_name.md" >/dev/null 2>&1; then
      echo ""
      echo "PAW REMINDER: You have not run 'paw done' yet."
      echo "  Run 'paw done --summary \"...\"' before ending your session."
      echo "  Your summary is critical for merge conflict resolution."
      echo ""
    fi
  fi
fi

exit 0
