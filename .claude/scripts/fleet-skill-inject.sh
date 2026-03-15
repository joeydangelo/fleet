#!/bin/bash
# Inject role-specific skill content into agent context at session start
# Installed by: fleet init
# Fires on SessionStart — ensures agents have their workflow in context

# FLEET_ROLE env var takes precedence (set by fleet review for reviewer sessions)
if [ -n "$FLEET_ROLE" ]; then
  ROLE="$FLEET_ROLE"
elif ls .fleet/tasks/*.md 1>/dev/null 2>&1; then
  TASK_COUNT=$(ls .fleet/tasks/*.md 2>/dev/null | wc -l)
  if [ "$TASK_COUNT" -eq 1 ]; then
    ROLE="builder"
  else
    ROLE="orchestrator"
  fi
else
  ROLE="orchestrator"
fi

SKILL_FILE=".claude/skills/$ROLE/SKILL.md"
if [ ! -f "$SKILL_FILE" ]; then
  exit 0
fi

# Strip YAML frontmatter (lines between --- markers) and generated comments
sed '/^---$/,/^---$/d; /^<!-- DO NOT EDIT/,/-->/d' "$SKILL_FILE"

exit 0
