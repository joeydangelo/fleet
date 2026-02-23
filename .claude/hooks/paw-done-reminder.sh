#!/bin/bash
# Remind agents to run paw done before ending session
# Installed by: paw init
# Fires on PostToolUse:Bash for git commit/push commands

input=$(cat)

# Block git push from paw worktrees — paw handles merging locally
if [[ "$input" == *"git push"* ]]; then
  if ls .paw/tasks/*.md 1>/dev/null 2>&1; then
    echo ""
    echo "PAW WARNING: Do NOT push from a paw worktree."
    echo "  The orchestrator pushes the merged target branch after conflict resolution."
    echo "  Commit your work, then run 'paw done'."
    echo ""
    exit 2
  fi
fi

# Remind about paw done on git commit
if [[ "$input" == *"git commit"* ]]; then
  if ls .paw/tasks/*.md 1>/dev/null 2>&1; then
    task_file=$(ls .paw/tasks/*.md 2>/dev/null | head -1)
    task_name=$(basename "$task_file" .md)

    # Check if summary exists on sync branch (paw done writes it there)
    if ! git show "paw-sync:summaries/$task_name.md" >/dev/null 2>&1; then
      echo ""
      echo "PAW REMINDER: You have not run 'paw done' yet."
      echo "  Use a heredoc to write your summary:"
      echo "    paw done << 'EOF'"
      echo "    ## What I did"
      echo "    - ..."
      echo ""
      echo "    ## Interface changes"
      echo "    - ..."
      echo ""
      echo "    ## Watch out"
      echo "    - ..."
      echo "    EOF"
      echo "  Your summary is critical for merge conflict resolution."
      echo ""
    fi
  fi
fi

exit 0
