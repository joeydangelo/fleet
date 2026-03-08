#!/bin/bash
# Inject role-specific skill content into agent context at session start
# Installed by: paw init
# Fires on SessionStart — ensures agents have their workflow in context

# PAW_ROLE env var takes precedence (set by paw review for reviewer sessions)
if [ -n "$PAW_ROLE" ]; then
  ROLE="$PAW_ROLE"
elif ls .paw/tasks/*.md 1>/dev/null 2>&1; then
  TASK_COUNT=$(ls .paw/tasks/*.md 2>/dev/null | wc -l)
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
