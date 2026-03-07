#!/bin/bash
# Block dangerous commands and sync state access in paw worktrees
# Installed by: paw init
# Fires on PreToolUse:Bash|Edit|Write, returns permissionDecision:"deny" to prevent execution

input=$(cat)

# Only guard worktrees with active tasks
if ! ls .paw/tasks/*.md 1>/dev/null 2>&1; then
  exit 0
fi

deny() {
  echo '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"'"$1"'"}}'
  exit 0
}

# Detect tool type from input
tool_name=$(echo "$input" | grep -o '"tool_name"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*"tool_name"[[:space:]]*:[[:space:]]*"\(.*\)"/\1/')

# Edit/Write guard
if [ "$tool_name" = "Edit" ] || [ "$tool_name" = "Write" ]; then
  file_path=$(echo "$input" | grep -o '"file_path"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*"file_path"[[:space:]]*:[[:space:]]*"\(.*\)"/\1/')
  if echo "$file_path" | grep -qE '\.paw/sync/|\.paw\\\\sync\\\\'; then
    deny "Do not edit files in .paw/sync/. The paw CLI manages all sync state. Manual edits corrupt coordination and break paw watch, paw merge, and paw go. Use paw commands (paw review, paw broadcast, paw status) instead."
  fi
  exit 0
fi

# Bash guard
command=$(echo "$input" | grep -o '"command"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*"command"[[:space:]]*:[[:space:]]*"\(.*\)"/\1/')

# Block git checkout / git switch (agents must stay on their task branch)
if echo "$command" | grep -qE '\bgit\s+(checkout|switch)\b'; then
  deny "Do not switch branches in a paw worktree. You are on a dedicated task branch. Stay on it and commit your work here."
fi

# Block git merge (orchestrator's job)
if echo "$command" | grep -qE '\bgit\s+merge\b'; then
  deny "Do not merge branches in a paw worktree. The orchestrator handles merging after all tasks are done."
fi

# Block git push (all work stays local until orchestrator merges)
if echo "$command" | grep -qE '\bgit\s+push\b'; then
  deny "Do not push from a paw worktree. All work stays local until the orchestrator merges."
fi

# Block orchestrator commands from worktrees
if echo "$command" | grep -qE '\bpaw\s+(up|down|merge|go|launch|init|watch|nudge)\b'; then
  deny "Do not run orchestrator commands from a paw worktree. These commands are for the orchestrator in the main repo."
fi

# Block direct access to sync state (state.json, .paw/sync/, paw-sync branch)
# The paw CLI manages all sync state. Manual edits corrupt coordination and break paw watch, merge, and go.
if echo "$command" | grep -qE '\.paw/sync/'; then
  deny "Do not access .paw/sync/ directly. The paw CLI manages sync state. Manual edits corrupt coordination and break paw watch, paw merge, and paw go. Use paw commands (paw review, paw broadcast, paw status) instead."
fi
if echo "$command" | grep -qE '\bgit\s+(show|log|cat-file|diff).*paw-sync'; then
  # Allow read-only git commands on paw-sync (paw-review-reminder uses git show)
  :
elif echo "$command" | grep -qE 'paw-sync'; then
  deny "Do not interact with the paw-sync branch directly. The paw CLI manages this branch. Manual changes corrupt session state and break paw watch, paw merge, and paw go."
fi

exit 0
