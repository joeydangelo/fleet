#!/bin/bash
# Block dangerous git commands in paw worktrees before they execute
# Installed by: paw init
# Fires on PreToolUse:Bash, returns permissionDecision:"deny" to prevent execution

input=$(cat)

# Only guard worktrees with active tasks
if ! ls .paw/tasks/*.md 1>/dev/null 2>&1; then
  exit 0
fi

# Extract the command from Claude Code's PreToolUse JSON
command=$(echo "$input" | grep -o '"command"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*"command"[[:space:]]*:[[:space:]]*"\(.*\)"/\1/')

deny() {
  echo '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"'"$1"'"}}'
  exit 0
}

# Block git push (orchestrator handles pushing after merge)
if echo "$command" | grep -qE '\bgit\s+push\b'; then
  deny "Do not push from a paw worktree. Complete your task with 'paw done'. The orchestrator handles merging and pushing."
fi

# Block git checkout / git switch (agents must stay on their task branch)
if echo "$command" | grep -qE '\bgit\s+(checkout|switch)\b'; then
  deny "Do not switch branches in a paw worktree. You are on a dedicated task branch. Stay on it and commit your work here."
fi

# Block git merge (orchestrator's job)
if echo "$command" | grep -qE '\bgit\s+merge\b'; then
  deny "Do not merge branches in a paw worktree. The orchestrator handles merging after all tasks are done."
fi

# Block pull request creation (orchestrator's job)
if echo "$command" | grep -qE '\bgh\s+pr\s+create\b'; then
  deny "Do not create pull requests from a paw worktree. The orchestrator creates PRs after merging all task branches."
fi

# Block orchestrator commands from worktrees
if echo "$command" | grep -qE '\bpaw\s+(up|down|merge|go|launch)\b'; then
  deny "Do not run orchestrator commands from a paw worktree. These commands are for the orchestrator in the main repo."
fi

exit 0
